/**
 * DATA-СЛОЙ.
 *
 * Единственное место, которое знает о физическом хранилище (localStorage).
 * Отвечает за:
 *   - хранение снапшота состояния { users, signals };
 *   - атомарные мутации с перечитыванием актуальной версии перед записью
 *     (иначе параллельная вкладка потеряла бы свою запись — last-write-wins по всему блобу);
 *   - LIVE-режим: слушатель события `storage` (изменения из других вкладок)
 *     + BroadcastChannel как быстрый канал доставки в рамках одного origin.
 *
 * Ревизия (`rev`) инкрементируется на каждой записи и служит для дедупликации:
 * одно и то же изменение приходит и через `storage`, и через BroadcastChannel.
 */

import { uid } from '../core/utils.js';

const STORAGE_KEY = 'sms:db:v1';
const CHANNEL_NAME = 'sms:sync:v1';

export const TAB_ID = uid('tab');

const listeners = new Set();

let state = emptyState();
let channel = null;
let initialized = false;

function emptyState() {
  return { schema: 1, rev: 0, users: {}, signals: {} };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  return {
    schema: raw.schema ?? 1,
    rev: Number(raw.rev) || 0,
    users: raw.users && typeof raw.users === 'object' ? raw.users : {},
    signals: raw.signals && typeof raw.signals === 'object' ? raw.signals : {},
  };
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch (error) {
    console.error('[store] не удалось прочитать хранилище, состояние сброшено', error);
    return null;
  }
}

function writeToStorage(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function notify(meta) {
  for (const listener of listeners) {
    try {
      listener(state, meta);
    } catch (error) {
      console.error('[store] ошибка в подписчике', error);
    }
  }
}

/** Перечитать состояние из хранилища и уведомить подписчиков, если ревизия выросла. */
function syncFromStorage(source) {
  const next = readFromStorage() ?? emptyState();
  if (next.rev === state.rev && source !== 'init') return false;
  state = next;
  notify({ source });
  return true;
}

export function init() {
  if (initialized) return state;
  initialized = true;

  const existing = readFromStorage();
  if (existing) {
    state = existing;
  } else {
    state = emptyState();
    writeToStorage(state);
  }

  // Требование ТЗ: слушатель событий изменения хранилища на уровне data-слоя.
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    // event.key === null → localStorage.clear() в другой вкладке.
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    syncFromStorage('storage');
  });

  // Быстрый канал: `storage` не срабатывает мгновенно во всех браузерах,
  // BroadcastChannel доставляет изменение в остальные вкладки без задержки.
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => {
      if (event.data?.tabId === TAB_ID) return;
      syncFromStorage('broadcast');
    });
  }

  return state;
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Единственный путь записи.
 * @param {(draft: object, abort: () => void) => any} recipe мутирует черновик состояния;
 *   вызов `abort()` отменяет запись (например, если бизнес-правило запретило операцию)
 * @returns результат recipe
 */
export function mutate(recipe) {
  // Перечитываем перед записью: другая вкладка могла изменить данные после нашего последнего рендера.
  const fresh = readFromStorage() ?? emptyState();
  const draft = structuredClone(fresh);

  let aborted = false;
  const result = recipe(draft, () => {
    aborted = true;
  });

  // Отклоненная операция не должна порождать запись и лишнюю перерисовку во всех вкладках.
  if (aborted) return result;

  draft.rev = (fresh.rev || 0) + 1;
  writeToStorage(draft);
  state = draft;

  notify({ source: 'local' });
  channel?.postMessage({ tabId: TAB_ID, rev: draft.rev });

  return result;
}

/** Только для чтения «самой свежей» версии без подписки (используется воркером). */
export function readFresh() {
  const fresh = readFromStorage();
  if (fresh && fresh.rev !== state.rev) {
    state = fresh;
    notify({ source: 'refresh' });
  }
  return state;
}
