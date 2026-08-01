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

export function validateTaskInput({ title, description }) {
  const errors = {};
  if (isBlank(title)) errors.title = 'Укажите заголовок задачи';
  else if (String(title).trim().length < 3) errors.title = 'Минимум 3 символа';
  if (isBlank(description)) errors.description = 'Опишите задачу';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateAdminInput({ displayName, login, email, password, password2 }, { requirePassword = true } = {}) {
  const errors = {};

  if (isBlank(displayName)) errors.displayName = 'Укажите имя администратора';

  if (isBlank(login)) errors.login = 'Укажите логин';
  else if (String(login).trim().length < 3) errors.login = 'Минимум 3 символа';

  if (isBlank(email)) errors.email = 'Укажите email';
  else if (!EMAIL_REGEX.test(String(email).trim())) errors.email = 'Некорректный формат email';

  if (requirePassword) {
    if (isBlank(password)) errors.password = 'Укажите пароль';
    else if (String(password).length < 6) errors.password = 'Минимум 6 символов';

    if (password2 !== undefined) {
      if (isBlank(password2)) errors.password2 = 'Повторите пароль';
      else if (password !== password2) errors.password2 = 'Пароли не совпадают';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
