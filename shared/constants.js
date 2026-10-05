/**
 * Общий словарь предметной области. Модуль импортируется И сервером (как ESM),
 * И браузером (как статика по /shared/constants.js) — единый источник правды,
 * никаких расхождений между валидацией на клиенте и на сервере.
 */

export const ROLE = {
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
  MANAGER: 'manager',
  SUPERADMIN: 'superadmin',
  SYSTEM: 'system',
};

export const ROLE_LABEL = {
  [ROLE.CONTRACTOR]: 'Подрядчик',
  [ROLE.ADMIN]: 'Администратор',
  [ROLE.MANAGER]: 'Руководитель',
  [ROLE.SUPERADMIN]: 'Главный администратор',
  [ROLE.SYSTEM]: 'Система',
};

/** Администраторы обеих разновидностей. */
export const isAdminRole = (role) => role === ROLE.ADMIN || role === ROLE.SUPERADMIN;

/** Главный администратор — единственный, кто ведет состав кураторов и роли. */
export const isSuperadminRole = (role) => role === ROLE.SUPERADMIN;

/**
 * Сотрудники платформы: администраторы и руководители. Им доступны дашборд,
 * карточки сигналов и работа со статусами; отличие руководителя от
 * администратора — только в наборе курируемых категорий.
 */
export const isStaffRole = (role) => isAdminRole(role) || role === ROLE.MANAGER;

/** Роли, чей доступ ограничен списком категорий. */
export const isCategoryScopedRole = (role) => role === ROLE.ADMIN || role === ROLE.MANAGER;

/**
 * Порядок должностей в списках. Списки сотрудников сортируются по нему,
 * а не по времени создания: должность — то, по чему человека ищут глазами.
 */
export const ROLE_RANK = {
  [ROLE.SUPERADMIN]: 0,
  [ROLE.ADMIN]: 1,
  [ROLE.MANAGER]: 2,
  [ROLE.CONTRACTOR]: 3,
};

export const roleRank = (role) => ROLE_RANK[role] ?? 99;

/**
 * Типы учетных записей, которые главный администратор заводит вручную.
 * Подрядчик в список не входит: он регистрируется сам.
 */
export const ACCOUNT_TYPES = [
  {
    id: ROLE.ADMIN,
    label: 'Администратор',
    hint: 'Видит сигналы отмеченных категорий и управляет ими.',
    categoriesLabel: 'Видимые категории сигналов',
    categoriesHint: 'Администратор увидит на дашборде только отмеченные категории. Набор можно изменить позже.',
  },
  {
    id: ROLE.MANAGER,
    label: 'Руководитель',
    hint: 'Отвечает за курируемые категории и попадает в списки для распределения.',
    categoriesLabel: 'Курируемые категории',
    categoriesHint:
      'Руководителю видны сигналы этих категорий, и он отображается в списках выбора при распределении.',
  },
  {
    id: ROLE.SUPERADMIN,
    label: 'Главный админ',
    hint: 'Полный доступ: распределение сигналов и управление учетными записями.',
    categoriesLabel: 'Категории',
    categoriesHint: 'Главному администратору доступны все категории — выбор не требуется.',
  },
];

export const ACCOUNT_TYPE_IDS = ACCOUNT_TYPES.map((type) => type.id);

export function accountType(role) {
  return ACCOUNT_TYPES.find((type) => type.id === role) ?? ACCOUNT_TYPES[0];
}

/* --------------------------------- Сигналы ---------------------------------- */

/**
 * Путь сигнала: входной контроль → работа у ответственного → закрытие.
 *
 *   • intake / rework — входной контроль: главный администратор проверяет,
 *     хватает ли данных, и либо распределяет сигнал, либо возвращает его
 *     подрядчику на доработку;
 *   • yellow / red — сигнал в работе у ответственного (красный — просрочен);
 *   • green / gray — закрыт (решен либо отклонен).
 */
export const STATUS = {
  INTAKE: 'intake',
  REWORK: 'rework',
  YELLOW: 'yellow',
  RED: 'red',
  GREEN: 'green',
  GRAY: 'gray',
};

export const STATUS_ORDER = [STATUS.INTAKE, STATUS.REWORK, STATUS.YELLOW, STATUS.RED, STATUS.GREEN, STATUS.GRAY];

/**
 * `paused` — часы сигнала стоят: мяч на стороне подрядчика или сигнал закрыт.
 * Это время не идет ни в срок эскалации, ни во время решения.
 */
export const STATUS_META = {
  [STATUS.INTAKE]: {
    id: STATUS.INTAKE,
    label: 'На входном контроле',
    short: 'Входной контроль',
    terminal: false,
    paused: false,
    hint: 'Главный администратор проверяет, достаточно ли данных, чтобы передать сигнал в работу.',
  },
  [STATUS.REWORK]: {
    id: STATUS.REWORK,
    label: 'На доработке у подрядчика',
    short: 'У подрядчика',
    terminal: false,
    paused: true,
    hint: 'Данных для работы недостаточно: подрядчик дополняет сигнал и отправляет его на повторную проверку.',
  },
  [STATUS.YELLOW]: {
    id: STATUS.YELLOW,
    label: 'В работе',
    short: 'Желтый',
    terminal: false,
    paused: false,
    hint: 'Сигнал прошел входной контроль и находится в работе у ответственного.',
  },
  [STATUS.RED]: {
    id: STATUS.RED,
    label: 'Критичная проблема',
    short: 'Красный',
    terminal: false,
    paused: false,
    hint: 'Проблема в работе дольше 48 часов — эскалирована системой или вручную.',
  },
  [STATUS.GREEN]: {
    id: STATUS.GREEN,
    label: 'Проблема решена',
    short: 'Зеленый',
    terminal: true,
    paused: true,
    hint: 'Терминальный статус. Устанавливается автором или сотрудником.',
  },
  [STATUS.GRAY]: {
    id: STATUS.GRAY,
    label: 'Отклонен',
    short: 'Серый',
    terminal: true,
    paused: true,
    hint: 'Терминальный статус. Устанавливается только сотрудником.',
  },
};

/** Статусы входного контроля — сигнал еще не распределен. */
export const INTAKE_STATUSES = [STATUS.INTAKE, STATUS.REWORK];

/** Статусы работы у ответственного — то, что видно на карте сигналов как «активное». */
export const WORK_STATUSES = [STATUS.YELLOW, STATUS.RED];

/** Статусы, которые бывают у распределенного сигнала, — колонки и фильтры дашборда. */
export const DASHBOARD_STATUSES = STATUS_ORDER.filter((status) => !INTAKE_STATUSES.includes(status));

/* -------------------------------- Действия ----------------------------------- */

/**
 * Действия с сигналом. Один словарь на историю, права и письма: каждое
 * действие — запись в ленте и письмо участникам с одной и той же темой.
 */
export const SIGNAL_ACTION = {
  CREATE: 'create',
  INTAKE_RETURN: 'intake-return',
  UPDATE: 'update',
  RESUBMIT: 'resubmit',
  DISTRIBUTE: 'distribute',
  ASSIGN: 'assign',
  COMMENT: 'comment',
  ESCALATE: 'escalate',
  RESOLVE: 'resolve',
  REJECT: 'reject',
  REOPEN: 'reopen',
};

/** Подпись действия — заголовок письма и строка в ленте событий. */
export const SIGNAL_ACTION_LABEL = {
  [SIGNAL_ACTION.CREATE]: 'Сигнал создан',
  [SIGNAL_ACTION.INTAKE_RETURN]: 'Возвращен подрядчику на доработку',
  [SIGNAL_ACTION.UPDATE]: 'Сигнал дополнен',
  [SIGNAL_ACTION.RESUBMIT]: 'Доработан и направлен на повторную проверку',
  [SIGNAL_ACTION.DISTRIBUTE]: 'Прошел входной контроль и распределен',
  [SIGNAL_ACTION.ASSIGN]: 'Назначен ответственный',
  [SIGNAL_ACTION.COMMENT]: 'Комментарий',
  [SIGNAL_ACTION.ESCALATE]: 'Сигнал стал критичным',
  [SIGNAL_ACTION.RESOLVE]: 'Сигнал закрыт',
  [SIGNAL_ACTION.REJECT]: 'Сигнал отклонен',
  [SIGNAL_ACTION.REOPEN]: 'Сигнал возобновлен',
};

/** Предельная длина комментария, отчета и пояснения к возврату. */
export const MAX_COMMENT_LENGTH = 4000;

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

/** Сквозной номер сигнала для интерфейса и писем: «№125». */
export function signalNumber(signal) {
  return signal?.number ? `№${signal.number}` : '';
}

const TOPIC_LENGTH = 80;

/**
 * Тема сигнала — коротко о сути проблемы, из описания: первое предложение,
 * если оно содержательное и короткое, иначе начало текста по границе слова.
 *
 * Вычисляется один раз при создании и дальше не меняется, даже когда
 * описание правят: по неизменной теме почтовый клиент собирает все письма
 * сигнала в одну цепочку.
 */
export function deriveSignalTopic(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Без описания';

  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1];
  let topic = sentence && sentence.length >= 10 && sentence.length <= TOPIC_LENGTH ? sentence : text;

  if (topic.length > TOPIC_LENGTH) {
    const cut = topic.slice(0, TOPIC_LENGTH);
    const space = cut.lastIndexOf(' ');
    topic = `${(space > TOPIC_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
  }
  return topic.replace(/\.$/, '');
}

/** Видит ли сотрудник сигнал этой категории. */
export function canSeeCategory(user, category) {
  if (user?.role === ROLE.SUPERADMIN) return true;
  if (!isCategoryScopedRole(user?.role)) return false;
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
  NOTE: 'note',
  REOPEN: 'reopen',
  COMMENT: 'comment',
};

export const HISTORY_KIND_LABEL = {
  [HISTORY_KIND.CREATE]: 'Создано',
  [HISTORY_KIND.STATUS]: 'Смена статуса',
  [HISTORY_KIND.EDIT]: 'Редактирование',
  [HISTORY_KIND.ASSIGN]: 'Назначен куратор',
  [HISTORY_KIND.RELEASE]: 'Куратор снят',
  [HISTORY_KIND.CATEGORY]: 'Распределение',
  [HISTORY_KIND.NOTE]: 'Заметка',
  [HISTORY_KIND.REOPEN]: 'Возобновление',
  [HISTORY_KIND.COMMENT]: 'Комментарий',
};

/**
 * Записи ленты, которые видит автор-подрядчик: все, что касается движения
 * его проблемы и переписки по ней. Внутренняя кухня — заметка кураторам,
 * смена категории, снятие исполнителя — остается у сотрудников.
 */
export const PUBLIC_HISTORY_KINDS = [
  HISTORY_KIND.CREATE,
  HISTORY_KIND.STATUS,
  HISTORY_KIND.REOPEN,
  HISTORY_KIND.EDIT,
  HISTORY_KIND.ASSIGN,
  HISTORY_KIND.COMMENT,
];

/** Фильтр по принятию в работу. `all` — ничего не выбрано, показываются все. */
export const ASSIGNMENT = {
  ALL: 'all',
  ASSIGNED: 'assigned',
  FREE: 'free',
};

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

/** Ссылка восстановления пароля живет меньше: она дает вход в учетную запись. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Настройки почтовых уведомлений — один общий тумблер.
 *
 * Выбора отдельных событий больше нет: по сигналу приходит письмо о каждом
 * действии, и все письма одного сигнала складываются в почте в одну цепочку.
 * Выборочная подписка рвала бы эту цепочку посередине. КОМУ адресовано
 * письмо, решает сервер (см. recipientsFor в server/mail/notifier.js).
 */
export const DEFAULT_NOTIFY = Object.freeze({ enabled: true });

export function normalizeNotify(value) {
  const source = value && typeof value === 'object' ? value : {};
  return { enabled: source.enabled !== false };
}

/** Нужно ли слать письма этому получателю. */
export function wantsNotification(notify) {
  return normalizeNotify(notify).enabled;
}

/* ------------------------------- оформление ---------------------------------- */

export const THEME = { DARK: 'dark', LIGHT: 'light' };

export const THEMES = [
  { id: THEME.DARK, label: 'Темная', icon: '☾' },
  { id: THEME.LIGHT, label: 'Светлая', icon: '☀' },
];

export const THEME_STORAGE_KEY = 'sms-theme';

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
