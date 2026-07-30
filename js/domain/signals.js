/**
 * Сервис сигналов: создание, смена статуса, выборки.
 * Изоляция подрядчиков обеспечивается здесь: подрядчик получает данные
 * исключительно через `listByAuthor` / `getForActor`, а не из общего списка.
 */

import * as store from '../data/store.js';
import { STATUS, LINE, LINES, ROLE, SYSTEM_ACTOR } from '../core/constants.js';
import { uid, isBlank } from '../core/utils.js';
import { canTransition, isActive } from './state-machine.js';
import { ensureContractorRecord } from './auth.js';

const VALID_LINES = new Set([...LINES.map((l) => l.id), LINE.NONE]);

function historyEntry({ from, to, actor, at = Date.now(), note }) {
  return {
    at,
    from,
    to,
    byId: actor.id,
    byName: actor.displayName,
    byRole: actor.role,
    ...(note ? { note } : {}),
  };
}

/**
 * Валидация формы сигнала.
 * @returns {{valid: boolean, errors: Record<string,string>}}
 */
export function validateSignalInput({ contractorName, sector, description }) {
  const errors = {};
  if (isBlank(contractorName)) errors.contractorName = 'Укажите название подрядчика';
  if (isBlank(sector)) errors.sector = 'Укажите сектор работы';
  if (isBlank(description)) errors.description = 'Опишите проблему';
  else if (String(description).trim().length < 10) errors.description = 'Описание должно содержать минимум 10 символов';
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Создание сигнала. Статус ЖЕЛТЫЙ выставляется автоматически.
 * @returns {{ok: true, signal: object} | {ok: false, errors: object}}
 */
export function createSignal(input, actor) {
  const { valid, errors } = validateSignalInput(input);
  if (!valid) return { ok: false, errors };

  const line = VALID_LINES.has(input.line) ? input.line ?? LINE.NONE : LINE.NONE;
  const now = Date.now();

  const signal = {
    id: uid('sig'),
    authorId: actor.id,
    authorRole: actor.role,
    line,
    contractorName: String(input.contractorName).trim(),
    sector: String(input.sector).trim(),
    description: String(input.description).trim(),
    status: STATUS.YELLOW,
    createdAt: now,
    updatedAt: now,
    history: [historyEntry({ from: null, to: STATUS.YELLOW, actor, at: now, note: 'Сигнал создан' })],
  };

  store.mutate((draft) => {
    if (actor.role === ROLE.CONTRACTOR) ensureContractorRecord(draft, actor.id);
    draft.signals[signal.id] = signal;
  });

  return { ok: true, signal };
}

/**
 * Ручная или системная смена статуса. Все правила — в конечном автомате.
 * @returns {{ok: true, signal: object} | {ok: false, error: string}}
 */
export function changeStatus(signalId, to, actor, note) {
  return store.mutate((draft, abort) => {
    const signal = draft.signals[signalId];
    const verdict = canTransition(signal, to, actor);
    if (!verdict.allowed) {
      abort();
      return { ok: false, error: verdict.reason };
    }

    const from = signal.status;
    signal.status = to;
    signal.updatedAt = Date.now();
    signal.history.push(historyEntry({ from, to, actor, note }));
    return { ok: true, signal: structuredClone(signal) };
  });
}

/** Системная эскалация Желтый → Красный (вызывается только фоновым воркером). */
export function escalateToRed(signalId) {
  return changeStatus(signalId, STATUS.RED, SYSTEM_ACTOR, 'Автоэскалация: превышен порог 48 часов');
}

/* ---------------------------------- выборки ---------------------------------- */

const byUpdatedDesc = (a, b) => b.updatedAt - a.updatedAt;

export function listAll() {
  return Object.values(store.getState().signals).sort(byUpdatedDesc);
}

/** Изолированная выборка подрядчика: только собственные сигналы. */
export function listByAuthor(authorId) {
  return Object.values(store.getState().signals)
    .filter((signal) => signal.authorId === authorId)
    .sort(byUpdatedDesc);
}

/** Доступ к конкретному сигналу с учетом роли: подрядчик видит только свой. */
export function getForActor(signalId, actor) {
  const signal = store.getState().signals[signalId];
  if (!signal) return null;
  if (actor.role === ROLE.ADMIN) return signal;
  return signal.authorId === actor.id ? signal : null;
}

export function filterSignals(signals, { line = 'all', status = 'all' } = {}) {
  return signals.filter((signal) => {
    const lineOk = line === 'all' || (line === 'none' ? signal.line === LINE.NONE : signal.line === line);
    const statusOk = status === 'all' || (status === 'active' ? isActive(signal.status) : signal.status === status);
    return lineOk && statusOk;
  });
}

export function countByStatus(signals) {
  const counters = { total: signals.length, [STATUS.YELLOW]: 0, [STATUS.RED]: 0, [STATUS.GREEN]: 0, [STATUS.GRAY]: 0 };
  for (const signal of signals) counters[signal.status] += 1;
  return counters;
}

/**
 * ДЕМО-ИНСТРУМЕНТ. Сдвигает временные метки сигнала в прошлое,
 * чтобы можно было наблюдать работу автоэскалации без ожидания двух суток.
 * Сам статус не меняет — Красный по-прежнему выставит только воркер.
 */
export function ageSignal(signalId, ms) {
  return store.mutate((draft, abort) => {
    const signal = draft.signals[signalId];
    if (!signal) {
      abort();
      return { ok: false, error: 'Сигнал не найден' };
    }
    signal.createdAt -= ms;
    signal.updatedAt -= ms;
    signal.history = signal.history.map((entry) => ({ ...entry, at: entry.at - ms }));
    return { ok: true };
  });
}
