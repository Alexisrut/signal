/**
 * ОГРАНИЧЕНИЕ ЧАСТОТЫ ЗАПРОСОВ.
 *
 * Приложение открыто наружу и держит формы, которые дорого обходятся или
 * притягивают перебор: вход (проверка пароля через scrypt занимает миллисекунды
 * процессорного времени на каждый запрос), регистрация, восстановление пароля,
 * создание сигналов. Без счетчика попыток пароль главного администратора
 * подбирается в один поток, а сервер заваливается одним скриптом.
 *
 * Счетчики живут в памяти процесса: приложение запускается ровно в одном
 * экземпляре (в нем же крутится фоновая эскалация), поэтому отдельное
 * хранилище не нужно. Перезапуск обнуляет счетчики — это осознанный размен
 * простоты на строгость.
 */

import { HttpError } from './http.js';

const buckets = new Map();

/** Раз в пять минут выбрасываем окна, которые уже истекли. */
const SWEEP_MS = 5 * 60 * 1000;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
sweeper.unref?.();

/**
 * Отметить попытку и, если лимит исчерпан, бросить 429.
 *
 * @param {string} key    что считаем: адрес клиента плюс имя действия
 * @param {number} limit  сколько попыток разрешено в окне
 * @param {number} windowMs длина окна в миллисекундах
 */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const error = new HttpError(429, `Слишком много запросов. Повторите через ${seconds} с.`);
    error.retryAfter = seconds;
    throw error;
  }
}

/** Снять счетчик — вызывается после успешного входа, чтобы не наказывать своих. */
export function reset(key) {
  buckets.delete(key);
}

/** Наборы лимитов по видам действий. */
export const LIMITS = {
  // Подбор пароля: десять неудач с одного адреса в четверть часа.
  LOGIN: { limit: 10, windowMs: 15 * 60 * 1000 },
  // Регистрация и письма — дорогие операции с внешними эффектами.
  SIGNUP: { limit: 5, windowMs: 60 * 60 * 1000 },
  MAIL: { limit: 5, windowMs: 60 * 60 * 1000 },
  // Создание сигналов: живому человеку столько за час не нужно.
  WRITE: { limit: 60, windowMs: 60 * 60 * 1000 },
  // Загрузка файлов — самая тяжелая операция по диску и памяти.
  UPLOAD: { limit: 60, windowMs: 60 * 60 * 1000 },
};

export function guard(req, action, { limit, windowMs }, extra = '') {
  hit(`${action}:${extra}:${req.ip}`, limit, windowMs);
}
