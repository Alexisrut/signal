/**
 * ФОНОВЫЙ ПРОЦЕСС (CRON-эмуляция) — теперь на сервере.
 *
 * Один процесс на всю систему, поэтому выбор лидера между вкладками больше не нужен:
 * таймер тикает независимо от того, открыт ли хоть один браузер. Каждый тик находит
 * сигналы с истекшим сроком отработки — 48 часов в работе либо 48 часов после
 * возврата подрядчиком на доработку — и переводит их в Красный от имени Системы.
 */

import { WORKER_TICK_MS } from '../../shared/constants.js';
import { findDueForEscalation, escalateToRed } from './signals.js';

let timer = null;

function tick() {
  const due = findDueForEscalation();
  for (const signal of due) {
    try {
      escalateToRed(signal.id);
      console.info(`[worker] сигнал №${signal.number ?? signal.id} эскалирован в КРАСНЫЙ (срок 48 ч истек)`);
    } catch (error) {
      console.error(`[worker] не удалось эскалировать ${signal.id}:`, error.message);
    }
  }
}

export function startEscalationWorker() {
  if (timer) return () => {};

  tick();
  timer = setInterval(tick, WORKER_TICK_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    timer = null;
  };
}
