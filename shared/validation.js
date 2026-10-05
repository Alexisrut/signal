/**
 * Правила валидации форм. Импортируются и браузером, и сервером:
 * клиент подсвечивает поля мгновенно, сервер проверяет то же самое повторно —
 * одинаковыми правилами, без риска разойтись.
 */

import { ACCOUNT_TYPE_IDS, EMAIL_REGEX, MAX_COMMENT_LENGTH, MIN_REPORT_LENGTH } from './constants.js';

export function isBlank(value) {
  return String(value ?? '').trim().length === 0;
}

/**
 * Комментарий к действию: пояснение к возврату на доработку, ответ подрядчика,
 * реплика в переписке по сигналу.
 * @returns {string|null} текст ошибки или null
 */
export function validateComment(text, { required = true } = {}) {
  const value = String(text ?? '').trim();
  if (!value) return required ? 'Напишите комментарий' : null;
  if (value.length > MAX_COMMENT_LENGTH) return `Комментарий длиннее ${MAX_COMMENT_LENGTH} символов`;
  return null;
}

/**
 * Отчет о выполнении: по нему подрядчик решает, устранена ли проблема,
 * поэтому пустой или односложный отчет не принимается.
 * @returns {string|null} текст ошибки или null
 */
export function validateReport(text) {
  const value = String(text ?? '').trim();
  if (!value) return 'Опишите, что сделано и какое решение принято';
  if (value.length < MIN_REPORT_LENGTH) {
    return `Отчет слишком короткий: опишите, как решен вопрос (минимум ${MIN_REPORT_LENGTH} символов)`;
  }
  if (value.length > MAX_COMMENT_LENGTH) return `Отчет длиннее ${MAX_COMMENT_LENGTH} символов`;
  return null;
}

export function validateSignalInput({ contractorName, sector, description }) {
  const errors = {};
  if (isBlank(contractorName)) errors.contractorName = 'Укажите название подрядчика';
  if (isBlank(sector)) errors.sector = 'Укажите сектор работы';
  if (isBlank(description)) errors.description = 'Опишите проблему';
  else if (String(description).trim().length < 10) errors.description = 'Описание должно содержать минимум 10 символов';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Общие правила для пары «пароль + повтор». */
function checkPassword(errors, password, password2) {
  if (isBlank(password)) errors.password = 'Укажите пароль';
  else if (String(password).length < 6) errors.password = 'Минимум 6 символов';

  if (password2 !== undefined) {
    if (isBlank(password2)) errors.password2 = 'Повторите пароль';
    else if (password !== password2) errors.password2 = 'Пароли не совпадают';
  }
}

/**
 * Регистрация подрядчика: название компании служит логином,
 * поэтому оно обязательное и должно быть достаточно длинным.
 */
export function validateContractorInput({ companyName, fullName, email, password, password2 }) {
  const errors = {};

  if (isBlank(companyName)) errors.companyName = 'Укажите название компании';
  else if (String(companyName).trim().length < 3) errors.companyName = 'Минимум 3 символа';

  if (isBlank(fullName)) errors.fullName = 'Укажите ФИО';
  else if (String(fullName).trim().split(/\s+/).length < 2) errors.fullName = 'Укажите фамилию и имя';

  if (isBlank(email)) errors.email = 'Укажите email';
  else if (!EMAIL_REGEX.test(String(email).trim())) errors.email = 'Некорректный формат email';

  checkPassword(errors, password, password2);
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Создание учетной записи сотрудника главным администратором. */
export function validateAdminInput(
  { displayName, login, email, password, password2, role },
  { requirePassword = true } = {},
) {
  const errors = {};

  if (isBlank(displayName)) errors.displayName = 'Укажите ФИО сотрудника';

  if (isBlank(login)) errors.login = 'Укажите логин';
  else if (String(login).trim().length < 3) errors.login = 'Минимум 3 символа';

  if (isBlank(email)) errors.email = 'Укажите email';
  else if (!EMAIL_REGEX.test(String(email).trim())) errors.email = 'Некорректный формат email';

  if (role !== undefined && !ACCOUNT_TYPE_IDS.includes(role)) errors.role = 'Выберите тип аккаунта';

  if (requirePassword) checkPassword(errors, password, password2);

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateLoginInput({ login, password }) {
  const errors = {};
  if (isBlank(login)) errors.login = 'Введите логин';
  if (isBlank(password)) errors.password = 'Введите пароль';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Смена пароля из раздела «Аккаунт»: старый пароль плюс новая пара. */
export function validatePasswordChange({ currentPassword, password, password2 }) {
  const errors = {};
  if (isBlank(currentPassword)) errors.currentPassword = 'Введите текущий пароль';
  checkPassword(errors, password, password2);
  if (!errors.password && currentPassword === password) errors.password = 'Новый пароль совпадает с текущим';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Установка нового пароля по ссылке из письма — старый пароль неизвестен. */
export function validatePasswordReset({ password, password2 }) {
  const errors = {};
  checkPassword(errors, password, password2);
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Запрос восстановления: достаточно логина или почты. */
export function validateForgotInput({ identifier }) {
  const errors = {};
  if (isBlank(identifier)) errors.identifier = 'Укажите логин или email';
  return { valid: Object.keys(errors).length === 0, errors };
}
