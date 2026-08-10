/**
 * КОНЕЧНЫЙ АВТОМАТ СТАТУСОВ.
 *
 *            (создание)
 *                │
 *                ▼
 *            ┌────────┐  +48ч СИСТЕМА или админ   ┌────────┐
 *            │ ЖЕЛТЫЙ │ ────────────────────────► │КРАСНЫЙ │
 *            └────────┘        вручную            └────────┘
 *              │    │                                │   │
 *   автор/админ│    │только админ         автор/админ│   │только админ
 *              ▼    ▼                                ▼   ▼
 *         ┌────────┐ ┌────────┐               ┌────────┐ ┌────────┐
 *         │ЗЕЛЕНЫЙ │ │ СЕРЫЙ  │               │ЗЕЛЕНЫЙ │ │ СЕРЫЙ  │
 *         └────────┘ └────────┘               └────────┘ └────────┘
 *          терминальный статус                 терминальный статус
 *
 * Желтый не выставляется вручную никогда — только автоматически при создании.
 * Красный ставит фоновый процесс по достижении порога 48 часов, а с версии
 * с ручной эскалацией — еще и администратор, не дожидаясь порога. В истории
 * эти два случая различимы: у автоматического автор события — Система.
 */

import { STATUS, STATUS_META, ROLE, ESCALATION_MS, NOTIFICATION_EVENT, isAdminRole } from './constants.js';

/** Декларативное описание разрешенных переходов. */
export const TRANSITIONS = [
  {
    to: STATUS.RED,
    from: [STATUS.YELLOW],
    actor: 'system-or-admin',
    description: 'Автоэскалация через 48 часов или ручной перевод администратором',
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
  const isAdminActor = isAdminRole(actor?.role);
  const isAuthor = actor?.id === signal.authorId;

  switch (rule.actor) {
    case 'system-or-admin':
      return isSystem || isAdminActor
        ? { allowed: true }
        : { allowed: false, reason: 'Перевести сигнал в Красный может система или администратор' };
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
  return [STATUS.RED, STATUS.GREEN, STATUS.GRAY].filter((to) => canTransition(signal, to, actor).allowed);
}

/**
 * Право редактировать карточку.
 * Администратор правит любую; автор — только свою и пока она не закрыта:
 * после терминального статуса запись становится историческим документом.
 */
export function canEdit(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (isAdminRole(actor?.role)) return { allowed: true };
  if (actor?.id !== signal.authorId) return { allowed: false, reason: 'Редактировать может автор или администратор' };
  if (isTerminal(signal.status)) {
    return { allowed: false, reason: 'Сигнал закрыт — редактирование недоступно' };
  }
  return { allowed: true };
}

export function assignees(entity) {
  return entity?.assignees ?? [];
}

export function isAssignedTo(entity, userId) {
  return assignees(entity).some((person) => person.id === userId);
}

/**
 * Принять в работу может любой администратор, пока сигнал активен.
 * Исполнителей несколько, поэтому занятость другим человеком уже не мешает —
 * не пускаем только повторное принятие тем же самым.
 */
export function canAssign(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!isAdminRole(actor?.role)) return { allowed: false, reason: 'Принимать в работу может только администратор' };
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт' };
  if (isAssignedTo(signal, actor.id)) return { allowed: false, reason: 'Вы уже в работе по этому сигналу' };
  return { allowed: true };
}

/** Снять исполнителя — себя или коллегу — может любой администратор. */
export function canRelease(signal, actor, userId = actor?.id) {
  if (!assignees(signal).length) return { allowed: false, reason: 'Сигнал никем не принят' };
  if (!isAdminRole(actor?.role)) return { allowed: false, reason: 'Доступно только администратору' };
  if (!isAssignedTo(signal, userId)) return { allowed: false, reason: 'Этот исполнитель не в работе по сигналу' };
  return { allowed: true };
}

/**
 * Событие подсистемы уведомлений, соответствующее переходу автомата.
 * Именно здесь конечный автомат становится источником триггеров рассылки:
 * никакой другой код не решает «а не отправить ли письмо».
 *
 * @param {string|null} from исходный статус (null — создание сигнала)
 * @param {string} to новый статус
 * @returns {string|null} идентификатор события или null, если рассылка не нужна
 */
export function notificationEventFor(from, to) {
  if (from === null && to === STATUS.YELLOW) return NOTIFICATION_EVENT.CREATE;
  if (to === STATUS.RED) return NOTIFICATION_EVENT.RED;
  if (to === STATUS.GREEN || to === STATUS.GRAY) return NOTIFICATION_EVENT.RESOLVE;
  return null;
}

/** Распределять сигналы по категориям может только главный администратор. */
export function canDistribute(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (actor?.role !== ROLE.SUPERADMIN) {
    return { allowed: false, reason: 'Распределять сигналы может только главный администратор' };
  }
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт' };
  return { allowed: true };
}
