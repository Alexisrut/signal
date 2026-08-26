/**
 * Окно выбора кураторов при выдаче задачи.
 *
 * Кандидат — только руководитель, за которым закреплена категория этого
 * сигнала: администраторы задачи раздают, но кураторами не становятся,
 * а руководитель «не своей» категории в списке не появляется.
 *
 * Список фильтруется строкой поиска по ФИО — на десятке руководителей это
 * уже быстрее, чем глазами.
 *
 * К назначению прикладывается заметка: ее увидят все ответственные за задачу.
 */

import { html } from '../core/utils.js';
import { categoryLabel, categoryShort } from '/shared/constants.js';
import { canCurate } from '/shared/state-machine.js';
import { listAssignables } from '../domain/session.js';
import { checkbox } from './components.js';
import { openModal } from './modal.js';

/**
 * @param {object} options
 * @param {object} options.signal сигнал, которому выдается задача
 * @param {string|null} options.category категория, выбранная в этот момент
 * @param {string} [options.title] заголовок окна
 * @param {string} [options.confirmLabel] подпись кнопки подтверждения
 * @param {boolean} [options.allowEmpty] можно ли подтвердить, никого не выбрав
 *   (при распределении — да: категорию назначают и без кураторов)
 * @returns {Promise<{assignees: string[], note: string}|null>} null — окно закрыли
 */
export function openAssignDialog({
  signal,
  category = null,
  title,
  confirmLabel = 'Назначить',
  allowEmpty = false,
}) {
  const already = new Set((signal?.assignees ?? []).map((person) => person.id));
  const candidates = listAssignables().filter((person) => canCurate(person, category));

  const rows = candidates.map((person) =>
    html`<div class="picker__row" data-name="${person.displayName.toLowerCase()}">
      ${[
        checkbox({
          name: 'assignee',
          value: person.id,
          label: person.displayName,
          hint: already.has(person.id)
            ? 'уже назначен на этот сигнал'
            : person.categories.map((id) => categoryShort(id)).join(', '),
          checked: false,
          disabled: already.has(person.id),
        }),
      ]}
    </div>`,
  );

  const bodyHtml = html`
    <p class="picker__category">Категория: <strong>${categoryLabel(category)}</strong></p>

    ${[
      candidates.length
        ? html`<div class="picker__group">
            <label class="field field--search">
              <span class="field__label">Поиск по ФИО</span>
              <input class="field__control" type="search" data-role="search" placeholder="Начните вводить фамилию"
                autocomplete="off" />
            </label>

            <span class="picker__legend">Руководители категории (${candidates.length})</span>
            <div class="checkboxes checkboxes--column" data-role="list">${rows}</div>
            <p class="picker__empty" data-role="no-match" hidden>Никто не подходит под запрос.</p>
          </div>`
        : html`<p class="picker__empty">
            За этой категорией не закреплен ни один руководитель. Назначьте ему категорию
            в разделе «Учетные записи» — после этого он появится в списке.
          </p>`,
    ]}

    <label class="field" data-field="note">
      <span class="field__label">Заметка к задаче</span>
      <textarea class="field__control" name="note" rows="3"
        placeholder="Что важно учесть исполнителям (необязательно)">${signal?.assignmentNote ?? ''}</textarea>
      <span class="field__hint">Заметку увидят все руководители, ответственные за эту задачу.</span>
    </label>

    <p class="field__error" data-role="picker-error"></p>
  `;

  return openModal({
    title: title ?? 'Кому выдать задачу',
    bodyHtml,
    confirmLabel,
    mount: (root) => bindSearch(root),
    collect: (root) => {
      const assignees = [...root.querySelectorAll('[name="assignee"]:checked')].map((input) => input.value);
      const note = root.querySelector('[name="note"]').value.trim();

      if (!allowEmpty && !assignees.length && !note) {
        root.querySelector('[data-role="picker-error"]').textContent =
          'Выберите хотя бы одного руководителя или напишите заметку.';
        return null;
      }
      return { assignees, note };
    },
  });
}

/**
 * Фильтрация списка по ФИО. Отмеченные строки не прячем даже когда они не
 * подходят под запрос: иначе выбор незаметно потерялся бы при вводе текста.
 */
function bindSearch(root) {
  const search = root.querySelector('[data-role="search"]');
  if (!search) return;

  const rows = [...root.querySelectorAll('.picker__row')];
  const empty = root.querySelector('[data-role="no-match"]');

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;

    for (const row of rows) {
      const checked = row.querySelector('input')?.checked;
      const match = !query || row.dataset.name.includes(query) || checked;
      row.hidden = !match;
      if (match) visible += 1;
    }

    if (empty) empty.hidden = visible > 0;
  });
}
