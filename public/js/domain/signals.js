/**
 * Сигналы на стороне клиента: выборки из снимка состояния и вызовы API.
 * Права проверяются здесь только для отображения — решение всегда за сервером.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { LINE, STATUS } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';

export function listMine() {
  return store.getState().mySignals ?? [];
}

/** Все сигналы системы — только для подтвержденного администратора (иначе null). */
export function listAll() {
  return store.getState().allSignals;
}

export function findMine(id) {
  return listMine().find((signal) => signal.id === id) ?? null;
}

export function findAny(id) {
  return (listAll() ?? []).find((signal) => signal.id === id) ?? findMine(id);
}

export function authorLabel(signalId) {
  return store.getState().authorLabels?.[signalId] ?? '—';
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

/* --------------------------------- действия ---------------------------------- */

export async function createSignal(input) {
  const result = await api.createSignal(input);
  await store.refresh();
  return result.signal;
}

export async function changeStatus(id, status) {
  const result = await api.changeSignalStatus(id, status);
  await store.refresh();
  return result.signal;
}

/** Демо-инструмент: сдвиг меток времени, чтобы увидеть работу автоэскалации. */
export async function ageSignal(id) {
  const result = await api.ageSignal(id);
  await store.refresh();
  return result.signal;
}
