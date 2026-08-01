/** Обработчики /api/*. Вся авторизация выполняется здесь, до вызова сервисов. */

import { sendJson, readJsonBody, badRequest, forbidden, notFound, HttpError } from '../http.js';
import { createSession, destroySession, isAdmin, isVerifiedAdmin } from '../identity.js';
import { currentRevision } from '../events.js';
import { deliveryMode } from '../mail/transport.js';
import { SMTP_CONFIGURED, APP_URL } from '../config.js';

import * as signalsService from '../domain/signals.js';
import * as tasksService from '../domain/tasks.js';
import * as adminsService from '../domain/admins.js';

import { ESCALATION_MS, ROLE, STATUS } from '../../shared/constants.js';

/** Полный снимок состояния для текущего пользователя — основа live-режима. */
export function getState(req, res, { actor }) {
  const verified = isVerifiedAdmin(actor);

  const payload = {
    actor: {
      id: actor.id,
      role: actor.role,
      displayName: actor.displayName,
      anonymous: Boolean(actor.anonymous),
      ...(isAdmin(actor)
        ? {
            login: actor.login,
            email: actor.email,
            isEmailVerified: actor.isEmailVerified,
            settings: actor.settings,
            createdAt: actor.createdAt,
          }
        : {}),
    },
    // Изоляция подрядчиков живет здесь: чужие сигналы просто не попадают в ответ.
    mySignals: signalsService.listByAuthor(actor.id),
    allSignals: verified ? signalsService.listAll() : null,
    tasks: verified && actor.settings.tasksDashboardEnabled ? tasksService.listAll() : null,
    admins: verified ? adminsService.listAdmins() : null,
    meta: {
      rev: currentRevision(),
      escalationMs: ESCALATION_MS,
      mailMode: deliveryMode,
      smtpConfigured: SMTP_CONFIGURED,
      appUrl: APP_URL,
      defaultAdminPresent: adminsService.hasDefaultAdmin(),
    },
  };

  if (verified) {
    payload.authorLabels = Object.fromEntries(
      payload.allSignals.map((signal) => [signal.id, signalsService.authorLabel(signal)]),
    );
  }

  sendJson(res, 200, payload);
}

/* ---------------------------------- сигналы ---------------------------------- */

export async function createSignal(req, res, { actor }) {
  const body = await readJsonBody(req);
  const signal = signalsService.createSignal(body, actor);
  sendJson(res, 201, { signal });
}

export async function changeSignalStatus(req, res, { actor, params }) {
  const body = await readJsonBody(req);
  const signal = signalsService.changeStatus(params.id, body.status, actor);
  sendJson(res, 200, { signal });
}

export function getSignal(req, res, { actor, params }) {
  const signal = signalsService.getForActor(params.id, actor);
  if (!signal) throw notFound('Сигнал не найден');
  sendJson(res, 200, { signal });
}

/** Демо-инструмент: сдвиг меток времени, чтобы увидеть работу автоэскалации. */
export function ageSignal(req, res, { actor, params }) {
  if (!isVerifiedAdmin(actor)) throw forbidden('Доступно только администратору');
  const signal = signalsService.getById(params.id);
  if (!signal) throw notFound('Сигнал не найден');
  if (signal.status !== STATUS.YELLOW) throw badRequest('Состарить можно только Желтый сигнал');

  sendJson(res, 200, { signal: signalsService.ageSignal(params.id, ESCALATION_MS) });
}

/* ----------------------------------- вход ------------------------------------ */

export async function login(req, res) {
  const { login: userLogin, password } = await readJsonBody(req);
  const admin = adminsService.authenticate(userLogin, password);
  if (!admin) throw new HttpError(401, 'Неверный логин или пароль');

  createSession(res, admin.id);
  sendJson(res, 200, {
    admin: {
      id: admin.id,
      displayName: admin.displayName,
      login: admin.login,
      email: admin.email,
      isEmailVerified: admin.isEmailVerified,
    },
  });
}

export function logout(req, res) {
  destroySession(req, res);
  sendJson(res, 200, { ok: true });
}

/* ------------------------------ администраторы -------------------------------- */

export async function createAdmin(req, res, { actor }) {
  if (!isVerifiedAdmin(actor)) throw forbidden('Создавать администраторов может только подтвержденный администратор');

  const body = await readJsonBody(req);
  const { admin, delivery } = await adminsService.createAdmin(body, actor);

  sendJson(res, 201, {
    admin: { id: admin.id, displayName: admin.displayName, login: admin.login, email: admin.email },
    delivery: { mode: delivery.mode, ok: delivery.ok, mailId: delivery.id, error: delivery.error },
  });
}

export async function resendVerification(req, res, { actor }) {
  if (!isAdmin(actor)) throw forbidden('Только для администраторов');
  if (actor.isEmailVerified) throw badRequest('Почта уже подтверждена');

  const delivery = await adminsService.issueVerification(actor.id);
  sendJson(res, 200, { delivery: { mode: delivery.mode, ok: delivery.ok, mailId: delivery.id } });
}

export async function updateSettings(req, res, { actor }) {
  if (!isAdmin(actor)) throw forbidden('Настройки доступны только администратору');

  const body = await readJsonBody(req);
  const settings = adminsService.updateSettings(actor.id, body.settings ?? body);
  sendJson(res, 200, { settings });
}

/* ----------------------------------- задачи ----------------------------------- */

function assertTasksAvailable(actor) {
  if (!isVerifiedAdmin(actor)) throw forbidden('Модуль задач доступен только подтвержденному администратору');
  if (!actor.settings.tasksDashboardEnabled) throw forbidden('Дашборд задач отключен в настройках профиля');
}

export async function createTask(req, res, { actor }) {
  assertTasksAvailable(actor);
  const body = await readJsonBody(req);
  sendJson(res, 201, { task: tasksService.createTask(body, actor) });
}

export async function changeTaskStatus(req, res, { actor, params }) {
  assertTasksAvailable(actor);
  const body = await readJsonBody(req);
  sendJson(res, 200, { task: tasksService.changeStatus(params.id, body.status, actor) });
}

export function getTask(req, res, { actor, params }) {
  assertTasksAvailable(actor);
  const task = tasksService.getById(params.id);
  if (!task) throw notFound('Задача не найдена');
  sendJson(res, 200, { task });
}

/* ------------------------------ прочее ---------------------------------------- */

export function whoami(req, res, { actor }) {
  sendJson(res, 200, { id: actor.id, role: actor.role, isAdmin: actor.role === ROLE.ADMIN });
}
