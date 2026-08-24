/**
 * Подсистема уведомлений.
 *
 * Точка входа одна — `notifySignalEvent`, и вызывается она только из сервиса
 * сигналов сразу после успешного перехода конечного автомата.
 *
 * Получателей два вида:
 *   • сотрудники — по личным подпискам (общий тумблер плюс набор событий);
 *   • автор-подрядчик — по одному тумблеру и только на смену статуса
 *     его собственной проблемы, о создании он и так знает.
 */

import { sql } from '../db.js';
import { APP_URL } from '../config.js';
import { toUser } from '../identity.js';
import { sendMail, deliveryMode } from './transport.js';
import { verificationEmail, passwordResetEmail, signalNotificationEmail } from './templates.js';

import {
  ROLE,
  NOTIFICATION_EVENT,
  EMAIL_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  wantsNotification,
} from '../../shared/constants.js';

export function signalUrl(signalId) {
  return `${APP_URL}/#/admin/signal/${signalId}`;
}

export function contractorSignalUrl(signalId) {
  return `${APP_URL}/#/my/${signalId}`;
}

export function verificationUrl(token) {
  return `${APP_URL}/verify?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token) {
  return `${APP_URL}/reset?token=${encodeURIComponent(token)}`;
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

export async function sendPasswordResetEmail(user, token) {
  const message = passwordResetEmail({
    user,
    url: resetUrl(token),
    ttlMinutes: Math.round(RESET_TOKEN_TTL_MS / 60000),
  });

  const result = await sendMail({ ...message, to: user.email, kind: 'password-reset', entityId: user.id });
  return { mode: deliveryMode, ...result };
}

/** Сотрудники, подписанные на это событие. */
function staffRecipients(event) {
  return sql
    .all(`SELECT * FROM users WHERE role IN (?, ?, ?)`, [ROLE.ADMIN, ROLE.MANAGER, ROLE.SUPERADMIN])
    .map(toUser)
    .filter((user) => Boolean(user.email) && wantsNotification(user.notify, event));
}

/**
 * Автор сигнала, если это подрядчик с включенным тумблером.
 * Событие создания ему не отправляется: письмо о собственном обращении —
 * шум, тумблер обещает письма «при смене статуса проблемы».
 */
function contractorRecipient(signal, event) {
  if (event === NOTIFICATION_EVENT.CREATE) return null;

  const author = toUser(sql.get(`SELECT * FROM users WHERE id = ?`, [signal.authorId]));
  if (!author || author.role !== ROLE.CONTRACTOR) return null;
  if (!author.email || author.notify?.enabled === false) return null;
  return author;
}

/**
 * @param {string|null} event идентификатор события автомата (null — рассылка не нужна)
 * @param {object} signal сигнал в актуальном состоянии
 * @param {object} actor кто инициировал переход
 */
export function notifySignalEvent(event, signal, actor) {
  if (!event) return { sent: 0, recipients: [] };

  const staff = staffRecipients(event);
  const author = contractorRecipient(signal, event);
  if (!staff.length && !author) return { sent: 0, recipients: [] };

  // Рассылка не должна задерживать HTTP-ответ: отправляем в фоне,
  // ошибки доставки фиксируются в mail_log, а не роняют операцию.
  const deliver = (person, url, audience) => {
    const message = signalNotificationEmail({ event, signal, actor, url, audience });
    sendMail({ ...message, to: person.email, kind: `signal:${event}`, entityId: signal.id }).catch((error) =>
      console.error('[notifier] сбой отправки', error),
    );
  };

  for (const person of staff) deliver(person, signalUrl(signal.id), 'staff');
  if (author) deliver(author, contractorSignalUrl(signal.id), 'contractor');

  const total = staff.length + (author ? 1 : 0);
  console.info(`[notifier] событие ${event} по сигналу ${signal.id} → ${total} получателей`);
  return { sent: total, recipients: [...staff.map((person) => person.email), ...(author ? [author.email] : [])] };
}
