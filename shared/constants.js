/**
 * Общий словарь предметной области. Модуль импортируется И сервером (как ESM),
 * И браузером (как статика по /shared/constants.js) — единый источник правды,
 * никаких расхождений между валидацией на клиенте и на сервере.
 */

export const ROLE = {
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
  SYSTEM: 'system',
};

export const ROLE_LABEL = {
  [ROLE.CONTRACTOR]: 'Подрядчик',
  [ROLE.ADMIN]: 'Администратор',
  [ROLE.SUPERADMIN]: 'Главный администратор',
  [ROLE.SYSTEM]: 'Система',
};

/** Администраторы обеих разновидностей. */
export const isAdminRole = (role) => role === ROLE.ADMIN || role === ROLE.SUPERADMIN;

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

/* -------------------------------- Категории ---------------------------------- */

/**
 * Категорию подрядчик не выбирает: сигнал приходит без нее и попадает
 * в раздел «Распределение», где главный администратор назначает категорию.
 * `null` — сигнал еще не распределен.
 */
export const CATEGORY = {
  ADMIN_FINANCE: 'admin_finance',
  DESIGN: 'design',
  SUPPLY: 'supply',
  OTHER: 'other',
  NONE: null,
};

export const CATEGORIES = [
  { id: CATEGORY.ADMIN_FINANCE, label: 'Административный/финансовый', short: 'Админ./финансы' },
  { id: CATEGORY.DESIGN, label: 'Проектирование', short: 'Проектирование' },
  { id: CATEGORY.SUPPLY, label: 'Поставка', short: 'Поставка' },
  { id: CATEGORY.OTHER, label: 'Разное', short: 'Разное' },
];

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id);

export const UNDISTRIBUTED_LABEL = 'Не распределен';

export function categoryLabel(id) {
  if (!id) return UNDISTRIBUTED_LABEL;
  return CATEGORIES.find((category) => category.id === id)?.label ?? UNDISTRIBUTED_LABEL;
}

export function categoryShort(id) {
  if (!id) return UNDISTRIBUTED_LABEL;
  return CATEGORIES.find((category) => category.id === id)?.short ?? UNDISTRIBUTED_LABEL;
}

export const isDistributed = (signal) => Boolean(signal?.category);

/** Видит ли администратор сигнал этой категории. */
export function canSeeCategory(user, category) {
  if (user?.role === ROLE.SUPERADMIN) return true;
  if (user?.role !== ROLE.ADMIN) return false;
  if (!category) return false; // нераспределенные видит только главный администратор
  return (user.categories ?? []).includes(category);
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

/* --------------------------- Исполнители и история ---------------------------- */

/**
 * «Фамилия И.О.» для компактных мест интерфейса.
 *
 * Инициалы собираются только когда все слова похожи на части ФИО (каждое
 * с заглавной). «Иванов Иван Сергеевич» → «Иванов И.С.», а «Главный
 * администратор» остается как есть — сокращать должность бессмысленно.
 */
export function formatShortName(displayName) {
  const parts = String(displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';

  const looksLikeName = parts.every((part) => part[0] === part[0].toUpperCase() && /^[\p{L}]/u.test(part));
  if (!looksLikeName) return parts.join(' ');

  const initials = parts.slice(1, 3).map((part) => `${part[0].toUpperCase()}.`).join('');
  return `${parts[0]} ${initials}`;
}

/** Виды событий в ленте истории сигнала. */
export const HISTORY_KIND = {
  CREATE: 'create',
  STATUS: 'status',
  EDIT: 'edit',
  ASSIGN: 'assign',
  RELEASE: 'release',
  CATEGORY: 'category',
};

export const HISTORY_KIND_LABEL = {
  [HISTORY_KIND.CREATE]: 'Создано',
  [HISTORY_KIND.STATUS]: 'Смена статуса',
  [HISTORY_KIND.EDIT]: 'Редактирование',
  [HISTORY_KIND.ASSIGN]: 'Принято в работу',
  [HISTORY_KIND.RELEASE]: 'Снято с исполнителя',
  [HISTORY_KIND.CATEGORY]: 'Распределение',
};

/** Фильтр по принятию в работу. `all` — ничего не выбрано, показываются все. */
export const ASSIGNMENT = {
  ALL: 'all',
  ASSIGNED: 'assigned',
  FREE: 'free',
};

export const ASSIGNMENT_FILTERS = [
  { id: ASSIGNMENT.ALL, label: 'Все' },
  { id: ASSIGNMENT.ASSIGNED, label: 'Принятые' },
  { id: ASSIGNMENT.FREE, label: 'Непринятые' },
];

/** Поля, доступные для редактирования, — и их подписи в истории правок. */
export const SIGNAL_FIELD_LABELS = {
  contractorName: 'Подрядчик',
  sector: 'Сектор работы',
  description: 'Описание',
};

/* ------------------------------- Уведомления --------------------------------- */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Время жизни токена подтверждения почты. */
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * События, по которым уходят письма. Фильтрация получателей убрана:
 * письмо получает каждый администратор с подтвержденной почтой.
 */
export const NOTIFICATION_EVENT = {
  CREATE: 'create',
  RED: 'red',
  RESOLVE: 'resolve',
};

export const NOTIFICATION_EVENT_LABEL = {
  [NOTIFICATION_EVENT.CREATE]: 'Новый сигнал в системе',
  [NOTIFICATION_EVENT.RED]: 'Сигнал стал критичным',
  [NOTIFICATION_EVENT.RESOLVE]: 'Сигнал закрыт',
};

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

/** Учетная запись главного администратора, создаваемая при первом запуске. */
export const DEFAULT_ADMIN = Object.freeze({
  login: 'admin',
  password: 'admin123',
  email: 'admin@signal.local',
  displayName: 'Главный администратор',
});
