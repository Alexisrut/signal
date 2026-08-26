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
 *
 * ВОЗОБНОВЛЕНИЕ. Терминальный статус больше не тупик: сотрудник, которому виден
 * сигнал, возвращает его в ту активную фазу, из которой сигнал был закрыт.
 * Время, проведенное в закрытом состоянии, копится в `pausedMs` и вычитается
 * из времени решения — таймер продолжает идти с того же места, а не с нуля.
 */

import {
  STATUS,
  STATUS_META,
  ROLE,
  ESCALATION_MS,
  HISTORY_KIND,
  NOTIFICATION_EVENT,
  isAdminRole,
  isStaffRole,
} from './constants.js';

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

/** Суммарное время, проведенное сигналом в закрытом состоянии. */
export function pausedMs(signal) {
  return Math.max(0, Number(signal?.pausedMs) || 0);
}

/**
 * Момент входа сигнала в Желтый статус (для отсчета порога эскалации).
 * Возобновление отсчет не сбрасывает — оно лишь снимает сигнал с паузы,
 * поэтому записи с видом `reopen` пропускаются.
 */
export function yellowSince(signal) {
  const history = signal.history ?? [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].kind === HISTORY_KIND.REOPEN) continue;
    if (history[i].to === STATUS.YELLOW) return history[i].at;
  }
  return signal.createdAt;
}

/** Момент, в который сигнал должен быть эскалирован; null — если он не Желтый. */
export function escalationDueAt(signal) {
  if (signal.status !== STATUS.YELLOW) return null;
  // Пауза сдвигает порог вперед ровно на свою длительность.
  return yellowSince(signal) + ESCALATION_MS + pausedMs(signal);
}

/**
 * Время решения: сколько сигнал реально прожил как проблема.
 * У закрытого — от создания до закрытия, у активного — до текущего момента;
 * в обоих случаях за вычетом пауз между закрытием и возобновлением.
 */
export function resolutionMs(signal, now = Date.now()) {
  if (!signal) return 0;
  const end = isTerminal(signal.status) ? (signal.closedAt ?? signal.updatedAt) : now;
  return Math.max(0, end - signal.createdAt - pausedMs(signal));
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
      reason: `Статус «${STATUS_META[signal.status].short}» закрыт — сначала возобновите сигнал`,
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
  const isStaffActor = isStaffRole(actor?.role);
  const isAuthor = actor?.id === signal.authorId;

  switch (rule.actor) {
    case 'system-or-admin':
      return isSystem || isStaffActor
        ? { allowed: true }
        : { allowed: false, reason: 'Перевести сигнал в Красный может система или сотрудник платформы' };
    case 'admin':
      return isStaffActor
        ? { allowed: true }
        : { allowed: false, reason: 'Отклонить сигнал может только администратор или руководитель' };
    case 'author-or-admin':
      return isStaffActor || isAuthor
        ? { allowed: true }
        : { allowed: false, reason: 'Закрыть сигнал может только его автор, администратор или руководитель' };
    default:
      return { allowed: false, reason: 'Переход не предусмотрен' };
  }
}

/**
 * Статус, в который вернется закрытый сигнал при возобновлении, — тот,
 * из которого его закрыли. Если след потерян, считаем сигнал новым.
 */
export function reopenTargetStatus(signal) {
  const history = signal?.history ?? [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (isTerminal(entry.to) && entry.from && isActive(entry.from)) return entry.from;
  }
  return STATUS.YELLOW;
}

/**
 * Возобновление закрытого сигнала. Доступно администраторам и руководителям;
 * видимость сигнала проверяется отдельно — здесь только роль и статус.
 */
export function canReopen(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал и так находится в активной фазе' };
  if (!isStaffRole(actor?.role)) {
    return { allowed: false, reason: 'Возобновить сигнал может администратор или руководитель' };
  }
  return { allowed: true };
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
  if (isStaffRole(actor?.role)) return { allowed: true };
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
  if (!isStaffRole(actor?.role)) return { allowed: false, reason: 'Принимать в работу может только сотрудник платформы' };
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт' };
  if (isAssignedTo(signal, actor.id)) return { allowed: false, reason: 'Вы уже в работе по этому сигналу' };
  return { allowed: true };
}

/**
 * Назначить на сигнал кураторов (раздел «Распределение» и карточка сигнала).
 * Это не «принять в работу себя», а раздача задачи руководителям, и занимаются
 * ею только администраторы: руководитель ведет свои задачи, но не раздает чужие.
 */
export function canAssignOthers(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!isAdminRole(actor?.role)) {
    return { allowed: false, reason: 'Назначать кураторов может только администратор' };
  }
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт — сначала возобновите его' };
  return { allowed: true };
}

/**
 * Может ли этот человек стать куратором сигнала.
 * Куратор — всегда руководитель, и только тот, за кем закреплена категория
 * сигнала: раздавать задачи «мимо специализации» система не дает.
 */
export function canCurate(user, category) {
  if (user?.role !== ROLE.MANAGER) return false;
  if (!category) return false; // нераспределенный сигнал курировать некому
  return (user.categories ?? []).includes(category);
}

/**
 * Снять исполнителя. Себя снимает любой сотрудник, коллегу — только
 * администратор: состав кураторов — часть распределения, а его руководитель
 * не ведет.
 */
export function canRelease(signal, actor, userId = actor?.id) {
  if (!assignees(signal).length) return { allowed: false, reason: 'Сигнал никем не принят' };
  if (!isStaffRole(actor?.role)) return { allowed: false, reason: 'Доступно только сотруднику платформы' };
  if (userId !== actor?.id && !isAdminRole(actor?.role)) {
    return { allowed: false, reason: 'Снимать других исполнителей может только администратор' };
  }
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
  // Выход из терминального статуса — это возобновление, а не рядовая эскалация.
  if (isTerminal(from) && isActive(to)) return NOTIFICATION_EVENT.REOPEN;
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
