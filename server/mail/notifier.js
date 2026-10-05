/**
 * Подсистема уведомлений.
 *
 * По сигналу письмо уходит о каждом действии: создание, возврат на доработку,
 * дополнения подрядчика, распределение, комментарии, эскалация, закрытие.
 * Точка входа одна — `notifySignal`, ее вызывает сервис сигналов после
 * каждого действия.
 *
 * Кому:
 *   • автору сигнала — подрядчику (или сотруднику, если сигнал подал он);
 *   • ответственным, назначенным на сигнал;
 *   • главному администратору — письма входного контроля всегда, остальные
 *     на период тестирования (MAIL_COPY_SUPERADMIN, см. config.js).
 *
 * Выборочной подписки на события нет: у каждого один общий тумблер. Все
 * письма одного сигнала приходят с одной и той же темой — «Сигнал №125.
 * Недопоставка кабельной продукции» — и почта собирает их в одну цепочку.
 */

import { sql } from '../db.js';
import { APP_URL, MAIL_COPY_SUPERADMIN } from '../config.js';
import { findUser, toUser } from '../identity.js';
import { sendMail, deliveryMode } from './transport.js';
import { verificationEmail, passwordResetEmail, signalNotificationEmail } from './templates.js';

import {
  ROLE,
  INTAKE_STATUSES,
  SIGNAL_ACTION,
  EMAIL_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  deriveSignalTopic,
  signalNumber,
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

/* --------------------------------- сигналы ----------------------------------- */

/** Тема всех писем по сигналу — неизменная от создания до закрытия. */
export function signalSubject(signal) {
  return `Сигнал ${signalNumber(signal)}. ${signal.topic ?? deriveSignalTopic(signal.description)}`;
}

const THREAD_DOMAIN = (() => {
  try {
    return new URL(APP_URL).hostname || 'signal.local';
  } catch {
    return 'signal.local';
  }
})();

/** Корень почтовой цепочки сигнала: на него ссылаются все письма по нему. */
function threadRoot(signal) {
  return `<signal.${signal.id}@${THREAD_DOMAIN}>`;
}

/** Действия входного контроля: их главный администратор получает всегда — действовать ему. */
const INTAKE_ACTIONS = new Set([SIGNAL_ACTION.CREATE, SIGNAL_ACTION.RESUBMIT]);

/**
 * Кому уходит письмо о действии с сигналом. Исполнитель действия тоже
 * в списке: у каждого участника в почте должна быть вся цепочка целиком,
 * включая собственные шаги.
 */
function recipientsFor(action, signal, from) {
  const people = new Map();
  const add = (user) => {
    if (!user?.email || people.has(user.id) || !wantsNotification(user.notify)) return;
    people.set(user.id, user);
  };

  add(findUser(signal.authorId));
  for (const person of signal.assignees ?? []) add(findUser(person.id));

  // Входной контроль — и до, и после действия: сигнал, закрытый автором прямо
  // с проверки, исчезает из очереди главного администратора, и знать ему об этом нужно.
  const intakeStage =
    INTAKE_ACTIONS.has(action) || INTAKE_STATUSES.includes(signal.status) || INTAKE_STATUSES.includes(from);
  if (MAIL_COPY_SUPERADMIN || intakeStage) {
    sql
      .all(`SELECT * FROM users WHERE role = ?`, [ROLE.SUPERADMIN])
      .map(toUser)
      .forEach(add);
  }

  return [...people.values()];
}

/**
 * @param {string} action действие из SIGNAL_ACTION
 * @param {object} signal сигнал в актуальном состоянии
 * @param {object} actor кто выполнил действие
 * @param {object} [extra] комментарий, изменения, файлы, назначенные — то, что войдет в письмо;
 *   `from` — статус до действия
 */
export function notifySignal(action, signal, actor, extra = {}) {
  const recipients = recipientsFor(action, signal, extra.from);
  if (!recipients.length) return { sent: 0, recipients: [] };

  const subject = signalSubject(signal);
  for (const person of recipients) {
    const audience = person.role === ROLE.CONTRACTOR ? 'contractor' : 'staff';
    const url = audience === 'contractor' ? contractorSignalUrl(signal.id) : signalUrl(signal.id);
    deliver(person, {
      ...signalNotificationEmail({ action, signal, actor, url, audience, subject, ...extra }),
      kind: `signal:${action}`,
      entityId: signal.id,
      references: threadRoot(signal),
      headers: { 'Thread-Topic': subject },
    });
  }

  console.info(`[notifier] ${action} по сигналу ${signalNumber(signal)} → ${recipients.length} получателей`);
  return { sent: recipients.length, recipients: recipients.map((person) => person.email) };
}

/**
 * Отправка одного письма. Рассылка не должна задерживать HTTP-ответ, поэтому
 * уходит в фоне: сбой доставки фиксируется в mail_log и в журнале, но не
 * роняет операцию, которая его вызвала.
 */
function deliver(person, message) {
  sendMail({ ...message, to: person.email }).catch((error) => console.error('[notifier] сбой отправки', error));
}
