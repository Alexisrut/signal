/** Задачи на стороне клиента. Модуль полностью независим от логики сигналов. */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { TASK_STATUS_ORDER } from '/shared/constants.js';

/** null — модуль недоступен (нет прав либо он выключен в настройках профиля). */
export function listAll() {
  return store.getState().tasks;
}

export function find(id) {
  return (listAll() ?? []).find((task) => task.id === id) ?? null;
}

export function filterTasks(tasks, { status = 'all' } = {}) {
  if (status === 'all') return tasks;
  return tasks.filter((task) => task.status === status);
}

export function countByStatus(tasks) {
  const counters = { total: tasks.length };
  for (const status of TASK_STATUS_ORDER) counters[status] = 0;
  for (const task of tasks) counters[task.status] += 1;
  return counters;
}

export async function createTask(input) {
  const result = await api.createTask(input);
  await store.refresh();
  return result.task;
}

export async function changeStatus(id, status) {
  const result = await api.changeTaskStatus(id, status);
  await store.refresh();
  return result.task;
}
