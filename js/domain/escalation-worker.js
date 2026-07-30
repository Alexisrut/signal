/**
 * ФОНОВЫЙ ПРОЦЕСС (CRON-эмуляция).
 *
 * Непрерывно опрашивает возраст всех Желтых сигналов и по достижении порога
 * в 48 часов переводит их в Красный, записывая в историю действие от имени Системы.
 *
 * Между вкладками выбирается один «лидер» (лок с heartbeat в localStorage),
 * чтобы одно и то же событие эскалации не записалось несколько раз.
 * Даже если лидер сменится в момент гонки, повторную запись отсечет конечный
 * автомат: переход Красный → Красный запрещен.
 */

import * as store from '../data/store.js';
import { STATUS, WORKER_TICK_MS } from '../core/constants.js';
import { escalateToRed } from './signals.js';
import { isEscalationDue } from './state-machine.js';

const LOCK_KEY = 'sms:worker-lock:v1';
const LOCK_STALE_MS = WORKER_TICK_MS * 3;

let timer = null;
let isLeader = false;

function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function claimLock() {
  const now = Date.now();
  const lock = readLock();
  const mine = lock?.tabId === store.TAB_ID;
  const stale = !lock || now - (lock.at || 0) > LOCK_STALE_MS;

  if (mine || stale) {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ tabId: store.TAB_ID, at: now }));
    return true;
  }
  return false;
}

function releaseLock() {
  if (readLock()?.tabId === store.TAB_ID) localStorage.removeItem(LOCK_KEY);
}

function tick() {
  isLeader = claimLock();
  if (!isLeader) return;

  // Работаем на самой свежей версии данных: сигналы могли быть созданы в другой вкладке.
  const state = store.readFresh();
  const now = Date.now();

  for (const signal of Object.values(state.signals)) {
    if (signal.status !== STATUS.YELLOW) continue;
    if (!isEscalationDue(signal, now)) continue;

    const result = escalateToRed(signal.id);
    if (result?.ok) {
      console.info(`[worker] сигнал ${signal.id} эскалирован в КРАСНЫЙ (возраст > 48 ч)`);
    }
  }
}

export function startEscalationWorker() {
  if (timer) return () => {};

  tick();
  timer = setInterval(tick, WORKER_TICK_MS);

  // Вкладка скрыта → браузер тормозит таймеры; при возврате догоняем немедленно.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('pagehide', releaseLock);
  window.addEventListener('beforeunload', releaseLock);

  return () => {
    clearInterval(timer);
    timer = null;
    releaseLock();
  };
}
