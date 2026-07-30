/**
 * Двухшаговое создание сигнала.
 * Шаг 1 — выбор линии (с возможностью пропуска), шаг 2 — форма со строгой валидацией.
 * Флоу общий для подрядчика и для администратора, создающего сигнал от своего лица.
 */

import { html } from '../../core/utils.js';
import { LINES, LINE, lineLabel, ROLE } from '../../core/constants.js';
import { currentActor } from '../../domain/auth.js';
import { createSignal, validateSignalInput } from '../../domain/signals.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/** Черновик формы живет между шагами и переживает возврат «назад». */
const draft = { line: LINE.NONE, contractorName: '', sector: '', description: '' };

export function resetDraft() {
  draft.line = LINE.NONE;
  draft.contractorName = '';
  draft.sector = '';
  draft.description = '';
}

function queryToLine(value) {
  if (!value || value === 'none') return LINE.NONE;
  return LINES.some((l) => l.id === value) ? value : LINE.NONE;
}

function lineToQuery(line) {
  return line === LINE.NONE ? 'none' : line;
}

/* --------------------------------- Шаг 1 ------------------------------------- */

export const chooseLineView = {
  live: false,

  render() {
    const options = LINES.map(
      (line) => html`<button class="line-option ${draft.line === line.id ? 'is-selected' : ''}"
        data-line="${line.id}" type="button">
        <span class="line-option__mark line-option__mark--${line.id}"></span>
        <span class="line-option__body">
          <strong>${line.label}</strong>
          <small>${line.hint}</small>
        </span>
      </button>`,
    );

    return html`
      <section class="wizard">
        <div class="wizard__steps">
          <span class="wizard__step is-active">1. Линия сигнала</span>
          <span class="wizard__sep"></span>
          <span class="wizard__step">2. Описание проблемы</span>
        </div>

        <h1 class="wizard__title">К какой линии относится проблема?</h1>
        <p class="wizard__lead">Выбор линии помогает быстрее направить сигнал нужным специалистам. Шаг можно пропустить.</p>

        <div class="line-options">${options}</div>

        <div class="wizard__actions">
          <a class="btn btn--ghost" href="#/">Отмена</a>
          <button class="btn btn--secondary" type="button" data-action="skip">Пропустить</button>
        </div>
      </section>
    `;
  },

  mount(root) {
    root.querySelectorAll('[data-line]').forEach((button) => {
      button.addEventListener('click', () => {
        draft.line = button.dataset.line;
        navigate(`/new/form?line=${lineToQuery(draft.line)}`);
      });
    });

    root.querySelector('[data-action="skip"]').addEventListener('click', () => {
      draft.line = LINE.NONE;
      navigate('/new/form?line=none');
    });
  },
};

/* --------------------------------- Шаг 2 ------------------------------------- */

const FIELDS = [
  {
    name: 'contractorName',
    label: 'Подрядчик',
    placeholder: 'Например: ООО «СтройМонтаж»',
    type: 'input',
  },
  {
    name: 'sector',
    label: 'Сектор работы',
    placeholder: 'Например: Блок Б, 3 этаж',
    type: 'input',
  },
  {
    name: 'description',
    label: 'Описание проблемы',
    placeholder: 'Что произошло, где и что мешает продолжать работы (минимум 10 символов)',
    type: 'textarea',
  },
];

export const signalFormView = {
  live: false,

  render(ctx) {
    draft.line = queryToLine(ctx.query.line);
    const actor = currentActor();

    const fields = FIELDS.map((field) => {
      const control =
        field.type === 'textarea'
          ? html`<textarea class="field__control" id="f-${field.name}" name="${field.name}" rows="5"
              placeholder="${field.placeholder}">${draft[field.name]}</textarea>`
          : html`<input class="field__control" id="f-${field.name}" name="${field.name}" type="text"
              placeholder="${field.placeholder}" value="${draft[field.name]}" autocomplete="off" />`;

      return html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        ${[control]}
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`;
    });

    return html`
      <section class="wizard">
        <div class="wizard__steps">
          <a class="wizard__step is-done" href="#/new">1. Линия сигнала</a>
          <span class="wizard__sep"></span>
          <span class="wizard__step is-active">2. Описание проблемы</span>
        </div>

        <h1 class="wizard__title">Опишите проблему</h1>
        <p class="wizard__lead">
          Линия: <strong>${lineLabel(draft.line)}</strong> ·
          <a class="link" href="#/new">изменить</a>
          ${[actor.role === ROLE.ADMIN ? html` · сигнал будет создан от имени администратора` : '']}
        </p>

        <form class="form" id="signal-form" novalidate>
          ${fields}
          <div class="form__hint" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/new">Назад</a>
            <button class="btn btn--primary" type="submit">Отправить сигнал</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#signal-form');
    const summary = form.querySelector('[data-role="summary"]');
    let submitted = false;

    const controls = new Map(
      FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]),
    );

    function clearError(name) {
      const wrapper = form.querySelector(`[data-field="${name}"]`);
      wrapper.classList.remove('is-invalid');
      form.querySelector(`[data-error-for="${name}"]`).textContent = '';
    }

    function showErrors(errors) {
      for (const field of FIELDS) {
        const wrapper = form.querySelector(`[data-field="${field.name}"]`);
        const slot = form.querySelector(`[data-error-for="${field.name}"]`);
        if (errors[field.name]) {
          wrapper.classList.add('is-invalid');
          slot.textContent = errors[field.name];
        } else {
          wrapper.classList.remove('is-invalid');
          slot.textContent = '';
        }
      }
      const first = FIELDS.find((field) => errors[field.name]);
      if (first) controls.get(first.name).focus();

      summary.hidden = false;
      summary.className = 'form__hint form__hint--error';
      summary.textContent = 'Заполните подсвеченные поля — сигнал не отправлен.';
    }

    controls.forEach((control, name) => {
      control.addEventListener('input', () => {
        draft[name] = control.value;
        clearError(name);
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', (event) => {
      // Валидация выполняется до любого обращения к data-слою: пустая форма не уходит.
      event.preventDefault();

      const payload = {
        line: draft.line,
        contractorName: controls.get('contractorName').value,
        sector: controls.get('sector').value,
        description: controls.get('description').value,
      };

      const { valid, errors } = validateSignalInput(payload);
      if (!valid) {
        showErrors(errors);
        return;
      }

      const result = createSignal(payload, currentActor());
      if (!result.ok) {
        showErrors(result.errors);
        return;
      }

      submitted = true;
      resetDraft();
      showToast('Сигнал создан и получил статус «Новая проблема»', 'success');
      navigate(`/my/${result.signal.id}`);
    });

    // Возврат к первому шагу не должен терять уже введенный текст.
    return () => {
      if (submitted) return;
      controls.forEach((control, name) => {
        draft[name] = control.value;
      });
    };
  },
};
