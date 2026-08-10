/**
 * Учетные записи.
 *
 * Подрядчик регистрируется сам: логином служит название его компании.
 * Учетные записи администраторов заводит только главный администратор,
 * он же выбирает, какие категории сигналов видит каждый из них.
 */

import { sql } from '../db.js';
import { uid, randomToken, randomSalt, hashPassword, verifyPassword } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { toUser, findUser, findByLogin, findByEmail } from '../identity.js';
import { sendVerificationEmail } from '../mail/notifier.js';
import { deliveryMode } from '../mail/transport.js';

import { ROLE, CATEGORY_IDS, EMAIL_TOKEN_TTL_MS, isAdminRole } from '../../shared/constants.js';
import { validateAdminInput, validateContractorInput } from '../../shared/validation.js';

const VERIFY_PURPOSE = 'verify_email';

const withErrors = (message, errors) => {
  const error = badRequest(message);
  error.errors = errors;
  return error;
};

/** Отсекаем неизвестные категории — список приходит из формы. */
const normalizeCategories = (values) =>
  [...new Set((Array.isArray(values) ? values : []).filter((id) => CATEGORY_IDS.includes(id)))];

/* ----------------------------------- вход ------------------------------------ */

export function authenticate(login, password) {
  const row = findByLogin(login ?? '');
  if (!row?.password_hash) return null;
  if (!verifyPassword(password ?? '', row.password_salt, row.password_hash)) return null;
  return toUser(row);
}

/* --------------------------- регистрация подрядчика --------------------------- */

export function registerContractor(input) {
  const { valid, errors } = validateContractorInput(input);
  if (!valid) throw withErrors('Форма заполнена не полностью', errors);

  const companyName = String(input.companyName).trim();
  const email = String(input.email).trim().toLowerCase();

  // Название компании — это логин, поэтому оно должно быть уникальным.
  if (findByLogin(companyName)) {
    throw withErrors('Компания с таким названием уже зарегистрирована', {
      companyName: 'Название занято, выберите другое',
    });
  }
  if (findByEmail(email)) {
    throw withErrors('Этот email уже используется', { email: 'Email занят' });
  }

  const salt = randomSalt();
  const id = uid('ctr');
  const fullName = String(input.fullName).trim();

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, company_name, full_name,
                        password_salt, password_hash, is_email_verified, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'self')`,
    [
      id,
      ROLE.CONTRACTOR,
      companyName,
      companyName,
      email,
      companyName,
      fullName,
      salt,
      hashPassword(input.password, salt),
      Date.now(),
    ],
  );

  publish('user', { id });
  return findUser(id);
}

/* ------------------------ учетные записи администраторов ---------------------- */

export function listUsers() {
  return sql
    .all(`SELECT * FROM users ORDER BY created_at`)
    .map(toUser)
    .map((user) => ({
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      login: user.login,
      email: user.email,
      createdAt: user.createdAt,
      ...(isAdminRole(user.role)
        ? { isEmailVerified: user.isEmailVerified, categories: user.categories }
        : { companyName: user.companyName, fullName: user.fullName }),
    }));
}

/** Создание администратора. Доступно только главному администратору. */
export async function createAdmin(input, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Создавать учетные записи может только главный администратор');
  }

  const { valid, errors } = validateAdminInput(input);
  if (!valid) throw withErrors('Форма заполнена не полностью', errors);

  const login = String(input.login).trim();
  const email = String(input.email).trim().toLowerCase();

  if (findByLogin(login)) throw withErrors('Логин уже занят', { login: 'Логин занят' });
  if (findByEmail(email)) throw withErrors('Этот email уже используется', { email: 'Email занят' });

  const salt = randomSalt();
  const id = uid('adm');

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, password_salt, password_hash,
                        is_email_verified, categories, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      ROLE.ADMIN,
      String(input.displayName).trim(),
      login,
      email,
      salt,
      hashPassword(input.password, salt),
      JSON.stringify(normalizeCategories(input.categories)),
      Date.now(),
      actor.id,
    ],
  );

  // Учетная запись уже создана: сбой доставки письма не должен ее откатывать.
  let delivery;
  try {
    delivery = await issueVerification(id);
  } catch (error) {
    console.error('[users] не удалось отправить письмо подтверждения:', error);
    delivery = { ok: false, mode: deliveryMode, error: error.message };
  }

  publish('user', { id });
  return { admin: findUser(id), delivery };
}

/** Смена набора видимых категорий. Только главный администратор. */
export function updateCategories(userId, categories, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Менять доступ к категориям может только главный администратор');
  }

  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');
  if (user.role !== ROLE.ADMIN) throw badRequest('Категории настраиваются только у администраторов');

  const next = normalizeCategories(categories);
  sql.run(`UPDATE users SET categories = ? WHERE id = ?`, [JSON.stringify(next), userId]);

  publish('user', { id: userId, categories: next });
  return findUser(userId);
}

/* ------------------------------- верификация --------------------------------- */

/** Выпускает одноразовый токен с TTL и отправляет письмо со ссылкой. */
export async function issueVerification(userId) {
  const user = findUser(userId);
  if (!user || !isAdminRole(user.role)) throw notFound('Учетная запись не найдена');
  if (user.isEmailVerified) throw badRequest('Почта уже подтверждена');

  // Ранее выпущенные ссылки перестают работать: активный токен всегда один.
  sql.run(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, VERIFY_PURPOSE]);

  const token = randomToken();
  const now = Date.now();
  sql.run(`INSERT INTO email_tokens (token, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`, [
    token,
    userId,
    VERIFY_PURPOSE,
    now,
    now + EMAIL_TOKEN_TTL_MS,
  ]);

  return sendVerificationEmail(user, token);
}

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

  publish('user', { id: user.id, verified: true });
  return { ok: true, user: findUser(user.id) };
}

/** Жива ли еще учетная запись по умолчанию — для демо-подсказки на форме входа. */
export function hasDefaultAdmin() {
  return Boolean(findByLogin('admin'));
}
