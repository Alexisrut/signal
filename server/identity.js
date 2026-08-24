/**
 * Идентичность запроса.
 *
 * Анонимных пользователей больше нет: и подрядчик, и администратор входят
 * по логину и паролю. Логин подрядчика — название его компании.
 */

import { sql } from './db.js';
import { randomToken } from './crypto.js';
import { parseCookies, appendCookie, clearCookie } from './http.js';
import { SESSION_TTL_MS } from './config.js';
import { ROLE, isAdminRole, isStaffRole, CATEGORY_IDS, normalizeNotify } from '../shared/constants.js';

const SESSION_COOKIE = 'sms_session';

function safeParse(json, fallback) {
  try {
    const value = JSON.parse(json ?? 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/** Строка таблицы users → объект предметной области. */
export function toUser(row) {
  if (!row) return null;

  const user = {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    login: row.login,
    email: row.email,
    createdAt: row.created_at,
    isEmailVerified: Boolean(row.is_email_verified),
    // Подписки на письма есть у всех ролей; у подрядчика используется только тумблер.
    notify: normalizeNotify(safeParse(row.notify, null)),
  };

  if (row.role === ROLE.CONTRACTOR) {
    user.companyName = row.company_name;
    user.fullName = row.full_name;
  }

  if (isStaffRole(row.role)) {
    // Главный администратор видит все категории независимо от списка.
    user.categories =
      row.role === ROLE.SUPERADMIN ? [...CATEGORY_IDS] : safeParse(row.categories, []).filter((id) => CATEGORY_IDS.includes(id));
  }

  return user;
}

export function findUser(id) {
  return toUser(sql.get(`SELECT * FROM users WHERE id = ?`, [id]));
}

export function findByLogin(login) {
  return sql.get(`SELECT * FROM users WHERE lower(login) = lower(?)`, [String(login ?? '').trim()]);
}

export function findByEmail(email) {
  return sql.get(`SELECT * FROM users WHERE lower(email) = lower(?)`, [String(email ?? '').trim()]);
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

/** @returns {object|null} вошедший пользователь либо null для гостя */
export function resolveActor(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const session = sql.get(`SELECT * FROM sessions WHERE token = ?`, [token]);
  if (session && session.expires_at > Date.now()) {
    const user = findUser(session.user_id);
    if (user) return user;
  }

  // Сессия протухла или учетная запись удалена.
  sql.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  clearCookie(res, SESSION_COOKIE);
  return null;
}

export const isAdmin = (actor) => isAdminRole(actor?.role);
export const isSuperadmin = (actor) => actor?.role === ROLE.SUPERADMIN;
export const isContractor = (actor) => actor?.role === ROLE.CONTRACTOR;

/**
 * Сотрудник платформы: администратор, главный администратор или руководитель.
 * Подтверждение почты доступ больше не ограничивает — оно необязательное.
 */
export const isStaff = (actor) => isStaffRole(actor?.role);
