/**
 * ФОНОВЫЙ ПРОЦЕСС (CRON-эмуляция) — теперь на сервере.
 *
 * Один процесс на всю систему, поэтому выбор лидера между вкладками больше не нужен:
 * таймер тикает независимо от того, открыт ли хоть один браузер. Каждый тик находит
 * Желтые сигналы старше 48 часов и переводит их в Красный от имени Системы,
 * что автоматически порождает событие рассылки в конечном автомате.
 */

import { WORKER_TICK_MS } from '../../shared/constants.js';
import { findDueForEscalation, escalateToRed } from './signals.js';

let timer = null;

function tick() {
  const due = findDueForEscalation();
  for (const signal of due) {
    try {
      escalateToRed(signal.id);
      console.info(`[worker] сигнал ${signal.id} эскалирован в КРАСНЫЙ (возраст > 48 ч)`);
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
