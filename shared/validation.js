/**
 * Правила валидации форм. Импортируются и браузером, и сервером:
 * клиент подсвечивает поля мгновенно, сервер проверяет то же самое повторно —
 * одинаковыми правилами, без риска разойтись.
 */

import { EMAIL_REGEX } from './constants.js';

export function isBlank(value) {
  return String(value ?? '').trim().length === 0;
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

/** Создание учетной записи администратора главным администратором. */
export function validateAdminInput({ displayName, login, email, password, password2 }, { requirePassword = true } = {}) {
  const errors = {};

  if (isBlank(displayName)) errors.displayName = 'Укажите ФИО администратора';

  if (isBlank(login)) errors.login = 'Укажите логин';
  else if (String(login).trim().length < 3) errors.login = 'Минимум 3 символа';

  if (isBlank(email)) errors.email = 'Укажите email';
  else if (!EMAIL_REGEX.test(String(email).trim())) errors.email = 'Некорректный формат email';

  if (requirePassword) checkPassword(errors, password, password2);

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateLoginInput({ login, password }) {
  const errors = {};
  if (isBlank(login)) errors.login = 'Введите логин';
  if (isBlank(password)) errors.password = 'Введите пароль';
  return { valid: Object.keys(errors).length === 0, errors };
}
