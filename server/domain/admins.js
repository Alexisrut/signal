/** Учетные записи администраторов: создание, вход, верификация почты, настройки. */

import { sql } from '../db.js';
import { uid, randomToken, randomSalt, hashPassword, verifyPassword } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { toUser, findUser } from '../identity.js';
import { sendVerificationEmail } from '../mail/notifier.js';
import { deliveryMode } from '../mail/transport.js';

import {
  ROLE,
  DEFAULT_ADMIN,
  DEFAULT_ADMIN_SETTINGS,
  EMAIL_TOKEN_TTL_MS,
  normalizeSettings,
} from '../../shared/constants.js';
import { validateAdminInput } from '../../shared/validation.js';

const VERIFY_PURPOSE = 'verify_email';

export function listAdmins() {
  return sql
    .all(`SELECT * FROM users WHERE role = ? ORDER BY created_at`, [ROLE.ADMIN])
    .map(toUser)
    .map((admin) => ({
      id: admin.id,
      displayName: admin.displayName,
      login: admin.login,
      email: admin.email,
      isEmailVerified: admin.isEmailVerified,
      createdAt: admin.createdAt,
      // Чужие настройки — не публичные данные; наружу отдаем только флаг рассылки.
      notificationsEnabled: admin.settings.notificationsEnabled,
    }));
}

/**
 * Жива ли еще учетная запись по умолчанию. Нужно только для того, чтобы показать
 * демо-подсказку на форме входа: сам список администраторов анонимному
 * пользователю не отдается.
 */
export function hasDefaultAdmin() {
  return Boolean(findByLogin(DEFAULT_ADMIN.login));
}

function findByLogin(login) {
  return sql.get(`SELECT * FROM users WHERE role = ? AND lower(login) = lower(?)`, [ROLE.ADMIN, String(login).trim()]);
}

function findByEmail(email) {
  return sql.get(`SELECT * FROM users WHERE role = ? AND lower(email) = lower(?)`, [ROLE.ADMIN, String(email).trim()]);
}

/* ----------------------------------- вход ------------------------------------ */

export function authenticate(login, password) {
  const row = findByLogin(login ?? '');
  if (!row) return null;
  if (!verifyPassword(password ?? '', row.password_salt, row.password_hash)) return null;
  return toUser(row);
}

/* --------------------------------- создание ---------------------------------- */

export async function createAdmin(input, actor) {
  const { valid, errors } = validateAdminInput(input);
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const login = String(input.login).trim();
  const email = String(input.email).trim().toLowerCase();

  if (findByLogin(login)) {
    const error = badRequest('Администратор с таким логином уже существует');
    error.errors = { login: 'Логин занят' };
    throw error;
  }
  if (findByEmail(email)) {
    const error = badRequest('Администратор с таким email уже существует');
    error.errors = { email: 'Email занят' };
    throw error;
  }

  const salt = randomSalt();
  const admin = {
    id: uid('adm'),
    displayName: String(input.displayName).trim(),
    login,
    email,
    createdAt: Date.now(),
  };

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, password_salt, password_hash,
                        is_email_verified, settings, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      admin.id,
      ROLE.ADMIN,
      admin.displayName,
      admin.login,
      admin.email,
      salt,
      hashPassword(input.password, salt),
      JSON.stringify(DEFAULT_ADMIN_SETTINGS),
      admin.createdAt,
      actor?.id ?? 'system',
    ],
  );

  // Учетная запись уже создана: сбой доставки письма не должен её откатывать —
  // администратор всегда может запросить письмо повторно.
  let delivery;
  try {
    delivery = await issueVerification(admin.id);
  } catch (error) {
    console.error('[admins] не удалось отправить письмо подтверждения:', error);
    delivery = { ok: false, mode: deliveryMode, error: error.message };
  }

  publish('admin', { id: admin.id });
  return { admin: findUser(admin.id), delivery };
}

/* ------------------------------- верификация --------------------------------- */

/** Выпускает одноразовый токен с TTL и отправляет письмо со ссылкой. */
export async function issueVerification(userId) {
  const user = findUser(userId);
  if (!user || user.role !== ROLE.ADMIN) throw notFound('Учетная запись не найдена');
  if (user.isEmailVerified) throw badRequest('Почта уже подтверждена');

  // Ранее выпущенные ссылки перестают работать: активный токен всегда один.
  sql.run(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, VERIFY_PURPOSE]);

  const token = randomToken();
  const now = Date.now();
  sql.run(
    `INSERT INTO email_tokens (token, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [token, userId, VERIFY_PURPOSE, now, now + EMAIL_TOKEN_TTL_MS],
  );

  return sendVerificationEmail(user, token);
}

/**
 * Проверяет токен из ссылки: существование, назначение, срок жизни и повторное
 * использование. При успехе помечает почту подтвержденной.
 */
export function verifyEmailToken(token) {
  const row = sql.get(`SELECT * FROM email_tokens WHERE token = ?`, [String(token ?? '')]);
  if (!row || row.purpose !== VERIFY_PURPOSE) return { ok: false, reason: 'Ссылка недействительна' };

  const user = findUser(row.user_id);
  if (!user) return { ok: false, reason: 'Учетная запись не найдена' };
  if (user.isEmailVerified) return { ok: true, user, alreadyVerified: true };

  if (row.used_at) return { ok: false, reason: 'Ссылка уже была использована' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'Срок действия ссылки истек', expired: true, user };

  sql.transaction(() => {
    sql.run(`UPDATE email_tokens SET used_at = ? WHERE token = ?`, [Date.now(), row.token]);
    sql.run(`UPDATE users SET is_email_verified = 1 WHERE id = ?`, [user.id]);
  });

  publish('admin', { id: user.id, verified: true });
  return { ok: true, user: findUser(user.id) };
}

/* --------------------------------- настройки --------------------------------- */

export function updateSettings(userId, rawSettings) {
  const user = findUser(userId);
  if (!user || user.role !== ROLE.ADMIN) throw forbidden('Настройки доступны только администратору');

  const settings = normalizeSettings(rawSettings);
  sql.run(`UPDATE users SET settings = ? WHERE id = ?`, [JSON.stringify(settings), userId]);

  publish('settings', { id: userId });
  return settings;
}
