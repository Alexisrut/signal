/**
 * Окно выбора руководителей при выдаче задачи.
 *
 * Список делится на две части: сначала те, кто курирует выбранную категорию,
 * затем все остальные — но выбрать можно кого угодно и сколько угодно,
 * ограничение по категории здесь подсказка, а не запрет.
 *
 * К назначению прикладывается заметка: ее увидят все ответственные за задачу.
 */

import { html } from '../core/utils.js';
import { ROLE_LABEL, categoryShort, categoryLabel } from '/shared/constants.js';
import { listAssignables } from '../domain/session.js';
import { checkbox } from './components.js';
import { openModal } from './modal.js';

function personRow(person, { checked, disabled }) {
  const scope = person.categories?.length
    ? person.categories.map((id) => categoryShort(id)).join(', ')
    : 'категории не выбраны';

  return checkbox({
    name: 'assignee',
    value: person.id,
    label: `${person.displayName} · ${ROLE_LABEL[person.role] ?? 'сотрудник'}`,
    hint: disabled ? 'уже назначен на этот сигнал' : scope,
    checked,
    disabled,
  });
}

/**
 * @param {object} options
 * @param {object} options.signal сигнал, которому выдается задача
 * @param {string|null} options.category категория, выбранная в этот момент
 * @param {string} [options.title] заголовок окна
 * @param {string} [options.confirmLabel] подпись кнопки подтверждения
 * @param {boolean} [options.allowEmpty] можно ли подтвердить, никого не выбрав
 *   (при распределении — да: категорию назначают и без исполнителей)
 * @returns {Promise<{assignees: string[], note: string}|null>} null — окно закрыли
 */
export function openAssignDialog({
  signal,
  category = null,
  title,
  confirmLabel = 'Назначить',
  allowEmpty = false,
}) {
  const people = listAssignables();
  const already = new Set((signal?.assignees ?? []).map((person) => person.id));

  const curating = people.filter((person) => category && (person.categories ?? []).includes(category));
  const curatingIds = new Set(curating.map((person) => person.id));
  const others = people.filter((person) => !curatingIds.has(person.id));

  const section = (heading, list, hint) =>
    list.length
      ? html`<div class="picker__group">
          <span class="picker__legend">${heading}</span>
          ${[hint ? html`<span class="picker__hint">${hint}</span>` : '']}
          <div class="checkboxes checkboxes--column">
            ${list.map((person) => personRow(person, { checked: false, disabled: already.has(person.id) }))}
          </div>
        </div>`
      : '';

  const bodyHtml = html`
    ${[
      category
        ? html`<p class="picker__category">
            Категория: <strong>${categoryLabel(category)}</strong>
          </p>`
        : '',
    ]}
    ${[
      people.length
        ? html`${[section(curating.length ? `Курируют категорию (${curating.length})` : '', curating)]}
            ${[
              section(
                curating.length ? `Остальные сотрудники (${others.length})` : `Сотрудники (${others.length})`,
                others,
                curating.length ? 'Можно назначить и тех, кто курирует другие категории.' : '',
              ),
            ]}`
        : html`<p class="picker__empty">
            Ни одной учетной записи руководителя пока нет — создайте ее в разделе «Учетные записи».
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
    collect: (root) => {
      const assignees = [...root.querySelectorAll('[name="assignee"]:checked')].map((input) => input.value);
      const note = root.querySelector('[name="note"]').value.trim();

      if (!allowEmpty && !assignees.length && !note) {
        root.querySelector('[data-role="picker-error"]').textContent =
          'Выберите хотя бы одного исполнителя или напишите заметку.';
        return null;
      }
      return { assignees, note };
    },
  });
}
