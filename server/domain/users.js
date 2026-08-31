/**
 * Учетные записи.
 *
 * Подрядчик регистрируется сам: логином служит название его компании.
 * Учетные записи сотрудников — администраторов, руководителей и главных
 * администраторов — заводит только главный администратор, он же выбирает
 * категории сигналов и удаляет ненужные учетные записи.
 *
 * Подтверждение почты необязательное: оно ничего не блокирует и нужно только
 * для восстановления пароля и писем. Само восстановление живет здесь же —
 * одноразовый токен с коротким сроком жизни.
 */

import { sql } from '../db.js';
import { uid, randomToken, randomSalt, hashPassword, verifyPassword } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { toUser, findUser, findByLogin, findByEmail } from '../identity.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../mail/notifier.js';
import { deliveryMode } from '../mail/transport.js';

import {
  ROLE,
  ROLE_LABEL,
  ROLE_RANK,
  ACCOUNT_TYPE_IDS,
  CATEGORY_IDS,
  DEFAULT_NOTIFY,
  EMAIL_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  isCategoryScopedRole,
  isStaffRole,
  normalizeNotify,
} from '../../shared/constants.js';
import {
  validateAdminInput,
  validateContractorInput,
  validatePasswordChange,
  validatePasswordReset,
} from '../../shared/validation.js';

const VERIFY_PURPOSE = 'verify_email';
const RESET_PURPOSE = 'reset_password';

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
                        password_salt, password_hash, is_email_verified, notify, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'self')`,
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
      JSON.stringify(DEFAULT_NOTIFY),
      Date.now(),
    ],
  );

  publish('user', { id });
  return findUser(id);
}

/* --------------------------- учетные записи сотрудников ----------------------- */

/**
 * Список учетных записей, сгруппированный по должности: главные администраторы,
 * администраторы, руководители, подрядчики — а внутри должности по алфавиту.
 * Время создания как порядок не годится: в списке ищут человека и роль,
 * а не «кого завели раньше».
 */
export function listUsers() {
  const rank = Object.entries(ROLE_RANK)
    .map(([role, value]) => `WHEN '${role}' THEN ${value}`)
    .join(' ');

  return sql
    .all(`SELECT * FROM users ORDER BY CASE role ${rank} ELSE 99 END, display_name COLLATE NOCASE`)
    .map(toUser)
    .map((user) => ({
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      login: user.login,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      ...(isStaffRole(user.role)
        ? { categories: user.categories }
        : { companyName: user.companyName, fullName: user.fullName }),
    }));
}

/**
 * Кандидаты в кураторы сигнала — только руководители.
 * Администраторы раздают задачи, но сами кураторами не становятся, поэтому
 * в списке выбора их нет. Категории каждого едут рядом: окно распределения
 * оставляет лишь тех, за кем закреплена категория конкретного сигнала.
 */
export function listAssignables() {
  return sql
    .all(`SELECT * FROM users WHERE role = ? ORDER BY display_name COLLATE NOCASE`, [ROLE.MANAGER])
    .map(toUser)
    .map((user) => ({
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      categories: user.categories ?? [],
    }));
}

/** Создание учетной записи сотрудника. Доступно только главному администратору. */
export async function createAdmin(input, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Создавать учетные записи может только главный администратор');
  }

  const role = ACCOUNT_TYPE_IDS.includes(input?.role) ? input.role : ROLE.ADMIN;
  const { valid, errors } = validateAdminInput({ ...input, role });
  if (!valid) throw withErrors('Форма заполнена не полностью', errors);

  const login = String(input.login).trim();
  const email = String(input.email).trim().toLowerCase();

  if (findByLogin(login)) throw withErrors('Логин уже занят', { login: 'Логин занят' });
  if (findByEmail(email)) throw withErrors('Этот email уже используется', { email: 'Email занят' });

  const salt = randomSalt();
  const id = uid('adm');
  // Главному администратору доступны все категории, набор для него не хранится.
  const categories = isCategoryScopedRole(role) ? normalizeCategories(input.categories) : [];

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, password_salt, password_hash,
                        is_email_verified, categories, notify, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      role,
      String(input.displayName).trim(),
      login,
      email,
      salt,
      hashPassword(input.password, salt),
      JSON.stringify(categories),
      JSON.stringify(DEFAULT_NOTIFY),
      Date.now(),
      actor.id,
    ],
  );

  // Учетная запись работает сразу: письмо подтверждения информационное,
  // и сбой доставки не должен откатывать создание.
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

/** Смена набора категорий. Только главный администратор. */
export function updateCategories(userId, categories, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Менять доступ к категориям может только главный администратор');
  }

  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');
  if (!isCategoryScopedRole(user.role)) {
    throw badRequest('Категории настраиваются у администраторов и руководителей');
  }

  const next = normalizeCategories(categories);
  sql.run(`UPDATE users SET categories = ? WHERE id = ?`, [JSON.stringify(next), userId]);

  publish('user', { id: userId, categories: next });
  return findUser(userId);
}

/**
 * Смена типа учетной записи.
 *
 * Разрешены ровно два перехода: Администратор → Главный администратор и
 * обратно. Все остальное заблокировано намеренно — роль руководителя связана
 * с курируемыми категориями и назначениями на задачи, и «перекинуть» человека
 * туда или оттуда одним кликом значило бы тихо порвать эти связи.
 * Такие переводы делаются созданием новой учетной записи.
 */
const ROLE_SWITCH = [
  { from: ROLE.ADMIN, to: ROLE.SUPERADMIN },
  { from: ROLE.SUPERADMIN, to: ROLE.ADMIN },
];

export function canSwitchRole(from, to) {
  return ROLE_SWITCH.some((rule) => rule.from === from && rule.to === to);
}

export function changeRole(userId, role, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Менять тип учетной записи может только главный администратор');
  }

  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');
  if (user.id === actor.id) throw badRequest('Нельзя менять тип собственной учетной записи');
  if (user.role === role) return user;

  if (!canSwitchRole(user.role, role)) {
    throw badRequest(
      `Переход «${ROLE_LABEL[user.role] ?? user.role}» → «${ROLE_LABEL[role] ?? role}» не разрешен: ` +
        'менять можно только между администратором и главным администратором',
    );
  }

  // Главному администратору категории не нужны — он видит все. Обратный
  // перевод оставляет пустой набор: какие категории открыть, решает человек.
  sql.run(`UPDATE users SET role = ?, categories = ? WHERE id = ?`, [role, JSON.stringify([]), userId]);

  publish('user', { id: userId, role });
  return findUser(userId);
}

/**
 * Удаление учетной записи. Только главный администратор, и только чужой:
 * запретить себе вход одним кликом — не то, чего от кнопки ждут.
 * Последнего главного администратора система тоже не отдает — иначе
 * управлять учетными записями станет некому.
 */
export function deleteUser(userId, actor) {
  if (actor?.role !== ROLE.SUPERADMIN) {
    throw forbidden('Удалять учетные записи может только главный администратор');
  }

  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');
  if (user.id === actor.id) throw badRequest('Нельзя удалить собственную учетную запись');

  if (user.role === ROLE.SUPERADMIN) {
    const { n } = sql.get(`SELECT COUNT(*) AS n FROM users WHERE role = ?`, [ROLE.SUPERADMIN]);
    if (n <= 1) throw badRequest('Это последний главный администратор — удалить его нельзя');
  }

  sql.transaction(() => {
    // Сигналы остаются: они исторический документ. Убираем только следы
    // участия — сессии и токены уходят каскадом по внешнему ключу.
    sql.run(`DELETE FROM assignments WHERE user_id = ?`, [userId]);
    sql.run(`DELETE FROM signal_views WHERE user_id = ?`, [userId]);
    sql.run(`DELETE FROM users WHERE id = ?`, [userId]);
  });

  publish('user', { id: userId, deleted: true });
  return { id: userId, displayName: user.displayName };
}

/* ------------------------------ личные настройки ------------------------------ */

/** Смена пароля из раздела «Аккаунт»: сначала подтверждаем текущий. */
export function changePassword(userId, input) {
  const { valid, errors } = validatePasswordChange(input);
  if (!valid) throw withErrors('Проверьте поля формы', errors);

  const row = sql.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!row) throw notFound('Учетная запись не найдена');

  if (!verifyPassword(input.currentPassword, row.password_salt, row.password_hash)) {
    throw withErrors('Текущий пароль указан неверно', { currentPassword: 'Неверный пароль' });
  }

  applyPassword(userId, input.password);
  return findUser(userId);
}

/** Общая часть смены пароля: новая соль плюс сброс всех активных сессий. */
function applyPassword(userId, password) {
  const salt = randomSalt();
  sql.transaction(() => {
    sql.run(`UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?`, [
      salt,
      hashPassword(password, salt),
      userId,
    ]);
    // Пароль сменился — прежние сессии больше не действуют.
    sql.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  });
}

/** Подписки на почтовые уведомления. Каждый настраивает только себя. */
export function updateNotify(userId, notify) {
  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');

  const next = normalizeNotify(notify);
  sql.run(`UPDATE users SET notify = ? WHERE id = ?`, [JSON.stringify(next), userId]);

  publish('user', { id: userId, notify: next.enabled });
  return findUser(userId);
}

/* ------------------------------- верификация --------------------------------- */

function issueToken(userId, purpose, ttlMs) {
  // Ранее выпущенные ссылки перестают работать: активный токен всегда один.
  sql.run(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, purpose]);

  const token = randomToken();
  const now = Date.now();
  sql.run(`INSERT INTO email_tokens (token, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`, [
    token,
    userId,
    purpose,
    now,
    now + ttlMs,
  ]);
  return token;
}

/** Выпускает одноразовый токен с TTL и отправляет письмо со ссылкой. */
export async function issueVerification(userId) {
  const user = findUser(userId);
  if (!user) throw notFound('Учетная запись не найдена');
  if (user.isEmailVerified) throw badRequest('Почта уже подтверждена');
  if (!user.email) throw badRequest('У учетной записи не указан email');

  return sendVerificationEmail(user, issueToken(userId, VERIFY_PURPOSE, EMAIL_TOKEN_TTL_MS));
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

/* --------------------------- восстановление пароля ---------------------------- */

/**
 * Запрос ссылки восстановления по логину или почте.
 *
 * Ответ всегда одинаковый: существование учетной записи через эту форму
 * узнать нельзя. Отсюда `{ ok: true }` даже когда отправлять некому.
 */
export async function requestPasswordReset(identifier) {
  const raw = String(identifier ?? '').trim();
  if (!raw) throw withErrors('Укажите логин или email', { identifier: 'Укажите логин или email' });

  const row = findByLogin(raw) ?? findByEmail(raw);
  const user = toUser(row);
  if (!user?.email) return { ok: true, sent: false };

  const delivery = await sendPasswordResetEmail(user, issueToken(user.id, RESET_PURPOSE, RESET_TOKEN_TTL_MS));
  return { ok: true, sent: true, delivery };
}

/** Проверка ссылки до показа формы — чтобы не вводить пароль впустую. */
export function checkResetToken(token) {
  const row = sql.get(`SELECT * FROM email_tokens WHERE token = ?`, [String(token ?? '')]);
  if (!row || row.purpose !== RESET_PURPOSE) return { ok: false, reason: 'Ссылка недействительна' };
  if (row.used_at) return { ok: false, reason: 'Ссылка уже была использована' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'Срок действия ссылки истек' };

  const user = findUser(row.user_id);
  if (!user) return { ok: false, reason: 'Учетная запись не найдена' };
  return { ok: true, login: user.login };
}

export function resetPassword(token, input) {
  const check = checkResetToken(token);
  if (!check.ok) throw badRequest(check.reason);

  const { valid, errors } = validatePasswordReset(input);
  if (!valid) throw withErrors('Проверьте поля формы', errors);

  const row = sql.get(`SELECT * FROM email_tokens WHERE token = ?`, [String(token)]);
  applyPassword(row.user_id, input.password);
  sql.run(`UPDATE email_tokens SET used_at = ? WHERE token = ?`, [Date.now(), row.token]);

  // Раз человек прочитал письмо на этом адресе — почта заодно подтверждена.
  sql.run(`UPDATE users SET is_email_verified = 1 WHERE id = ?`, [row.user_id]);

  publish('user', { id: row.user_id, passwordReset: true });
  return findUser(row.user_id);
}
