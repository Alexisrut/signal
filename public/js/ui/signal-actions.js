/**
 * Действия с сигналом, общие для нескольких экранов: раздел «Входной
 * контроль», карточка сотрудника и карточка подрядчика.
 *
 * Каждое действие — окно (что произойдет, поле комментария, файлы), затем
 * запрос и всплывающее сообщение. Кнопка на время запроса блокируется,
 * чтобы двойной щелчок не отправил действие дважды.
 */

import { SIGNAL_ACTION, STATUS, STATUS_META, signalNumber } from '/shared/constants.js';
import { requiresComment, submitActionFor } from '/shared/state-machine.js';
import { validateReport } from '/shared/validation.js';
import { performAction, addComment, reopenSignal, saveReport } from '../domain/signals.js';
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

/** Закрытие автором: проблема решилась — сигнал больше не нужен. */
export async function resolveSignal(signal, button) {
  const picked = await openActionDialog({
    title: `Проблема решена${suffix(signal)}`,
    lead: 'Сигнал будет закрыт. Участники получат письмо — коротко напишите, как решился вопрос.',
    label: 'Как решен вопрос',
    required: requiresComment(SIGNAL_ACTION.RESOLVE),
    confirmLabel: 'Закрыть сигнал',
  });
  if (!picked) return null;

  return run(button, () => performAction(signal.id, SIGNAL_ACTION.RESOLVE, picked), 'Сигнал закрыт');
}

const REPORT_LEAD =
  'Опишите, что сделано и какое решение принято, — так, чтобы подрядчик понял, как решен вопрос. ' +
  'Например: где в проекте находится нужное решение (раздел, лист), дата поставки и документы об отгрузке, ' +
  'кто получил материал. Приложите подтверждающие документы.';

/**
 * Отчет о выполнении. `submit` — вместе с отчетом сигнал уходит автору на
 * подтверждение; иначе отчет только сохраняется. Поле начинается с текущего
 * отчета: после возврата его дополняют, а не пишут заново.
 */
export async function reportOnSignal(signal, button, { submit = false } = {}) {
  const repeat = submit && submitActionFor(signal) === SIGNAL_ACTION.RESUBMIT_WORK;
  const picked = await openActionDialog({
    title: submit ? `Направить на подтверждение${suffix(signal)}` : `Отчет о выполнении${suffix(signal)}`,
    lead: repeat
      ? `Подрядчик вернул сигнал на доработку. Дополните отчет: что доработано после возврата. ${REPORT_LEAD}`
      : submit
        ? `Сигнал уйдет автору: он подтвердит выполнение или вернет сигнал на доработку. ${REPORT_LEAD}`
        : REPORT_LEAD,
    label: 'Отчет о выполнении',
    required: true,
    initialText: signal?.report ?? '',
    validate: validateReport,
    rows: 8,
    confirmLabel: submit ? 'Направить на подтверждение' : 'Сохранить отчет',
  });
  if (!picked) return null;

  return run(
    button,
    () => saveReport(signal.id, picked.comment, picked.files, { submit }),
    submit ? 'Результат направлен подрядчику на подтверждение' : 'Отчет сохранен',
  );
}

/** Автор подтверждает, что проблема устранена, — сигнал закрывается. */
export async function confirmResolution(signal, button) {
  const picked = await openActionDialog({
    title: `Подтвердить выполнение${suffix(signal)}`,
    lead: 'Подтвердите, только если проблема действительно устранена: сигнал будет окончательно закрыт.',
    label: 'Комментарий',
    placeholder: 'Необязательно',
    required: requiresComment(SIGNAL_ACTION.CONFIRM),
    withFiles: false,
    confirmLabel: 'Подтвердить и закрыть',
  });
  if (!picked) return null;

  return run(
    button,
    () => performAction(signal.id, SIGNAL_ACTION.CONFIRM, picked),
    'Выполнение подтверждено — сигнал закрыт',
  );
}

/** Автор возвращает результат: проблема не устранена или информации недостаточно. */
export async function returnForRework(signal, button) {
  const picked = await openActionDialog({
    title: `Вернуть на доработку${suffix(signal)}`,
    lead: 'Сигнал вернется ответственному. Напишите, что не устранено или какой информации не хватает, — это обязательно.',
    label: 'Что не устранено',
    placeholder: 'Например: материал на объект не поступил, в накладной другая марка кабеля',
    required: requiresComment(SIGNAL_ACTION.RETURN),
    confirmLabel: 'Вернуть на доработку',
  });
  if (!picked) return null;

  return run(
    button,
    () => performAction(signal.id, SIGNAL_ACTION.RETURN, picked),
    'Сигнал возвращен ответственному на доработку',
  );
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

/** Статус, в котором автор проверяет результат. */
export const awaitsConfirmation = (signal) => signal?.status === STATUS.CONFIRM;

/** Возобновление закрытого сигнала — отсчет времени решения продолжится. */
export async function reopen(signal, button) {
  return run(
    button,
    () => reopenSignal(signal.id),
    (updated) => `Сигнал возобновлен: ${STATUS_META[updated.status].label}`,
  );
}
