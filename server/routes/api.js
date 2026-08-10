/** Обработчики /api/*. Вся авторизация выполняется здесь, до вызова сервисов. */

import { sendJson, readJsonBody, badRequest, forbidden, notFound, HttpError } from '../http.js';
import { createSession, destroySession, isAdmin, isContractor, isSuperadmin, isVerifiedAdmin } from '../identity.js';
import { currentRevision } from '../events.js';
import { deliveryMode } from '../mail/transport.js';
import { SMTP_CONFIGURED, APP_URL } from '../config.js';

import * as signalsService from '../domain/signals.js';
import * as usersService from '../domain/users.js';

import { ESCALATION_MS, ROLE, STATUS } from '../../shared/constants.js';

/** Гость получает только meta — этого достаточно, чтобы показать вход и регистрацию. */
function requireActor(actor) {
  if (!actor) throw new HttpError(401, 'Требуется вход в систему');
  return actor;
}

function requireSuperadmin(actor) {
  if (!isSuperadmin(requireActor(actor))) throw forbidden('Действие доступно только главному администратору');
  return actor;
}

function publicActor(actor) {
  if (!actor) return null;

  const base = {
    id: actor.id,
    role: actor.role,
    displayName: actor.displayName,
    login: actor.login,
    createdAt: actor.createdAt,
  };

  if (isContractor(actor)) return { ...base, companyName: actor.companyName, fullName: actor.fullName };
  return { ...base, email: actor.email, isEmailVerified: actor.isEmailVerified, categories: actor.categories };
}

function meta() {
  return {
    rev: currentRevision(),
    escalationMs: ESCALATION_MS,
    mailMode: deliveryMode,
    smtpConfigured: SMTP_CONFIGURED,
    appUrl: APP_URL,
    defaultAdminPresent: usersService.hasDefaultAdmin(),
  };
}

/** Полный снимок состояния для текущего пользователя — основа live-режима. */
export function getState(req, res, { actor }) {
  if (!actor) {
    sendJson(res, 200, { actor: null, mySignals: null, allSignals: null, undistributed: null, users: null, meta: meta() });
    return;
  }

  const verified = isVerifiedAdmin(actor);

  const payload = {
    actor: publicActor(actor),
    // Изоляция подрядчиков живет здесь: чужие сигналы просто не попадают в ответ.
    mySignals: isContractor(actor) ? signalsService.listByAuthor(actor.id) : null,
    // Обычный администратор видит только разрешенные ему категории.
    allSignals: verified ? signalsService.listForAdmin(actor) : null,
    // Раздел «Распределение» существует только для главного администратора.
    undistributed: verified && isSuperadmin(actor) ? signalsService.listUndistributed() : null,
    users: isSuperadmin(actor) ? usersService.listUsers() : null,
    meta: meta(),
  };

  if (verified) {
    const visible = [...payload.allSignals, ...(payload.undistributed ?? [])];
    payload.authorLabels = Object.fromEntries(visible.map((signal) => [signal.id, signalsService.authorLabel(signal)]));
  }

  sendJson(res, 200, payload);
}

/* ---------------------------------- сигналы ---------------------------------- */

export async function createSignal(req, res, { actor }) {
  if (!isContractor(requireActor(actor))) throw forbidden('Создавать сигналы может только подрядчик');
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
  sendJson(res, 200, { signal: signalsService.distribute(params.id, body.category, actor) });
}

/** Принять сигнал в работу (`{assign: true}`) или снять с себя (`{assign: false}`). */
export async function assignSignal(req, res, { actor, params }) {
  if (!isVerifiedAdmin(requireActor(actor))) throw forbidden('Принимать в работу может только администратор');
  const body = await readJsonBody(req);
  sendJson(res, 200, { signal: signalsService.setAssignee(params.id, actor, body.assign !== false, body.userId) });
}

/** Демо-инструмент: сдвиг меток времени, чтобы увидеть работу автоэскалации. */
export function ageSignal(req, res, { actor, params }) {
  if (!isVerifiedAdmin(requireActor(actor))) throw forbidden('Доступно только администратору');
  const signal = signalsService.getById(params.id);
  if (!signal) throw notFound('Сигнал не найден');
  if (signal.status !== STATUS.YELLOW) throw badRequest('Состарить можно только Желтый сигнал');

  sendJson(res, 200, { signal: signalsService.ageSignal(params.id, ESCALATION_MS) });
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

/* ------------------------------ учетные записи -------------------------------- */

export async function createAdmin(req, res, { actor }) {
  requireSuperadmin(actor);

  const body = await readJsonBody(req);
  const { admin, delivery } = await usersService.createAdmin(body, actor);

  sendJson(res, 201, {
    admin: {
      id: admin.id,
      displayName: admin.displayName,
      login: admin.login,
      email: admin.email,
      categories: admin.categories,
    },
    delivery: { mode: delivery.mode, ok: delivery.ok, mailId: delivery.id, error: delivery.error },
  });
}

/** Набор категорий, видимых конкретному администратору. */
export async function updateUserCategories(req, res, { actor, params }) {
  requireSuperadmin(actor);
  const body = await readJsonBody(req);
  const user = usersService.updateCategories(params.id, body.categories, actor);
  sendJson(res, 200, { user: { id: user.id, login: user.login, categories: user.categories } });
}

export async function resendVerification(req, res, { actor }) {
  if (!isAdmin(requireActor(actor))) throw forbidden('Только для администраторов');
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
    isSuperadmin: actor?.role === ROLE.SUPERADMIN,
  });
}
