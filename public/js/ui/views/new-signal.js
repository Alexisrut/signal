/**
 * Создание сигнала.
 *
 * Форма спрашивает только суть проблемы: где и что. Автора она не спрашивает
 * вовсе — ни у подрядчика, ни у сотрудника. Имя подставляется сервером из
 * сессии, поэтому подписаться чужим именем нельзя даже подделав запрос.
 *
 * Категорию тоже никто не выбирает: сигнал уходит нераспределенным
 * в раздел «Распределение» к главному администратору.
 */

import { html } from '../../core/utils.js';
import { validateSignalInput } from '/shared/validation.js';
import { currentActor, isContractor, isSuperadmin } from '../../domain/session.js';
import { createSignal, lastSector } from '../../domain/signals.js';
import { upload } from '../../domain/files.js';
import { fileField, bindFileField } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/**
 * ЧЕРНОВИК ФОРМЫ.
 *
 * Хранится в localStorage под ключом с идентификатором учетной записи —
 * поэтому недописанная проблема переживает не только уход со страницы,
 * но и перезагрузку, и при этом не всплывает у другого пользователя,
 * вошедшего в том же браузере. Вернулся в свой аккаунт — текст на месте.
 */
const DRAFT_PREFIX = 'sms-draft-signal:';

const draftKey = (actor) => `${DRAFT_PREFIX}${actor.id}`;

const EMPTY_DRAFT = { sector: '', description: '' };

function readDraft(actor) {
  if (!actor.id) return { ...EMPTY_DRAFT };
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey(actor)) ?? 'null');
    if (!stored || typeof stored !== 'object') return { ...EMPTY_DRAFT };
    return { sector: String(stored.sector ?? ''), description: String(stored.description ?? '') };
  } catch {
    return { ...EMPTY_DRAFT }; // приватный режим или битое значение — начинаем с чистого
  }
}

function writeDraft(actor, draft) {
  if (!actor.id) return;
  try {
    // Пустой черновик не храним: иначе он перебивал бы автоподстановку сектора.
    if (!draft.sector.trim() && !draft.description.trim()) localStorage.removeItem(draftKey(actor));
    else localStorage.setItem(draftKey(actor), JSON.stringify(draft));
  } catch {
    /* сохранять некуда — черновик проживет до ухода со страницы */
  }
}

function clearDraft(actor) {
  try {
    localStorage.removeItem(draftKey(actor));
  } catch {
    /* нечего чистить */
  }
}

const FIELDS = [
  { name: 'sector', label: 'Сектор работы', placeholder: 'Например: Блок Б, 3 этаж', type: 'input' },
  {
    name: 'description',
    label: 'Описание проблемы',
    placeholder: 'Что произошло, где и что мешает продолжать работы (минимум 10 символов)',
    type: 'textarea',
  },
];

/** Имя, под которым сигнал уйдет в систему, — то же, что подставит сервер. */
function authorName(actor) {
  return isContractor(actor) ? (actor.companyName ?? actor.displayName) : actor.displayName;
}

export const newSignalView = {
  live: false,

  render() {
    const actor = currentActor();
    const draft = readDraft(actor);

    // Сектор подставляется из прошлого сигнала этого же аккаунта и только
    // в пустое поле: свой текст и сохраненный черновик подстановка не трогает.
    if (!draft.sector) draft.sector = lastSector() ?? '';

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
          ${isContractor(actor)
            ? 'Следить за ходом рассмотрения можно в разделе «Мои сигналы».'
            : 'Сигнал уйдет главному администратору на распределение.'}
        </p>

        <form class="form" id="signal-form" novalidate>
          <div class="author-note">
            <span class="author-note__label">Сигнал будет подан от имени</span>
            <strong class="author-note__value">${authorName(actor)}</strong>
          </div>

          ${fields}
          ${[fileField({ label: 'Вложения (необязательно)' })]}
          <div class="form__hint form__hint--error" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="${isContractor(actor) ? '#/my' : '#/'}">Отмена</a>
            <button class="btn btn--primary" type="submit">Отправить сигнал</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const actor = currentActor();
    const form = root.querySelector('#signal-form');
    const summary = form.querySelector('[data-role="summary"]');
    const submitButton = form.querySelector('button[type="submit"]');
    const attachments = bindFileField(form);
    let submitted = false;

    const controls = new Map(FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

    // Черновик берется из полей, а не из хранилища заново: в поле сектора уже
    // может стоять подстановка из прошлого сигнала, и перечитывание затерло бы
    // ее пустым значением при первом же вводе описания.
    const draft = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));

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
        writeDraft(actor, draft);
        form.querySelector(`[data-field="${name}"]`).classList.remove('is-invalid');
        form.querySelector(`[data-error-for="${name}"]`).textContent = '';
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      // Валидация выполняется до любого сетевого вызова: пустая форма не уходит.
      event.preventDefault();

      const payload = {
        sector: controls.get('sector').value,
        description: controls.get('description').value,
      };

      // Имя автора проверяем тем же правилом, что и сервер, но берем его
      // из сессии: в теле запроса этого поля нет вовсе.
      const { valid, errors } = validateSignalInput({ ...payload, contractorName: authorName(actor) });
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
        clearDraft(actor);
        attachments.clear();
        showToast('Сигнал создан и отправлен на рассмотрение', 'success');

        // Подрядчик идет к своей карточке. Сотруднику вести некуда: сигнал
        // еще не распределен, и увидеть его может только главный администратор.
        if (isContractor(actor)) navigate(`/my/${signal.id}`);
        else navigate(isSuperadmin(actor) ? '/admin/distribution' : '/');
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
      writeDraft(actor, draft);
    };
  },
};
