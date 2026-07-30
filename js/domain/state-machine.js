/**
 * КОНЕЧНЫЙ АВТОМАТ СТАТУСОВ.
 *
 *            (создание)
 *                │
 *                ▼
 *            ┌────────┐   +48ч, только СИСТЕМА    ┌────────┐
 *            │ ЖЕЛТЫЙ │ ────────────────────────► │КРАСНЫЙ │
 *            └────────┘                           └────────┘
 *              │    │                                │   │
 *   автор/админ│    │только админ         автор/админ│   │только админ
 *              ▼    ▼                                ▼   ▼
 *         ┌────────┐ ┌────────┐               ┌────────┐ ┌────────┐
 *         │ЗЕЛЕНЫЙ │ │ СЕРЫЙ  │               │ЗЕЛЕНЫЙ │ │ СЕРЫЙ  │
 *         └────────┘ └────────┘               └────────┘ └────────┘
 *          терминальный статус                 терминальный статус
 *
 * Желтый и Красный НИКОГДА не выставляются вручную:
 *   Желтый  — только автоматически при создании сигнала;
 *   Красный — только автоматически фоновым воркером по достижении порога 48 часов.
 */

import { STATUS, STATUS_META, ROLE, ESCALATION_MS } from '../core/constants.js';

/** Декларативное описание разрешенных переходов. */
export const TRANSITIONS = [
  {
    to: STATUS.RED,
    from: [STATUS.YELLOW],
    actor: 'system',
    description: 'Автоматическая эскалация системой через 48 часов',
  },
  {
    to: STATUS.GREEN,
    from: [STATUS.YELLOW, STATUS.RED],
    actor: 'author-or-admin',
    description: 'Автор сигнала или любой администратор',
  },
  {
    to: STATUS.GRAY,
    from: [STATUS.YELLOW, STATUS.RED],
    actor: 'admin',
    description: 'Только администратор',
  },
];

export function isTerminal(status) {
  return Boolean(STATUS_META[status]?.terminal);
}

export function isActive(status) {
  return status === STATUS.YELLOW || status === STATUS.RED;
}

/** Момент входа сигнала в Желтый статус (для отсчета порога эскалации). */
export function yellowSince(signal) {
  for (let i = signal.history.length - 1; i >= 0; i -= 1) {
    if (signal.history[i].to === STATUS.YELLOW) return signal.history[i].at;
  }
  return signal.createdAt;
}

/** Момент, в который сигнал должен быть эскалирован; null — если он не Желтый. */
export function escalationDueAt(signal) {
  if (signal.status !== STATUS.YELLOW) return null;
  return yellowSince(signal) + ESCALATION_MS;
}

export function isEscalationDue(signal, now = Date.now()) {
  const due = escalationDueAt(signal);
  return due !== null && now >= due;
}

/**
 * Проверка права на переход.
 * @returns {{allowed: boolean, reason?: string}}
 */
export function canTransition(signal, to, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!STATUS_META[to]) return { allowed: false, reason: 'Неизвестный статус' };
  if (signal.status === to) return { allowed: false, reason: 'Сигнал уже в этом статусе' };

  if (isTerminal(signal.status)) {
    return {
      allowed: false,
      reason: `Статус «${STATUS_META[signal.status].short}» терминальный — изменения запрещены`,
    };
  }

  if (to === STATUS.YELLOW) {
    return { allowed: false, reason: 'Желтый статус выставляется только автоматически при создании сигнала' };
  }

  const rule = TRANSITIONS.find((t) => t.to === to);
  if (!rule) return { allowed: false, reason: 'Переход не предусмотрен' };
  if (!rule.from.includes(signal.status)) {
    return {
      allowed: false,
      reason: `Переход из «${STATUS_META[signal.status].short}» в «${STATUS_META[to].short}» не предусмотрен`,
    };
  }

  const isSystem = actor?.role === ROLE.SYSTEM;
  const isAdminActor = actor?.role === ROLE.ADMIN;
  const isAuthor = actor?.id === signal.authorId;

  switch (rule.actor) {
    case 'system':
      return isSystem
        ? { allowed: true }
        : { allowed: false, reason: 'Красный статус выставляется только системой автоматически' };
    case 'admin':
      return isAdminActor
        ? { allowed: true }
        : { allowed: false, reason: 'Отклонить сигнал может только администратор' };
    case 'author-or-admin':
      return isAdminActor || isAuthor
        ? { allowed: true }
        : { allowed: false, reason: 'Закрыть сигнал может только его автор или администратор' };
    default:
      return { allowed: false, reason: 'Переход не предусмотрен' };
  }
}

/** Статусы, которые актор может выставить вручную прямо сейчас. */
export function availableManualTransitions(signal, actor) {
  return [STATUS.GREEN, STATUS.GRAY].filter((to) => canTransition(signal, to, actor).allowed);
}
