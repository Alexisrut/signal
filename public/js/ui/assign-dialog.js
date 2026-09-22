/**
 * Окно выбора ответственных при выдаче задачи.
 *
 * Кандидаты делятся на две группы, и правило отбора у них разное:
 *   • администраторы и главные администраторы — доступны всегда, они видят
 *     весь поток и отвечают за него целиком;
 *   • руководители — только те, за кем закреплена категория этого сигнала:
 *     раздавать задачи «мимо специализации» система не дает.
 *
 * Список фильтруется строкой поиска по ФИО — на десятке сотрудников это уже
 * быстрее, чем глазами. Заголовок группы прячется вместе с ее строками, чтобы
 * не висеть над пустотой.
 *
 * К назначению прикладывается заметка: ее увидят все ответственные за задачу.
 */

import { html } from '../core/utils.js';
import { categoryLabel, categoryShort, ROLE, ROLE_LABEL } from '/shared/constants.js';
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
 *   (при распределении — да: категорию назначают и без ответственных)
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

  const admins = candidates.filter((person) => person.role !== ROLE.MANAGER);
  const managers = candidates.filter((person) => person.role === ROLE.MANAGER);

  /** Подпись под именем: у руководителя — его категории, у администратора — должность. */
  const hintFor = (person) => {
    if (already.has(person.id)) return 'уже назначен на этот сигнал';
    if (person.role === ROLE.MANAGER) return person.categories.map((id) => categoryShort(id)).join(', ');
    return ROLE_LABEL[person.role];
  };

  const rowsOf = (people, group) =>
    people.map(
      (person) =>
        html`<div class="picker__row" data-group="${group}" data-name="${person.displayName.toLowerCase()}">
          ${[
            checkbox({
              name: 'assignee',
              value: person.id,
              label: person.displayName,
              hint: hintFor(person),
              checked: false,
              disabled: already.has(person.id),
            }),
          ]}
        </div>`,
    );

  const groupBlock = (people, group, legend) =>
    people.length
      ? html`<span class="picker__legend" data-group-label="${group}">${legend} (${people.length})</span>
          <div class="checkboxes checkboxes--column">${rowsOf(people, group)}</div>`
      : '';

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

            ${[
              groupBlock(admins, 'admins', 'Администраторы'),
              groupBlock(managers, 'managers', 'Руководители категории'),
            ]}

            <p class="picker__empty" data-role="no-match" hidden>Никто не подходит под запрос.</p>
          </div>`
        : html`<p class="picker__empty">
            Назначить некого: в системе нет ни администраторов, ни руководителей этой категории.
            Закрепите категорию за руководителем в разделе «Учетные записи» — после этого он
            появится в списке.
          </p>`,
    ]}

    <label class="field" data-field="note">
      <span class="field__label">Заметка к задаче</span>
      <textarea class="field__control" name="note" rows="3"
        placeholder="Что важно учесть исполнителям (необязательно)">${signal?.assignmentNote ?? ''}</textarea>
      <span class="field__hint">Заметку увидят все ответственные за эту задачу.</span>
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
          'Выберите хотя бы одного сотрудника или напишите заметку.';
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
  const labels = [...root.querySelectorAll('[data-group-label]')];
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

    // Заголовок группы без единой видимой строки только мешает читать список.
    for (const label of labels) {
      const group = label.dataset.groupLabel;
      label.hidden = !rows.some((row) => row.dataset.group === group && !row.hidden);
    }

    if (empty) empty.hidden = visible > 0;
  });
}
