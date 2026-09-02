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
  undistributed: null,
  users: null,
  assignables: null,
  stats: null,
  authorLabels: {},
  // Индикаторы «сколько изменений с прошлого захода», по одному числу на сигнал.
  unread: {},
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
      state = {
        ...next,
        ready: true,
        offline: false,
        authorLabels: next.authorLabels ?? {},
        unread: next.unread ?? {},
      };
      // Вход и выход меняют право на поток изменений — держим его в согласии.
      syncEvents();
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

/**
 * Подписка на серверный поток изменений.
 *
 * Поток открыт только вошедшим: гостю сервер отвечает 401, и подключаться
 * ему незачем — EventSource бился бы в закрытую дверь по кругу и держал
 * значок «офлайн» на форме входа.
 */
function connectEvents() {
  disconnectEvents();
  if (!state.actor) return;

  source = new EventSource('/api/events');

  source.addEventListener('change', () => refresh());

  source.addEventListener('open', () => {
    if (state.offline) refresh();
  });

  source.addEventListener('error', () => {
    // EventSource переподключается сам; фиксируем разрыв только когда он окончателен.
    if (source?.readyState === EventSource.CLOSED) {
      state = { ...state, offline: true };
      notify({ source: 'offline' });
      // Сессия могла просто закончиться — перед новой попыткой перечитываем
      // состояние, и если пользователь уже вышел, поток не поднимется.
      setTimeout(() => refresh().then(syncEvents), 3000);
    }
  });
}

function disconnectEvents() {
  source?.close();
  source = null;
}

/** Держит поток открытым ровно пока есть сессия: вход открывает, выход закрывает. */
function syncEvents() {
  if (state.actor && !source) connectEvents();
  else if (!state.actor && source) disconnectEvents();
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
