/**
 * Подсистема уведомлений.
 *
 * Две точки входа: `notifySignalEvent` — после перехода конечного автомата,
 * `notifyAssignment` — после выдачи задачи.
 *
 * Получателей два вида:
 *   • сотрудники — по личным подпискам (общий тумблер плюс набор событий)
 *     И по видимости сигнала (см. staffRecipients);
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
  isSuperadminRole,
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

/**
 * Виден ли сотруднику этот сигнал. Повторяет правило выборки дашборда
 * (listForAdmin): главный администратор видит все, администратор и
 * руководитель — только закрепленные за ними категории, а нераспределенный
 * сигнал не виден никому, кроме главного администратора.
 */
function canSee(user, signal) {
  if (isSuperadminRole(user.role)) return true;
  if (!signal.category) return false;
  return (user.categories ?? []).includes(signal.category);
}

/**
 * Кому уходит письмо по событию сигнала.
 *
 * Раньше рассылка шла всем сотрудникам, подписанным на событие, — и новый
 * сигнал будил всю платформу, включая тех, кто его даже открыть не может.
 * Теперь работают три правила, в этом порядке:
 *
 *   1. Назначенный на задачу получает по ней все. Это и есть «уведомление
 *      исполнителю после назначения ответственным».
 *   2. Руководитель без назначения не получает ничего: до выдачи задачи
 *      он к ней отношения не имеет.
 *   3. Администраторам приходит то, что им видно: главному — весь поток,
 *      обычному — сигналы его категорий.
 *
 * Из третьего правила следует и поведение при создании: нераспределенный
 * сигнал видит только главный администратор, он же его и распределяет,
 * поэтому письмо о новом обращении уходит ему одному.
 *
 * Личная подписка проверяется сверх этих правил и может лишь сузить список.
 */
function staffRecipients(event, signal) {
  const assigned = new Set((signal.assignees ?? []).map((person) => person.id));

  return sql
    .all(`SELECT * FROM users WHERE role IN (?, ?, ?)`, [ROLE.ADMIN, ROLE.MANAGER, ROLE.SUPERADMIN])
    .map(toUser)
    .filter((user) => {
      if (!user.email) return false;
      if (!wantsNotification(user.notify, event)) return false;
      if (assigned.has(user.id)) return true;
      if (user.role === ROLE.MANAGER) return false;
      return canSee(user, signal);
    });
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

  const staff = staffRecipients(event, signal);
  const author = contractorRecipient(signal, event);
  if (!staff.length && !author) return { sent: 0, recipients: [] };

  for (const person of staff) deliver(person, { event, signal, actor, url: signalUrl(signal.id) });
  if (author) {
    deliver(author, { event, signal, actor, url: contractorSignalUrl(signal.id), audience: 'contractor' });
  }

  const total = staff.length + (author ? 1 : 0);
  console.info(`[notifier] событие ${event} по сигналу ${signal.id} → ${total} получателей`);
  return { sent: total, recipients: [...staff.map((person) => person.email), ...(author ? [author.email] : [])] };
}

/**
 * Отправка одного письма. Рассылка не должна задерживать HTTP-ответ, поэтому
 * уходит в фоне: сбой доставки фиксируется в mail_log и в журнале, но не
 * роняет операцию, которая его вызвала.
 */
function deliver(person, { event, signal, actor, url, audience = 'staff' }) {
  const message = signalNotificationEmail({ event, signal, actor, url, audience });
  sendMail({ ...message, to: person.email, kind: `signal:${event}`, entityId: signal.id }).catch((error) =>
    console.error('[notifier] сбой отправки', error),
  );
}

/**
 * Письмо тем, кого только что назначили ответственными за сигнал.
 *
 * Отдельная точка входа, а не событие автомата: назначение статуса не меняет,
 * а получатели тут не «все, кому видно», а ровно те, кого добавили этим
 * действием. Уже назначенным ранее повторное письмо не уходит.
 *
 * @param {object} signal сигнал в актуальном состоянии
 * @param {Array<{id: string}>} people кого добавили именно сейчас
 * @param {object} actor кто выдал задачу
 */
export function notifyAssignment(signal, people, actor) {
  const event = NOTIFICATION_EVENT.ASSIGN;

  const recipients = (people ?? [])
    .map((person) => toUser(sql.get(`SELECT * FROM users WHERE id = ?`, [person.id])))
    .filter(Boolean)
    // Письмо самому себе о собственном действии — шум: главный администратор
    // нередко назначает задачу на себя и уже знает об этом.
    .filter((user) => user.id !== actor?.id)
    .filter((user) => Boolean(user.email) && wantsNotification(user.notify, event));

  if (!recipients.length) return { sent: 0, recipients: [] };

  for (const person of recipients) deliver(person, { event, signal, actor, url: signalUrl(signal.id) });

  console.info(`[notifier] назначение по сигналу ${signal.id} → ${recipients.length} получателей`);
  return { sent: recipients.length, recipients: recipients.map((person) => person.email) };
}
