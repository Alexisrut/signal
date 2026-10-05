/**
 * Сигналы на стороне клиента: выборки из снимка состояния и вызовы API.
 * Права проверяются здесь только для отображения — решение всегда за сервером.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { upload } from './files.js';
import { ASSIGNMENT, STATUS, STATUS_ORDER } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';

export function listMine() {
  return store.getState().mySignals ?? [];
}

/** Все доступные администратору сигналы (иначе null). */
export function listAll() {
  return store.getState().allSignals;
}

/**
 * Нераспределенные сигналы — раздел «Входной контроль», только для главного
 * администратора (иначе null): ждущие проверки, вернувшиеся к подрядчику
 * и закрытые без распределения.
 */
export function listUndistributed() {
  return store.getState().undistributed;
}

/** Сигналы, ждущие проверки на входном контроле, — по ним действовать сейчас. */
export function listAwaitingIntake() {
  return (listUndistributed() ?? []).filter((signal) => signal.status === STATUS.INTAKE);
}

/**
 * Последняя запись ленты о действии — например, комментарий к возврату
 * на доработку, чтобы показать его подрядчику прямо в карточке.
 */
export function lastAction(signal, action) {
  return [...(signal?.history ?? [])].reverse().find((entry) => entry.details?.action === action) ?? null;
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
  const counters = { total: signals.length, ...Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) };
  for (const signal of signals) counters[signal.status] = (counters[signal.status] ?? 0) + 1;
  return counters;
}

/* --------------------------------- действия ---------------------------------- */

export async function createSignal(input) {
  const result = await api.createSignal(input);
  await store.refresh();
  return result.signal;
}

/**
 * Действие с сигналом: возврат на доработку, эскалация, закрытие, отклонение.
 * Файлы, приложенные к действию, загружаются до него и уходят идентификаторами.
 */
export async function performAction(id, action, { comment = '', files = [] } = {}) {
  const uploaded = await upload(files);
  const result = await api.signalAction(id, action, { comment, fileIds: uploaded.map((file) => file.id) });
  await store.refresh();
  return result.signal;
}

/** Комментарий в переписке по сигналу. */
export async function addComment(id, text, files = []) {
  const uploaded = await upload(files);
  const result = await api.commentSignal(id, text, uploaded.map((file) => file.id));
  await store.refresh();
  return result.signal;
}

/** Вернуть закрытый сигнал в активную фазу — отсчет времени решения продолжится. */
export async function reopenSignal(id, note) {
  const result = await api.reopenSignal(id, note);
  await store.refresh();
  return result.signal;
}

/**
 * Правка карточки. Новые файлы загружаются до сохранения и ложатся
 * к вложениям сигнала. `input.resubmit` — доработка после возврата с входного
 * контроля: сигнал вместе с правками уходит на повторную проверку.
 */
export async function updateSignal(id, input, files = []) {
  const uploaded = await upload(files);
  const result = await api.updateSignal(id, { ...input, fileIds: uploaded.map((file) => file.id) });
  await store.refresh();
  return result.signal;
}

/**
 * Назначить категорию — действие раздела «Входной контроль»: для сигнала
 * на проверке это передача в работу. Вместе с категорией уходят выбранные
 * ответственные и заметка к задаче.
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

