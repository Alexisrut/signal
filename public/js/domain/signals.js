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

/** Сектор последнего сигнала текущего пользователя — для автоподстановки. */
export function lastSector() {
  return store.getState().lastSector ?? null;
}

/** Статистика решения задач по всей платформе (только для сотрудников). */
export function resolutionStats() {
  return store.getState().stats ?? null;
}

/**
 * Сколько изменений произошло по сигналу с момента последнего открытия карточки.
 * 0 — индикатор не показывается вовсе.
 */
export function unreadCount(signalId) {
  return store.getState().unread?.[signalId] ?? 0;
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

/** Вернуть закрытый сигнал в активную фазу — отсчет времени решения продолжится. */
export async function reopenSignal(id, note) {
  const result = await api.reopenSignal(id, note);
  await store.refresh();
  return result.signal;
}

export async function updateSignal(id, input) {
  const result = await api.updateSignal(id, input);
  await store.refresh();
  return result.signal;
}

/**
 * Назначить категорию — действие раздела «Распределение».
 * Вместе с категорией уходят выбранные руководители и заметка к задаче.
 */
export async function distribute(id, category, assignees = [], note = null) {
  const result = await api.distributeSignal(id, category, assignees, note);
  await store.refresh();
  return result.signal;
}

/** Выдать задачу выбранным сотрудникам и приложить заметку. */
export async function assignPeople(id, assignees, note) {
  const result = await api.assignPeople(id, assignees, note);
  await store.refresh();
  return result.signal;
}

/**
 * Отметить карточку просмотренной. Индикатор новых изменений сбрасывается,
 * поэтому состояние перечитывается — иначе кружок остался бы висеть до
 * следующего события с сервера.
 */
export async function markSeen(id) {
  await api.markSignalSeen(id);
  await store.refresh();
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

