/**
 * Действия с сигналом, общие для нескольких экранов: раздел «Входной
 * контроль», карточка сотрудника и карточка подрядчика.
 *
 * Каждое действие — окно (что произойдет, поле комментария, файлы), затем
 * запрос и всплывающее сообщение. Кнопка на время запроса блокируется,
 * чтобы двойной щелчок не отправил действие дважды.
 */

import { SIGNAL_ACTION, STATUS_META, signalNumber } from '/shared/constants.js';
import { requiresComment } from '/shared/state-machine.js';
import { performAction, addComment, reopenSignal } from '../domain/signals.js';
import { openActionDialog } from './action-dialog.js';
import { confirmDialog } from './modal.js';
import { showToast } from './chrome.js';

const suffix = (signal) => (signal?.number ? ` · ${signalNumber(signal)}` : '');

async function run(button, task, success) {
  if (button) button.disabled = true;
  try {
    const result = await task();
    showToast(typeof success === 'function' ? success(result) : success, 'success');
    return result;
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message, 'error');
    return null;
  }
}

/** Возврат подрядчику с входного контроля: обязательный комментарий, что дополнить. */
export async function returnToContractor(signal, button) {
  const picked = await openActionDialog({
    title: `Вернуть на доработку${suffix(signal)}`,
    lead: 'Подрядчик получит письмо с этим комментарием, дополнит сигнал и отправит его на повторную проверку.',
    label: 'Что нужно дополнить или уточнить',
    placeholder: 'Например: приложите фото узла и укажите лист РД, где обнаружено расхождение',
    required: requiresComment(SIGNAL_ACTION.INTAKE_RETURN),
    confirmLabel: 'Вернуть на доработку',
  });
  if (!picked) return null;

  return run(
    button,
    () => performAction(signal.id, SIGNAL_ACTION.INTAKE_RETURN, picked),
    'Сигнал возвращен подрядчику на доработку',
  );
}

/** Отклонение: сигнал закрывается без работы, причина уходит участникам в письме. */
export async function rejectSignal(signal, button) {
  const picked = await openActionDialog({
    title: `Отклонить сигнал${suffix(signal)}`,
    lead: 'Сигнал будет закрыт без решения. Участники получат письмо с причиной.',
    label: 'Причина',
    placeholder: 'Например: дублирует сигнал №118',
    required: requiresComment(SIGNAL_ACTION.REJECT),
    confirmLabel: 'Отклонить сигнал',
    tone: 'danger',
  });
  if (!picked) return null;

  return run(button, () => performAction(signal.id, SIGNAL_ACTION.REJECT, picked), 'Сигнал отклонен');
}

/** Закрытие с пометкой «решено» — автором или сотрудником, если правила позволяют. */
export async function resolveSignal(signal, button) {
  const picked = await openActionDialog({
    title: `Проблема решена${suffix(signal)}`,
    lead: 'Сигнал будет закрыт. Участники получат письмо — коротко напишите, как решен вопрос.',
    label: 'Как решен вопрос',
    required: requiresComment(SIGNAL_ACTION.RESOLVE),
    confirmLabel: 'Закрыть сигнал',
  });
  if (!picked) return null;

  return run(button, () => performAction(signal.id, SIGNAL_ACTION.RESOLVE, picked), 'Сигнал закрыт');
}

/** Ручная эскалация — с подтверждением: она рассылает письма и меняет приоритет. */
export async function escalateSignal(signal, button) {
  const confirmed = await confirmDialog({
    title: 'Перевод в красный статус',
    message: 'Вы точно хотите перевести сигнал в красный статус?',
    confirmLabel: 'Перевести в красный',
    tone: 'primary',
  });
  if (!confirmed) return null;

  return run(
    button,
    () => performAction(signal.id, SIGNAL_ACTION.ESCALATE),
    (updated) => `Статус изменен: ${STATUS_META[updated.status].label}`,
  );
}

/** Комментарий в переписке по сигналу — его получат все участники. */
export async function commentOnSignal(signal, button) {
  const picked = await openActionDialog({
    title: `Комментарий${suffix(signal)}`,
    lead: 'Комментарий попадет в ленту событий, участники получат его письмом.',
    label: 'Комментарий',
    required: true,
    confirmLabel: 'Отправить',
  });
  if (!picked) return null;

  return run(button, () => addComment(signal.id, picked.comment, picked.files), 'Комментарий отправлен');
}

/** Возобновление закрытого сигнала — отсчет времени решения продолжится. */
export async function reopen(signal, button) {
  return run(
    button,
    () => reopenSignal(signal.id),
    (updated) => `Сигнал возобновлен: ${STATUS_META[updated.status].label}`,
  );
}
