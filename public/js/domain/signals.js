/**
 * Сигналы на стороне клиента: выборки из снимка состояния и вызовы API.
 * Права проверяются здесь только для отображения — решение всегда за сервером.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { ASSIGNMENT, STATUS } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';

export function listMine() {
  return store.getState().mySignals ?? [];
}

/** Все доступные администратору сигналы (иначе null). */
export function listAll() {
  return store.getState().allSignals;
}

/** Раздел «Распределение» — только для главного администратора (иначе null). */
export function listUndistributed() {
  return store.getState().undistributed;
}

export function findMine(id) {
  return listMine().find((signal) => signal.id === id) ?? null;
}

export function findAny(id) {
  const pools = [listAll() ?? [], listUndistributed() ?? []];
  for (const pool of pools) {
    const found = pool.find((signal) => signal.id === id);
    if (found) return found;
  }
  return findMine(id);
}

export function authorLabel(signalId) {
  return store.getState().authorLabels?.[signalId] ?? '—';
}

export function filterSignals(signals, { category = 'all', status = 'all', assignment = ASSIGNMENT.ALL } = {}) {
  return signals.filter((signal) => {
    const categoryOk =
      category === 'all' || (category === 'none' ? !signal.category : signal.category === category);
    const statusOk = status === 'all' || (status === 'active' ? isActive(signal.status) : signal.status === status);
    const taken = (signal.assignees ?? []).length > 0;
    const assignmentOk = assignment === ASSIGNMENT.ALL || (assignment === ASSIGNMENT.ASSIGNED ? taken : !taken);
    return categoryOk && statusOk && assignmentOk;
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

export async function updateSignal(id, input) {
  const result = await api.updateSignal(id, input);
  await store.refresh();
  return result.signal;
}

/** Назначить категорию — действие раздела «Распределение». */
export async function distribute(id, category) {
  const result = await api.distributeSignal(id, category);
  await store.refresh();
  return result.signal;
}

/**
 * Принять в работу (`assign = true`) или снять исполнителя.
 * `userId` позволяет администратору снять коллегу, а не только себя.
 */
export async function setAssignee(id, assign, userId) {
  const result = await api.assignSignal(id, assign, userId);
  await store.refresh();
  return result.signal;
}

/** Демо-инструмент: сдвиг меток времени, чтобы увидеть работу автоэскалации. */
export async function ageSignal(id) {
  const result = await api.ageSignal(id);
  await store.refresh();
  return result.signal;
}
