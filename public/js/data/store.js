/**
 * DATA-СЛОЙ клиента.
 *
 * Держит снимок состояния, полученный от сервера, и поддерживает его свежим:
 * сервер публикует изменения через SSE (`/api/events`), клиент в ответ
 * перечитывает `/api/state`. Так live-режим работает не только между вкладками
 * одного браузера, но и между разными пользователями и устройствами.
 */

import { api } from './api.js';

const listeners = new Set();

let state = {
  ready: false,
  offline: false,
  actor: null,
  mySignals: [],
  allSignals: null,
  tasks: null,
  admins: null,
  authorLabels: {},
  meta: {},
};

let source = null;
let pendingRefresh = null;

function notify(meta = {}) {
  for (const listener of listeners) {
    try {
      listener(state, meta);
    } catch (error) {
      console.error('[store] ошибка в подписчике', error);
    }
  }
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Перечитать состояние с сервера. Параллельные вызовы схлопываются в один запрос. */
export function refresh() {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = api
    .getState()
    .then((next) => {
      state = { ...next, ready: true, offline: false, authorLabels: next.authorLabels ?? {} };
      notify({ source: 'refresh' });
      return state;
    })
    .catch((error) => {
      console.error('[store] не удалось получить состояние', error);
      state = { ...state, ready: true, offline: true };
      notify({ source: 'error' });
      return state;
    })
    .finally(() => {
      pendingRefresh = null;
    });

  return pendingRefresh;
}

/** Подписка на серверный поток изменений. */
function connectEvents() {
  source?.close();
  source = new EventSource('/api/events');

  source.addEventListener('change', () => refresh());

  source.addEventListener('open', () => {
    if (state.offline) refresh();
  });

  source.addEventListener('error', () => {
    // EventSource переподключается сам; фиксируем разрыв только когда он окончателен.
    if (source.readyState === EventSource.CLOSED) {
      state = { ...state, offline: true };
      notify({ source: 'offline' });
      setTimeout(connectEvents, 3000);
    }
  });
}

export async function init() {
  await refresh();
  connectEvents();

  // Возврат на вкладку после сна/фона — данные могли устареть.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  return state;
}
