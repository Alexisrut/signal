/** Идентификаторы, токены и хеширование паролей (серверная сторона). */

import crypto from 'node:crypto';

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** scrypt — медленная KDF, устойчивая к перебору; пароль в открытом виде нигде не хранится. */
export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

/** Сравнение в постоянном времени — не даёт мерить время подбора хеша. */
export function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
