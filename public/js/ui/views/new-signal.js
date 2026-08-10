/**
 * Создание сигнала подрядчиком.
 *
 * Категорию подрядчик не выбирает: сигнал уходит нераспределенным и попадает
 * в раздел «Распределение» к главному администратору. Валидация строгая —
 * пустые поля подсвечиваются до любого сетевого вызова.
 */

import { html } from '../../core/utils.js';
import { validateSignalInput } from '/shared/validation.js';
import { currentActor } from '../../domain/session.js';
import { createSignal } from '../../domain/signals.js';
import { upload } from '../../domain/files.js';
import { fileField, bindFileField } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/** Черновик переживает уход со страницы и возврат назад. */
const draft = { contractorName: '', sector: '', description: '' };

function resetDraft() {
  draft.contractorName = '';
  draft.sector = '';
  draft.description = '';
}

const FIELDS = [
  { name: 'contractorName', label: 'Подрядчик', placeholder: 'Например: ООО «СтройМонтаж»', type: 'input' },
  { name: 'sector', label: 'Сектор работы', placeholder: 'Например: Блок Б, 3 этаж', type: 'input' },
  {
    name: 'description',
    label: 'Описание проблемы',
    placeholder: 'Что произошло, где и что мешает продолжать работы (минимум 10 символов)',
    type: 'textarea',
  },
];

export const newSignalView = {
  live: false,

  render() {
    const actor = currentActor();

    // Название компании подставляется сразу: подрядчик сообщает о себе.
    if (!draft.contractorName && actor.companyName) draft.contractorName = actor.companyName;

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
        <h1 class="wizard__title">Опишите проблему</h1>
        <p class="wizard__lead">
          Сигнал получит статус «Новая проблема» и уйдет главному администратору на распределение
          по категориям. Следить за ходом рассмотрения можно в разделе «Мои сигналы».
        </p>

        <form class="form" id="signal-form" novalidate>
          ${fields}
          ${[fileField({ label: 'Вложения (необязательно)' })]}
          <div class="form__hint form__hint--error" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/my">Отмена</a>
            <button class="btn btn--primary" type="submit">Отправить сигнал</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#signal-form');
    const summary = form.querySelector('[data-role="summary"]');
    const submitButton = form.querySelector('button[type="submit"]');
    const attachments = bindFileField(form);
    let submitted = false;

    const controls = new Map(FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

    function showErrors(errors, message = 'Заполните подсвеченные поля — сигнал не отправлен.') {
      for (const field of FIELDS) {
        const wrapper = form.querySelector(`[data-field="${field.name}"]`);
        const slot = form.querySelector(`[data-error-for="${field.name}"]`);
        wrapper.classList.toggle('is-invalid', Boolean(errors[field.name]));
        slot.textContent = errors[field.name] ?? '';
      }

      const first = FIELDS.find((field) => errors[field.name]);
      if (first) controls.get(first.name).focus();

      summary.hidden = false;
      summary.textContent = message;
    }

    controls.forEach((control, name) => {
      control.addEventListener('input', () => {
        draft[name] = control.value;
        form.querySelector(`[data-field="${name}"]`).classList.remove('is-invalid');
        form.querySelector(`[data-error-for="${name}"]`).textContent = '';
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      // Валидация выполняется до любого сетевого вызова: пустая форма не уходит.
      event.preventDefault();

      const payload = {
        contractorName: controls.get('contractorName').value,
        sector: controls.get('sector').value,
        description: controls.get('description').value,
      };

      const { valid, errors } = validateSignalInput(payload);
      if (!valid) {
        showErrors(errors);
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Отправляем…';

      try {
        // Файлы уходят отдельным асинхронным запросом, к сигналу привязываются их id.
        const files = attachments.getFiles();
        if (files.length) submitButton.textContent = `Загружаем файлы (${files.length})…`;
        const uploaded = await upload(files);

        submitButton.textContent = 'Отправляем…';
        const signal = await createSignal({ ...payload, fileIds: uploaded.map((file) => file.id) });

        submitted = true;
        resetDraft();
        attachments.clear();
        showToast('Сигнал создан и получил статус «Новая проблема»', 'success');
        navigate(`/my/${signal.id}`);
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Отправить сигнал';
        if (error.errors) showErrors(error.errors, error.message);
        else {
          summary.hidden = false;
          summary.textContent = error.message;
        }
      }
    });

    // Уход со страницы не должен терять уже введенный текст.
    return () => {
      if (submitted) return;
      controls.forEach((control, name) => {
        draft[name] = control.value;
      });
    };
  },
};
