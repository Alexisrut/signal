/**
 * Идентичность запроса.
 *
 * Подрядчик — анонимный пользователь, привязанный к устройству: идентификатор живет
 * в куке `sms_device` и создается сервером при первом обращении. Запись в таблице
 * users появляется лениво, при первом реальном действии (создании сигнала).
 *
 * Администратор — сессия в куке `sms_session`, токен хранится в таблице sessions.
 */

import { sql } from './db.js';
import { uid, randomToken } from './crypto.js';
import { parseCookies, appendCookie, clearCookie } from './http.js';
import { SESSION_TTL_MS } from './config.js';
import { ROLE, normalizeSettings } from '../shared/constants.js';

const DEVICE_COOKIE = 'sms_device';
const SESSION_COOKIE = 'sms_session';
const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function contractorDisplayName(deviceId) {
  return `Подрядчик ${deviceId.slice(-4).toUpperCase()}`;
}

/** Строка таблицы users → объект предметной области. */
export function toUser(row) {
  if (!row) return null;
  const user = {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
  if (row.role === ROLE.ADMIN) {
    user.login = row.login;
    user.email = row.email;
    user.isEmailVerified = Boolean(row.is_email_verified);
    user.settings = normalizeSettings(safeParse(row.settings));
  }
  return user;
}

function safeParse(json) {
  try {
    return JSON.parse(json ?? '{}');
  } catch {
    return {};
  }
}

export function findUser(id) {
  return toUser(sql.get(`SELECT * FROM users WHERE id = ?`, [id]));
}

/** Ленивая регистрация подрядчика — вызывается при первом действии. */
export function ensureContractorRecord(actor) {
  const existing = sql.get(`SELECT id FROM users WHERE id = ?`, [actor.id]);
  if (existing) return;

  sql.run(
    `INSERT INTO users (id, role, display_name, is_email_verified, created_at)
     VALUES (?, ?, ?, 0, ?)`,
    [actor.id, ROLE.CONTRACTOR, actor.displayName, Date.now()],
  );
}

/* ---------------------------------- сессии ----------------------------------- */

export function createSession(res, userId) {
  const token = randomToken();
  const now = Date.now();
  sql.run(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, [
    token,
    userId,
    now,
    now + SESSION_TTL_MS,
  ]);
  appendCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS });
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sql.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  clearCookie(res, SESSION_COOKIE);
}

/**
 * Определяет действующего пользователя запроса и, при необходимости,
 * выдает устройству идентификатор подрядчика.
 */
export function resolveActor(req, res) {
  const cookies = parseCookies(req);

  let deviceId = cookies[DEVICE_COOKIE];
  if (!deviceId || !/^ctr_[a-z0-9_]+$/i.test(deviceId)) {
    deviceId = uid('ctr');
    appendCookie(res, DEVICE_COOKIE, deviceId, { maxAge: DEVICE_TTL_MS, httpOnly: false });
  }

  const sessionToken = cookies[SESSION_COOKIE];
  if (sessionToken) {
    const session = sql.get(`SELECT * FROM sessions WHERE token = ?`, [sessionToken]);
    if (session && session.expires_at > Date.now()) {
      const admin = findUser(session.user_id);
      if (admin && admin.role === ROLE.ADMIN) return { ...admin, deviceId };
    }
    // Сессия протухла или учетная запись удалена.
    sql.run(`DELETE FROM sessions WHERE token = ?`, [sessionToken]);
    clearCookie(res, SESSION_COOKIE);
  }

  const known = findUser(deviceId);
  return {
    id: deviceId,
    deviceId,
    role: ROLE.CONTRACTOR,
    displayName: known?.displayName ?? contractorDisplayName(deviceId),
    anonymous: !known,
  };
}

export function isAdmin(actor) {
  return actor?.role === ROLE.ADMIN;
}

/** Полноправный администратор — вошедший И подтвердивший почту. */
export function isVerifiedAdmin(actor) {
  return isAdmin(actor) && actor.isEmailVerified === true;
}
