/**
 * Редактирование сигнала.
 *
 * Правки не переписывают карточку молча: сервер сравнивает поля со старыми
 * значениями и пишет в историю, кто именно и что поменял.
 */

import { html } from '../../core/utils.js';
import { categoryLabel } from '/shared/constants.js';
import { validateSignalInput } from '/shared/validation.js';
import { canEdit } from '/shared/state-machine.js';
import { currentActor, isStaff } from '../../domain/session.js';
import { findAny, updateSignal } from '../../domain/signals.js';
import { emptyState, statusBadge } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/**
 * Поле «Подрядчик» — это имя автора. Подрядчику оно недоступно: имя закреплено
 * за учетной записью, и переписать его через форму правки нельзя (сервер такую
 * попытку тоже игнорирует). Администратор карточку правит целиком.
 */
const AUTHOR_FIELD = { name: 'contractorName', label: 'Подрядчик', type: 'input' };

const COMMON_FIELDS = [
  { name: 'sector', label: 'Сектор работы', type: 'input' },
  { name: 'description', label: 'Описание проблемы', type: 'textarea' },
];

const fieldsFor = (actor) => (isStaff(actor) ? [AUTHOR_FIELD, ...COMMON_FIELDS] : COMMON_FIELDS);

export const editSignalView = {
  // Форма: автоперерисовка по чужим изменениям стерла бы правки на полуслове.
  live: false,

  render(ctx) {
    const actor = currentActor();
    const signal = findAny(ctx.params.id);
    // Возврат туда, откуда пришли: у администратора это карта сигналов.
    const backHref = ctx.path.startsWith('/admin') ? `#/admin/signal/${ctx.params.id}` : `#/my/${ctx.params.id}`;

    if (!signal) {
      return html`<section class="page">
        ${[
          emptyState(
            'Сигнал не найден',
            'Возможно, он принадлежит другому подрядчику или был удален.',
            html`<a class="btn btn--secondary" href="#/my">К моим сигналам</a>`,
          ),
        ]}
      </section>`;
    }

    const verdict = canEdit(signal, actor);
    if (!verdict.allowed) {
      return html`<section class="page">
        ${[emptyState('Редактирование недоступно', verdict.reason, html`<a class="btn btn--secondary" href="${backHref}">Назад к сигналу</a>`)]}
      </section>`;
    }

    const formFields = fieldsFor(actor);
    const fields = formFields.map((field) => {
      const control =
        field.type === 'textarea'
          ? html`<textarea class="field__control" name="${field.name}" rows="5">${signal[field.name]}</textarea>`
          : html`<input class="field__control" name="${field.name}" type="text" value="${signal[field.name]}" autocomplete="off" />`;

      return html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        ${[control]}
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`;
    });

    return html`
      <section class="wizard">
        <a class="link link--back" href="${backHref}">← Назад к сигналу</a>

        <h1 class="wizard__title">Редактирование сигнала</h1>
        <p class="wizard__lead">
          ${[statusBadge(signal.status)]} · категория: <strong>${categoryLabel(signal.category)}</strong>
          ${[isStaff(actor) ? html` · правка будет записана в историю от вашего имени` : '']}
        </p>

        <form class="form" id="edit-signal-form" novalidate>
          ${fields}

          <div class="form__hint form__hint--error" data-role="summary" hidden></div>

          <div class="wizard__actions">
            <a class="btn btn--ghost" href="${backHref}">Отмена</a>
            <button class="btn btn--primary" type="submit">Сохранить изменения</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root, ctx) {
    const form = root.querySelector('#edit-signal-form');
    if (!form) return;

    const signal = findAny(ctx.params.id);
    const formFields = fieldsFor(currentActor());
    const summary = form.querySelector('[data-role="summary"]');
    const button = form.querySelector('button[type="submit"]');
    const controls = new Map(formFields.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));
    const backHref = ctx.path.startsWith('/admin') ? `/admin/signal/${ctx.params.id}` : `/my/${ctx.params.id}`;

    function showErrors(errors, message = 'Заполните подсвеченные поля — изменения не сохранены.') {
      formFields.forEach((field) => {
        form.querySelector(`[data-field="${field.name}"]`).classList.toggle('is-invalid', Boolean(errors[field.name]));
        form.querySelector(`[data-error-for="${field.name}"]`).textContent = errors[field.name] ?? '';
      });
      summary.hidden = false;
      summary.textContent = message;
    }

    controls.forEach((control, name) => {
      control.addEventListener('input', () => {
        form.querySelector(`[data-field="${name}"]`).classList.remove('is-invalid');
        form.querySelector(`[data-error-for="${name}"]`).textContent = '';
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const payload = {
        // Подрядчик поля автора не видит — подставляем текущее значение,
        // чтобы форма прошла ту же проверку, что и на сервере.
        contractorName: controls.get('contractorName')?.value ?? signal?.contractorName ?? '',
        sector: controls.get('sector').value,
        description: controls.get('description').value,
      };

      const { valid, errors } = validateSignalInput(payload);
      if (!valid) {
        showErrors(errors);
        controls.get(formFields.find((field) => errors[field.name])?.name)?.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Сохраняем…';

      try {
        await updateSignal(ctx.params.id, payload);
        showToast('Изменения сохранены и записаны в историю', 'success');
        navigate(backHref);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Сохранить изменения';
        if (error.errors) showErrors(error.errors, error.message);
        else {
          summary.hidden = false;
          summary.textContent = error.message;
        }
      }
    });
  },
};
