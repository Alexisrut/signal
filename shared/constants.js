/**
 * Общий словарь предметной области. Модуль импортируется И сервером (как ESM),
 * И браузером (как статика по /shared/constants.js) — единый источник правды,
 * никаких расхождений между валидацией на клиенте и на сервере.
 */

export const ROLE = {
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
  SYSTEM: 'system',
};

/* --------------------------------- Сигналы ---------------------------------- */

export const STATUS = {
  YELLOW: 'yellow',
  RED: 'red',
  GREEN: 'green',
  GRAY: 'gray',
};

export const STATUS_ORDER = [STATUS.YELLOW, STATUS.RED, STATUS.GREEN, STATUS.GRAY];

export const STATUS_META = {
  [STATUS.YELLOW]: {
    id: STATUS.YELLOW,
    label: 'Новая проблема',
    short: 'Желтый',
    terminal: false,
    hint: 'Сигнал создан и ожидает решения.',
  },
  [STATUS.RED]: {
    id: STATUS.RED,
    label: 'Критичная проблема',
    short: 'Красный',
    terminal: false,
    hint: 'Проблема не решена более 48 часов — эскалирована системой.',
  },
  [STATUS.GREEN]: {
    id: STATUS.GREEN,
    label: 'Проблема решена',
    short: 'Зеленый',
    terminal: true,
    hint: 'Терминальный статус. Устанавливается автором или администратором.',
  },
  [STATUS.GRAY]: {
    id: STATUS.GRAY,
    label: 'Отклонен',
    short: 'Серый',
    terminal: true,
    hint: 'Терминальный статус. Устанавливается только администратором.',
  },
};

/** `null` — линия пропущена при создании сигнала. */
export const LINE = {
  LEGAL: 'legal',
  SUPPLY: 'supply',
  DESIGN: 'design',
  NONE: null,
};

export const LINES = [
  { id: LINE.LEGAL, label: 'Юридическая', hint: 'Договоры, претензии, согласования' },
  { id: LINE.SUPPLY, label: 'Поставка', hint: 'Материалы, сроки, логистика' },
  { id: LINE.DESIGN, label: 'Проектирование', hint: 'Чертежи, РД, изменения проекта' },
];

export const NO_LINE_LABEL = 'Без линии';

/** Ключ, которым «отсутствие линии» кодируется в URL, настройках и фильтрах. */
export const NO_LINE_KEY = 'none';

export function lineLabel(lineId) {
  if (lineId === LINE.NONE || lineId === undefined) return NO_LINE_LABEL;
  return LINES.find((l) => l.id === lineId)?.label ?? NO_LINE_LABEL;
}

/** Все колонки «карты сигналов»: три линии + корзина «Без линии». */
export const LINE_COLUMNS = [...LINES, { id: LINE.NONE, label: NO_LINE_LABEL, hint: 'Линия пропущена автором' }];

/** Значения, допустимые в настройке `notifyLines`. */
export const NOTIFY_LINE_KEYS = [...LINES.map((l) => l.id), NO_LINE_KEY];

export function lineToKey(line) {
  return line === LINE.NONE ? NO_LINE_KEY : line;
}

export function keyToLine(key) {
  return key === NO_LINE_KEY || key === null || key === undefined ? LINE.NONE : key;
}

/** 48 часов — порог автоматической эскалации Желтый → Красный. */
export const ESCALATION_MS = 48 * 60 * 60 * 1000;

/** Период опроса фонового процесса эскалации на сервере. */
export const WORKER_TICK_MS = 5_000;

/** Период «тика» интерфейса — обновляет счетчики возраста/до эскалации. */
export const UI_TICK_MS = 15_000;

export const SYSTEM_ACTOR = Object.freeze({
  id: 'system',
  role: ROLE.SYSTEM,
  displayName: 'Система',
});

/* ---------------------------------- Задачи ----------------------------------- */

export const TASK_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
};

export const TASK_STATUS_ORDER = [TASK_STATUS.OPEN, TASK_STATUS.IN_PROGRESS, TASK_STATUS.DONE];

export const TASK_STATUS_META = {
  [TASK_STATUS.OPEN]: { id: TASK_STATUS.OPEN, label: 'Открыта', hint: 'Задача заведена и ждет исполнителя.' },
  [TASK_STATUS.IN_PROGRESS]: { id: TASK_STATUS.IN_PROGRESS, label: 'В работе', hint: 'Задача взята в работу.' },
  [TASK_STATUS.DONE]: { id: TASK_STATUS.DONE, label: 'Завершена', hint: 'Задача выполнена.' },
};

/* ------------------------------- Уведомления --------------------------------- */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Время жизни токена подтверждения почты. */
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Селектор «все линии» в настройке notifyLines. */
export const NOTIFY_ALL_LINES = 'all';

export const NOTIFICATION_EVENT = {
  CREATE: 'create',
  RED: 'red',
  RESOLVE: 'resolve',
};

/** Какой флаг настроек отвечает за каждое событие конечного автомата. */
export const NOTIFICATION_TRIGGERS = {
  [NOTIFICATION_EVENT.CREATE]: {
    setting: 'notifyOnCreate',
    label: 'Уведомление при создании проблемы',
  },
  [NOTIFICATION_EVENT.RED]: {
    setting: 'notifyOnRed',
    label: 'Уведомление при попадании проблемы в красный сигнал',
  },
  [NOTIFICATION_EVENT.RESOLVE]: {
    setting: 'notifyOnResolve',
    label: 'Уведомление при решении/отклонении проблемы',
  },
};

export const DEFAULT_ADMIN_SETTINGS = Object.freeze({
  notificationsEnabled: true,
  notifyLines: NOTIFY_ALL_LINES,
  notifyOnCreate: true,
  notifyOnRed: true,
  notifyOnResolve: false,
  tasksDashboardEnabled: true,
});

/** Приводит произвольный объект настроек к валидной форме (используется на обоих концах). */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

  let notifyLines = source.notifyLines;
  if (notifyLines !== NOTIFY_ALL_LINES) {
    const list = Array.isArray(notifyLines) ? notifyLines.filter((key) => NOTIFY_LINE_KEYS.includes(key)) : [];
    // Выбраны все линии до единой — сворачиваем в селектор «Все».
    notifyLines = list.length === NOTIFY_LINE_KEYS.length ? NOTIFY_ALL_LINES : list;
  }

  return {
    notificationsEnabled: bool(source.notificationsEnabled, DEFAULT_ADMIN_SETTINGS.notificationsEnabled),
    notifyLines: notifyLines ?? DEFAULT_ADMIN_SETTINGS.notifyLines,
    notifyOnCreate: bool(source.notifyOnCreate, DEFAULT_ADMIN_SETTINGS.notifyOnCreate),
    notifyOnRed: bool(source.notifyOnRed, DEFAULT_ADMIN_SETTINGS.notifyOnRed),
    notifyOnResolve: bool(source.notifyOnResolve, DEFAULT_ADMIN_SETTINGS.notifyOnResolve),
    tasksDashboardEnabled: bool(source.tasksDashboardEnabled, DEFAULT_ADMIN_SETTINGS.tasksDashboardEnabled),
  };
}

/** Подписан ли администратор на события по линии сигнала. */
export function watchesLine(settings, line) {
  if (settings.notifyLines === NOTIFY_ALL_LINES) return true;
  return Array.isArray(settings.notifyLines) && settings.notifyLines.includes(lineToKey(line));
}

/* --------------------------------- Вложения ---------------------------------- */

export const MAX_FILE_SIZE = 15 * 1024 * 1024;

export const ALLOWED_FILE_TYPES = [
  { ext: 'pdf', mime: 'application/pdf', icon: '📕' },
  { ext: 'doc', mime: 'application/msword', icon: '📘' },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    icon: '📘',
  },
  { ext: 'xls', mime: 'application/vnd.ms-excel', icon: '📗' },
  {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    icon: '📗',
  },
  { ext: 'jpg', mime: 'image/jpeg', icon: '🖼' },
  { ext: 'jpeg', mime: 'image/jpeg', icon: '🖼' },
  { ext: 'png', mime: 'image/png', icon: '🖼' },
  { ext: 'txt', mime: 'text/plain', icon: '📄' },
];

export const ALLOWED_EXTENSIONS = ALLOWED_FILE_TYPES.map((type) => type.ext);

export function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename ?? ''));
  return match ? match[1].toLowerCase() : '';
}

export function isAllowedFilename(filename) {
  return ALLOWED_EXTENSIONS.includes(extensionOf(filename));
}

export function mimeForFilename(filename) {
  const ext = extensionOf(filename);
  return ALLOWED_FILE_TYPES.find((type) => type.ext === ext)?.mime ?? 'application/octet-stream';
}

export function iconForFile(file) {
  const byMime = ALLOWED_FILE_TYPES.find((type) => type.mime === file?.mime);
  if (byMime) return byMime.icon;
  return ALLOWED_FILE_TYPES.find((type) => type.ext === extensionOf(file?.filename))?.icon ?? '📎';
}

export function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

export const DEFAULT_ADMIN = Object.freeze({
  login: 'admin',
  password: 'admin123',
  email: 'admin@signal.local',
  displayName: 'Главный администратор',
});
