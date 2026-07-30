/**
 * Единый словарь предметной области: статусы, линии, роли, пороги.
 * Ни один слой (UI / domain / data) не хардкодит строковые литералы статусов.
 */

export const ROLE = {
  CONTRACTOR: 'contractor',
  ADMIN: 'admin',
  SYSTEM: 'system',
};

export const STATUS = {
  YELLOW: 'yellow',
  RED: 'red',
  GREEN: 'green',
  GRAY: 'gray',
};

/** Порядок отображения статусов в легенде и фильтрах. */
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

export function lineLabel(lineId) {
  if (lineId === LINE.NONE || lineId === undefined) return NO_LINE_LABEL;
  return LINES.find((l) => l.id === lineId)?.label ?? NO_LINE_LABEL;
}

/** Все колонки «карты сигналов»: три линии + корзина «Без линии». */
export const LINE_COLUMNS = [...LINES, { id: LINE.NONE, label: NO_LINE_LABEL, hint: 'Линия пропущена автором' }];

/** 48 часов — порог автоматической эскалации Желтый → Красный. */
export const ESCALATION_MS = 48 * 60 * 60 * 1000;

/** Период опроса фонового воркера (CRON-эмуляция). */
export const WORKER_TICK_MS = 5_000;

/** Период «тика» интерфейса — обновляет счетчики возраста/до эскалации. */
export const UI_TICK_MS = 15_000;

/** Псевдо-пользователь, от имени которого пишется автоматическая эскалация. */
export const SYSTEM_ACTOR = Object.freeze({
  id: 'system',
  role: ROLE.SYSTEM,
  displayName: 'Система',
});

export const DEFAULT_ADMIN = Object.freeze({
  login: 'admin',
  password: 'admin123',
  displayName: 'Главный администратор',
});
