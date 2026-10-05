/**
 * КОНЕЧНЫЙ АВТОМАТ СИГНАЛА.
 *
 *     (создание)
 *         │
 *         ▼
 *   ┌──────────────────┐   вернуть на доработку    ┌────────────────────────┐
 *   │ ВХОДНОЙ КОНТРОЛЬ │ ────────────────────────► │ НА ДОРАБОТКЕ           │
 *   │  главный админ   │ ◄──────────────────────── │ У ПОДРЯДЧИКА           │
 *   └──────────────────┘  дополнен и отправлен     └────────────────────────┘
 *         │                 на повторную проверку
 *         │ распределить ответственному
 *         ▼
 *   ┌────────┐   48 ч в работе: СИСТЕМА или вручную   ┌────────┐
 *   │ ЖЕЛТЫЙ │ ─────────────────────────────────────► │КРАСНЫЙ │
 *   └────────┘                                        └────────┘
 *         │  отчет + «Направить на подтверждение»        │
 *         └──────────────────────┬───────────────────────┘
 *                                ▼
 *               ┌─────────────────────────────────┐
 *               │ ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ ПОДРЯДЧИКА │
 *               └─────────────────────────────────┘
 *                  │ подтвердил             │ вернул с комментарием
 *                  ▼                        ▼
 *            ┌─────────┐          ┌────────────────────────┐   48 ч → КРАСНЫЙ
 *            │ ЗАКРЫТ  │          │ ВОЗВРАЩЕН НА ДОРАБОТКУ │ ──────────────►
 *            └─────────┘          └────────────────────────┘
 *                                   │ дополнил отчет и повторно направил
 *                                   └──────────► ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ
 *
 * Каждое действие описано декларативно в WORKFLOW: из каких статусов оно
 * доступно, в какой ведет, кто вправе его выполнить и обязателен ли
 * комментарий или отчет. Сервер применяет те же правила до записи в базу,
 * интерфейс — чтобы решить, какие кнопки показывать.
 *
 * ВХОДНОЙ КОНТРОЛЬ. Новый сигнал не уходит в работу сразу: главный
 * администратор проверяет, хватает ли в нем данных. Если нет — возвращает
 * подрядчику с комментарием, что дополнить. Подрядчик правит сигнал,
 * прикладывает документы и отправляет его на повторную проверку.
 *
 * ПОДТВЕРЖДЕНИЕ. Ответственный не закрывает сигнал сам: он пишет отчет о том,
 * что сделано и какое решение принято, и направляет результат подрядчику.
 * Окончательно сигнал закрывает только сторона, обозначившая проблему, —
 * автор. Если проблема не устранена, автор возвращает сигнал с обязательным
 * комментарием, и цикл повторяется. Отклонить сигнал без решения может только
 * главный администратор и только с указанием причины.
 *
 * ЧАСЫ СИГНАЛА. Время, пока мяч на стороне подрядчика (доработка, проверка
 * результата) или сигнал закрыт, копится в `pausedMs` и не идет во время
 * решения. Порог эскалации — 48 часов: для Желтого это суммарное время
 * в Желтом (возобновление продолжает отсчет), для возвращенного на доработку —
 * время с момента возврата.
 */

import {
  STATUS,
  STATUS_META,
  STATUS_ORDER,
  ROLE,
  ESCALATION_MS,
  SIGNAL_ACTION,
  WORK_STATUSES,
  isStaffRole,
  isSuperadminRole,
} from './constants.js';

const OPEN_STATUSES = STATUS_ORDER.filter((status) => !STATUS_META[status].terminal);

const isAuthor = (signal, actor) => Boolean(actor?.id) && actor.id === signal.authorId;

/** Отчет и отправку на подтверждение выполняют сотрудники, которым виден сигнал. */
const staffOnly = (signal, actor) =>
  isStaffRole(actor?.role) || 'Отработать сигнал может ответственный сотрудник';

/**
 * Декларативное описание действий, меняющих статус.
 * `allow` возвращает true либо текст отказа.
 */
export const WORKFLOW = {
  [SIGNAL_ACTION.DISTRIBUTE]: {
    from: [STATUS.INTAKE],
    to: STATUS.YELLOW,
    allow: (signal, actor) =>
      isSuperadminRole(actor?.role) || 'Распределять сигналы может только главный администратор',
  },
  [SIGNAL_ACTION.INTAKE_RETURN]: {
    from: [STATUS.INTAKE],
    to: STATUS.REWORK,
    comment: true,
    allow: (signal, actor) =>
      isSuperadminRole(actor?.role) || 'Вернуть сигнал на доработку может только главный администратор',
  },
  [SIGNAL_ACTION.RESUBMIT]: {
    from: [STATUS.REWORK],
    to: STATUS.INTAKE,
    allow: (signal, actor) =>
      isAuthor(signal, actor) || 'Отправить сигнал на повторную проверку может только его автор',
  },
  [SIGNAL_ACTION.ESCALATE]: {
    from: [STATUS.YELLOW, STATUS.RETURNED],
    to: STATUS.RED,
    allow: (signal, actor) =>
      actor?.role === ROLE.SYSTEM ||
      isStaffRole(actor?.role) ||
      'Перевести сигнал в Красный может система или сотрудник платформы',
  },
  [SIGNAL_ACTION.SUBMIT]: {
    from: [STATUS.YELLOW, STATUS.RED],
    to: STATUS.CONFIRM,
    report: true,
    allow: staffOnly,
  },
  [SIGNAL_ACTION.RESUBMIT_WORK]: {
    from: [STATUS.RETURNED],
    to: STATUS.CONFIRM,
    report: true,
    allow: staffOnly,
  },
  [SIGNAL_ACTION.CONFIRM]: {
    from: [STATUS.CONFIRM],
    to: STATUS.GREEN,
    allow: (signal, actor) =>
      isAuthor(signal, actor) || 'Подтвердить выполнение может только автор сигнала',
  },
  [SIGNAL_ACTION.RETURN]: {
    from: [STATUS.CONFIRM],
    to: STATUS.RETURNED,
    comment: true,
    allow: (signal, actor) =>
      isAuthor(signal, actor) || 'Вернуть сигнал на доработку может только его автор',
  },
  [SIGNAL_ACTION.RESOLVE]: {
    // Автор закрывает свою проблему на любом этапе — она могла решиться сама.
    // Пока результат на проверке, для этого есть «Подтвердить выполнение».
    from: OPEN_STATUSES.filter((status) => status !== STATUS.CONFIRM),
    to: STATUS.GREEN,
    allow: (signal, actor) =>
      isAuthor(signal, actor) ||
      'Закрыть сигнал может только его автор — ответственный направляет результат на подтверждение',
  },
  [SIGNAL_ACTION.REJECT]: {
    from: OPEN_STATUSES,
    to: STATUS.GRAY,
    comment: true,
    allow: (signal, actor) =>
      isSuperadminRole(actor?.role) || 'Отклонить сигнал может только главный администратор',
  },
};

/**
 * Проверка права на действие.
 * @returns {{allowed: boolean, reason?: string}}
 */
export function can(action, signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  const rule = WORKFLOW[action];
  if (!rule) return { allowed: false, reason: 'Действие не предусмотрено' };

  if (!rule.from.includes(signal.status)) {
    const meta = STATUS_META[signal.status];
    if (meta?.terminal) return { allowed: false, reason: `Сигнал закрыт («${meta.label}») — сначала возобновите его` };
    return { allowed: false, reason: `В статусе «${meta?.label ?? signal.status}» это действие недоступно` };
  }

  const verdict = rule.allow(signal, actor);
  return verdict === true ? { allowed: true } : { allowed: false, reason: verdict || 'Недостаточно прав' };
}

/** Обязателен ли комментарий к действию. */
export function requiresComment(action) {
  return Boolean(WORKFLOW[action]?.comment);
}

/** Действие сдает работу подрядчику — к нему нужен отчет. */
export function requiresReport(action) {
  return Boolean(WORKFLOW[action]?.report);
}

/** Какое действие отправляет результат на подтверждение из текущего статуса. */
export function submitActionFor(signal) {
  return signal?.status === STATUS.RETURNED ? SIGNAL_ACTION.RESUBMIT_WORK : SIGNAL_ACTION.SUBMIT;
}

/** Сохранить или дополнить отчет можно, пока сигнал в работе у ответственного. */
export function canReport(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!WORK_STATUSES.includes(signal.status)) {
    return { allowed: false, reason: 'Отчет заполняется, пока сигнал в работе' };
  }
  const verdict = staffOnly(signal, actor);
  return verdict === true ? { allowed: true } : { allowed: false, reason: verdict };
}

/* ------------------------------- статусы и время ------------------------------- */

export function isTerminal(status) {
  return Boolean(STATUS_META[status]?.terminal);
}

/** Сигнал открыт — еще не решен и не отклонен (в том числе на входном контроле). */
export function isActive(status) {
  return Boolean(STATUS_META[status]) && !isTerminal(status);
}

/** Сигнал в работе у ответственного. */
export function isInWork(status) {
  return WORK_STATUSES.includes(status);
}

/** Часы сигнала стоят: доработка у подрядчика или закрытие. */
export function isPaused(status) {
  return Boolean(STATUS_META[status]?.paused);
}

/** Суммарное время, когда часы сигнала стояли. */
export function pausedMs(signal) {
  return Math.max(0, Number(signal?.pausedMs) || 0);
}

/** Записи ленты, фиксирующие статус после события, — в хронологическом порядке. */
function chronology(signal) {
  return [...(signal?.history ?? [])].filter((entry) => entry.to).sort((a, b) => a.at - b.at);
}

/**
 * Сколько всего сигнал провел в статусе — по ленте истории.
 *
 * Каждая запись ленты хранит статус после события, поэтому лента и есть
 * последовательность отрезков «с этого момента сигнал был в таком-то статусе».
 * Последний отрезок открыт и длится до сих пор.
 */
export function timeInStatus(signal, status, now = Date.now()) {
  const entries = chronology(signal);
  if (!entries.length) return signal?.status === status ? Math.max(0, now - signal.createdAt) : 0;

  let total = 0;
  entries.forEach((entry, index) => {
    if (entry.to !== status) return;
    const next = entries[index + 1];
    const end = next ? next.at : signal.status === status ? now : entry.at;
    total += Math.max(0, end - entry.at);
  });
  return total;
}

/** Момент входа в текущий статус по ленте: начало последнего непрерывного отрезка. */
function currentStatusSince(signal) {
  const entries = chronology(signal);
  let since = null;
  for (let i = entries.length - 1; i >= 0 && entries[i].to === signal.status; i -= 1) since = entries[i].at;
  return since ?? signal.statusAt ?? signal.createdAt;
}

/**
 * Время в статусе с последней передачи сигнала в работу.
 *
 * Все, что было до последнего входного контроля, в срок не идет. Это важно
 * для сигналов прошлой версии: нераспределенные тогда тоже жили в Желтом,
 * и без этой границы срок у них оказывался исчерпан в момент распределения.
 */
function workTimeInStatus(signal, status, now) {
  const entries = chronology(signal);
  let start = 0;
  entries.forEach((entry, index) => {
    if (entry.to === STATUS.INTAKE) start = index + 1;
  });
  return timeInStatus({ ...signal, history: entries.slice(start) }, status, now);
}

/**
 * Момент, в который сигнал должен быть эскалирован; null — если эскалировать нечего.
 *
 * У Желтого порог считается по суммарному времени в Желтом после передачи
 * в работу: входной контроль, проверка результата подрядчиком и закрытые
 * периоды в срок не засчитываются. У возвращенного на доработку — 48 часов
 * с момента возврата: на каждый круг доработки у ответственного свой срок.
 */
export function escalationDueAt(signal, now = Date.now()) {
  if (signal?.status === STATUS.YELLOW) return now + ESCALATION_MS - workTimeInStatus(signal, STATUS.YELLOW, now);
  if (signal?.status === STATUS.RETURNED) return currentStatusSince(signal) + ESCALATION_MS;
  return null;
}

export function isEscalationDue(signal, now = Date.now()) {
  const due = escalationDueAt(signal, now);
  return due !== null && now >= due;
}

/**
 * Время решения: сколько сигнал реально прожил как проблема.
 * Пока часы стоят (доработка у подрядчика, закрытие), значение замирает
 * на моменте входа в этот статус; паузы прошлых периодов вычтены.
 */
export function resolutionMs(signal, now = Date.now()) {
  if (!signal) return 0;
  const end = isPaused(signal.status) ? (signal.statusAt ?? signal.closedAt ?? signal.updatedAt) : now;
  return Math.max(0, end - signal.createdAt - pausedMs(signal));
}

/* -------------------------------- возобновление -------------------------------- */

/**
 * Статус, в который вернется закрытый сигнал при возобновлении, — последний
 * рабочий, в котором он побывал. Нераспределенный сигнал возвращается
 * на входной контроль: работать с ним без категории некому.
 */
export function reopenTargetStatus(signal) {
  if (!signal?.category) return STATUS.INTAKE;
  const entries = chronology(signal);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isInWork(entries[i].to)) return entries[i].to;
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

/* ---------------------------- правка и комментарии ----------------------------- */

/**
 * Право редактировать карточку.
 * Сотрудник правит любую; автор — только свою и пока она не закрыта:
 * после терминального статуса запись становится историческим документом.
 */
export function canEdit(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (isStaffRole(actor?.role)) return { allowed: true };
  if (!isAuthor(signal, actor)) return { allowed: false, reason: 'Редактировать может автор или администратор' };
  if (isTerminal(signal.status)) {
    return { allowed: false, reason: 'Сигнал закрыт — редактирование недоступно' };
  }
  return { allowed: true };
}

/** Комментировать сигнал могут его автор и сотрудники, которым он виден. */
export function canComment(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (isAuthor(signal, actor) || isStaffRole(actor?.role)) return { allowed: true };
  return { allowed: false, reason: 'Комментировать может автор сигнала или сотрудник платформы' };
}

/* ------------------------------ ответственные -------------------------------- */

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
  if (!isSuperadminRole(actor?.role)) {
    return { allowed: false, reason: 'Состав кураторов ведет только главный администратор' };
  }
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт' };
  if (isAssignedTo(signal, actor.id)) return { allowed: false, reason: 'Этот сигнал уже за вами' };
  return { allowed: true };
}

/**
 * Назначить на сигнал кураторов (раздел «Входной контроль» и карточка сигнала).
 * Это не «принять в работу себя», а раздача задачи руководителям, и занимаются
 * ею только администраторы: руководитель ведет свои задачи, но не раздает чужие.
 * Нераспределенному сигналу ответственных выдают вместе с категорией —
 * при распределении на входном контроле.
 */
export function canAssignOthers(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (!isSuperadminRole(actor?.role)) {
    return { allowed: false, reason: 'Назначать кураторов может только главный администратор' };
  }
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт — сначала возобновите его' };
  if (!signal.category) return { allowed: false, reason: 'Сигнал еще на входном контроле — сначала распределите его' };
  return { allowed: true };
}

/**
 * Может ли этот человек стать ответственным за сигнал.
 *
 * Администраторы и главный администратор видят весь поток и отвечают за него
 * целиком, поэтому их можно назначить на любой сигнал.
 *
 * Руководитель — исполнитель по своей специализации: он попадает в список
 * только для сигналов тех категорий, которые за ним закреплены. Раздавать
 * задачи «мимо специализации» система по-прежнему не дает.
 */
export function canCurate(user, category) {
  const role = user?.role;
  if (isSuperadminRole(role) || role === ROLE.ADMIN) return true;
  if (role !== ROLE.MANAGER) return false;
  if (!category) return false; // нераспределенный сигнал руководителю вести не по чему
  return (user.categories ?? []).includes(category);
}

/**
 * Снять куратора с задачи. Как и назначение — только главный администратор:
 * состав ответственных целиком его зона, самостоятельно из задачи не выходят.
 */
export function canRelease(signal, actor, userId = actor?.id) {
  if (!assignees(signal).length) return { allowed: false, reason: 'Сигнал никем не принят' };
  if (!isSuperadminRole(actor?.role)) {
    return { allowed: false, reason: 'Снимать кураторов может только главный администратор' };
  }
  if (!isAssignedTo(signal, userId)) return { allowed: false, reason: 'Этот куратор не ведет сигнал' };
  return { allowed: true };
}

/**
 * Распределить сигнал по категории может только главный администратор:
 * на входном контроле это передача в работу, у сигнала в работе — смена
 * категории. Сигнал на доработке у подрядчика распределять рано: сначала
 * он должен вернуться на проверку.
 */
export function canDistribute(signal, actor) {
  if (!signal) return { allowed: false, reason: 'Сигнал не найден' };
  if (actor?.role !== ROLE.SUPERADMIN) {
    return { allowed: false, reason: 'Распределять сигналы может только главный администратор' };
  }
  if (isTerminal(signal.status)) return { allowed: false, reason: 'Сигнал закрыт' };
  if (signal.status === STATUS.REWORK) {
    return { allowed: false, reason: 'Сигнал на доработке у подрядчика — распределить его можно после повторной проверки' };
  }
  return { allowed: true };
}
