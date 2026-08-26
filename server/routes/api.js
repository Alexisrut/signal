/** Обработчики /api/*. Вся авторизация выполняется здесь, до вызова сервисов. */

import { sendJson, readJsonBody, badRequest, forbidden, notFound, HttpError } from '../http.js';
import { createSession, destroySession, isAdmin, isContractor, isStaff, isSuperadmin } from '../identity.js';
import { currentRevision } from '../events.js';
import { deliveryMode } from '../mail/transport.js';
import { SMTP_CONFIGURED, APP_URL } from '../config.js';

import * as signalsService from '../domain/signals.js';
import * as usersService from '../domain/users.js';

import { ESCALATION_MS, ROLE } from '../../shared/constants.js';

/** Гость получает только meta — этого достаточно, чтобы показать вход и регистрацию. */
function requireActor(actor) {
  if (!actor) throw new HttpError(401, 'Требуется вход в систему');
  return actor;
}

function requireSuperadmin(actor) {
  if (!isSuperadmin(requireActor(actor))) throw forbidden('Действие доступно только главному администратору');
  return actor;
}

function requireStaff(actor) {
  if (!isStaff(requireActor(actor))) throw forbidden('Действие доступно администраторам и руководителям');
  return actor;
}

function publicActor(actor) {
  if (!actor) return null;

  const base = {
    id: actor.id,
    role: actor.role,
    displayName: actor.displayName,
    login: actor.login,
    email: actor.email,
    isEmailVerified: actor.isEmailVerified,
    notify: actor.notify,
    // Показывать ли вкладку «Мои сигналы» — признак залипающий.
    hasOwnSignals: actor.hasOwnSignals,
    createdAt: actor.createdAt,
  };

  if (isContractor(actor)) return { ...base, companyName: actor.companyName, fullName: actor.fullName };
  return { ...base, categories: actor.categories };
}

function meta() {
  return {
    rev: currentRevision(),
    escalationMs: ESCALATION_MS,
    mailMode: deliveryMode,
    smtpConfigured: SMTP_CONFIGURED,
    appUrl: APP_URL,
  };
}

/** Полный снимок состояния для текущего пользователя — основа live-режима. */
export function getState(req, res, { actor }) {
  if (!actor) {
    sendJson(res, 200, {
      actor: null,
      mySignals: null,
      allSignals: null,
      undistributed: null,
      users: null,
      meta: meta(),
    });
    return;
  }

  const staff = isStaff(actor);

  const payload = {
    actor: publicActor(actor),
    // «Мои сигналы» у подрядчика — то, что он подал; у сотрудника — то,
    // за что он лично отвечает. Изоляция подрядчиков живет здесь:
    // чужие сигналы просто не попадают в ответ.
    mySignals: isContractor(actor) ? signalsService.listByAuthor(actor.id) : signalsService.listAssignedTo(actor.id),
    // Администратор и руководитель видят только разрешенные им категории.
    allSignals: staff ? signalsService.listForAdmin(actor) : null,
    // Раздел «Распределение» существует только для главного администратора.
    undistributed: isSuperadmin(actor) ? signalsService.listUndistributed() : null,
    users: isSuperadmin(actor) ? usersService.listUsers() : null,
    // Кого можно назначить на сигнал — список нужен окну распределения.
    assignables: staff ? usersService.listAssignables() : null,
    // Статистика решения считается по всей платформе, а не по видимым категориям.
    stats: staff ? signalsService.resolutionStats() : null,
    meta: meta(),
  };

  if (staff) {
    const visible = [...payload.allSignals, ...(payload.undistributed ?? [])];
    payload.authorLabels = Object.fromEntries(visible.map((signal) => [signal.id, signalsService.authorLabel(signal)]));
    // Индикатор «сколько изменений с прошлого захода» — по одному числу на карточку.
    payload.unread = signalsService.unreadFor(actor.id, visible.map((signal) => signal.id));
  }

  sendJson(res, 200, payload);
}

/* ---------------------------------- сигналы ---------------------------------- */

/**
 * Сигнал заводит и подрядчик, и сотрудник платформы. Автор всегда берется
 * из сессии: тело запроса имя автора не передает и передать не может.
 */
export async function createSignal(req, res, { actor }) {
  requireActor(actor);
  if (!isContractor(actor) && !isStaff(actor)) throw forbidden('Создавать сигналы может участник системы');

  const body = await readJsonBody(req);
  const signal = signalsService.createSignal(body, actor);
  sendJson(res, 201, { signal });
}

export async function changeSignalStatus(req, res, { actor, params }) {
  requireActor(actor);
  const body = await readJsonBody(req);
  const signal = signalsService.changeStatus(params.id, body.status, actor);
  sendJson(res, 200, { signal });
}

/** Вернуть закрытый сигнал в активную фазу — администратор или руководитель. */
export async function reopenSignal(req, res, { actor, params }) {
  requireStaff(actor);
  const body = await readJsonBody(req);
  sendJson(res, 200, { signal: signalsService.reopenSignal(params.id, actor, body.note) });
}

export function getSignal(req, res, { actor, params }) {
  requireActor(actor);
  const signal = signalsService.getForActor(params.id, actor);
  if (!signal) throw notFound('Сигнал не найден');
  sendJson(res, 200, { signal });
}

export async function updateSignal(req, res, { actor, params }) {
  requireActor(actor);
  const body = await readJsonBody(req);
  sendJson(res, 200, { signal: signalsService.updateSignal(params.id, body, actor) });
}

/** Распределение сигнала по категории — раздел главного администратора. */
export async function distributeSignal(req, res, { actor, params }) {
  requireSuperadmin(actor);
  const body = await readJsonBody(req);
  const signal = signalsService.distribute(params.id, body.category, actor, {
    assignees: body.assignees,
    note: body.note,
  });
  sendJson(res, 200, { signal });
}

/** Выдать задачу выбранным сотрудникам и приложить заметку. */
export async function assignPeople(req, res, { actor, params }) {
  requireStaff(actor);
  const body = await readJsonBody(req);
  sendJson(res, 200, { signal: signalsService.assignPeople(params.id, body.assignees, actor, body.note) });
}

/** Принять сигнал в работу (`{assign: true}`) или снять с себя (`{assign: false}`). */
export async function assignSignal(req, res, { actor, params }) {
  requireStaff(actor);
  const body = await readJsonBody(req);
  sendJson(res, 200, { signal: signalsService.setAssignee(params.id, actor, body.assign !== false, body.userId) });
}

/** Отметка «карточку открывали» — сбрасывает индикатор новых изменений. */
export async function seenSignal(req, res, { actor, params }) {
  requireStaff(actor);
  sendJson(res, 200, { seen: signalsService.markSeen(params.id, actor.id) });
}

/* ------------------------------ вход и регистрация ---------------------------- */

/** Единая форма входа: логин подрядчика — название компании, у администратора — свой. */
export async function login(req, res) {
  const { login: userLogin, password } = await readJsonBody(req);
  const user = usersService.authenticate(userLogin, password);
  if (!user) throw new HttpError(401, 'Неверный логин или пароль');

  createSession(res, user.id);
  sendJson(res, 200, { user: publicActor(user) });
}

/** Самостоятельная регистрация подрядчика. */
export async function register(req, res, { actor }) {
  if (actor) throw badRequest('Вы уже вошли в систему');

  const body = await readJsonBody(req);
  const user = usersService.registerContractor(body);

  createSession(res, user.id);
  sendJson(res, 201, { user: publicActor(user) });
}

export function logout(req, res) {
  destroySession(req, res);
  sendJson(res, 200, { ok: true });
}

/* --------------------------- восстановление пароля ---------------------------- */

/**
 * Ответ намеренно не различает «письмо ушло» и «такой учетной записи нет»:
 * иначе форма превращается в способ проверять существование логинов.
 */
export async function forgotPassword(req, res, { actor }) {
  if (actor) throw badRequest('Вы уже вошли в систему — пароль меняется в разделе «Аккаунт»');

  const body = await readJsonBody(req);
  const result = await usersService.requestPasswordReset(body.identifier);
  sendJson(res, 200, { ok: true, mailMode: deliveryMode, sent: result.sent });
}

export function checkResetToken(req, res, { url }) {
  sendJson(res, 200, usersService.checkResetToken(url.searchParams.get('token')));
}

export async function resetPassword(req, res) {
  const body = await readJsonBody(req);
  const user = usersService.resetPassword(body.token, body);
  sendJson(res, 200, { ok: true, login: user.login });
}

/* ------------------------------ учетные записи -------------------------------- */

export async function createAdmin(req, res, { actor }) {
  requireSuperadmin(actor);

  const body = await readJsonBody(req);
  const { admin, delivery } = await usersService.createAdmin(body, actor);

  sendJson(res, 201, {
    admin: {
      id: admin.id,
      role: admin.role,
      displayName: admin.displayName,
      login: admin.login,
      email: admin.email,
      categories: admin.categories,
    },
    delivery: { mode: delivery.mode, ok: delivery.ok, mailId: delivery.id, error: delivery.error },
  });
}

/** Набор категорий, закрепленных за администратором или руководителем. */
export async function updateUserCategories(req, res, { actor, params }) {
  requireSuperadmin(actor);
  const body = await readJsonBody(req);
  const user = usersService.updateCategories(params.id, body.categories, actor);
  sendJson(res, 200, { user: { id: user.id, login: user.login, categories: user.categories } });
}

export function deleteUser(req, res, { actor, params }) {
  requireSuperadmin(actor);
  sendJson(res, 200, { deleted: usersService.deleteUser(params.id, actor) });
}

/* ------------------------------ личный кабинет -------------------------------- */

export async function changePassword(req, res, { actor }) {
  requireActor(actor);
  const body = await readJsonBody(req);
  usersService.changePassword(actor.id, body);

  // Смена пароля обнуляет сессии, включая текущую: выдаем новую сразу,
  // чтобы человека не выбрасывало на форму входа после успешного действия.
  createSession(res, actor.id);
  sendJson(res, 200, { ok: true });
}

export async function updateNotify(req, res, { actor }) {
  requireActor(actor);
  const body = await readJsonBody(req);
  const user = usersService.updateNotify(actor.id, body.notify);
  sendJson(res, 200, { notify: user.notify });
}

export async function resendVerification(req, res, { actor }) {
  requireActor(actor);
  if (actor.isEmailVerified) throw badRequest('Почта уже подтверждена');

  const delivery = await usersService.issueVerification(actor.id);
  sendJson(res, 200, { delivery: { mode: delivery.mode, ok: delivery.ok, mailId: delivery.id } });
}

/* ------------------------------ прочее ---------------------------------------- */

export function whoami(req, res, { actor }) {
  sendJson(res, 200, {
    id: actor?.id ?? null,
    role: actor?.role ?? null,
    isAdmin: isAdmin(actor),
    isStaff: isStaff(actor),
    isSuperadmin: actor?.role === ROLE.SUPERADMIN,
  });
}
