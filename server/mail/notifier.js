/**
 * Подсистема уведомлений.
 *
 * Точка входа одна — `notifySignalEvent`, и вызывается она только из сервиса
 * сигналов сразу после успешного перехода конечного автомата.
 *
 * Фильтрация получателей убрана: письмо получают все администраторы
 * с подтвержденной почтой, настроек рассылки больше нет.
 */

import { sql } from '../db.js';
import { APP_URL } from '../config.js';
import { toUser } from '../identity.js';
import { sendMail, deliveryMode } from './transport.js';
import { verificationEmail, signalNotificationEmail } from './templates.js';

import { ROLE, EMAIL_TOKEN_TTL_MS } from '../../shared/constants.js';

export function signalUrl(signalId) {
  return `${APP_URL}/#/admin/signal/${signalId}`;
}

export function verificationUrl(token) {
  return `${APP_URL}/verify?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(user, token) {
  const message = verificationEmail({
    user,
    url: verificationUrl(token),
    ttlHours: Math.round(EMAIL_TOKEN_TTL_MS / 3600000),
  });

  const result = await sendMail({ ...message, to: user.email, kind: 'verification', entityId: user.id });
  return { mode: deliveryMode, ...result };
}

/** Получатели: все администраторы с подтвержденной почтой. */
function recipients() {
  return sql
    .all(`SELECT * FROM users WHERE role IN (?, ?) AND is_email_verified = 1`, [ROLE.ADMIN, ROLE.SUPERADMIN])
    .map(toUser)
    .filter((user) => Boolean(user.email));
}

/**
 * @param {string|null} event идентификатор события автомата (null — рассылка не нужна)
 * @param {object} signal сигнал в актуальном состоянии
 * @param {object} actor кто инициировал переход
 */
export function notifySignalEvent(event, signal, actor) {
  if (!event) return { sent: 0, recipients: [] };

  const people = recipients();
  if (!people.length) return { sent: 0, recipients: [] };

  const message = signalNotificationEmail({ event, signal, actor, url: signalUrl(signal.id) });

  // Рассылка не должна задерживать HTTP-ответ: отправляем в фоне,
  // ошибки доставки фиксируются в mail_log, а не роняют операцию.
  for (const person of people) {
    sendMail({ ...message, to: person.email, kind: `signal:${event}`, entityId: signal.id }).catch((error) =>
      console.error('[notifier] сбой отправки', error),
    );
  }

  console.info(`[notifier] событие ${event} по сигналу ${signal.id} → ${people.length} получателей`);
  return { sent: people.length, recipients: people.map((person) => person.email) };
}
