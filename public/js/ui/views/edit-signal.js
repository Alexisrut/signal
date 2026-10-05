/**
 * Редактирование сигнала.
 *
 * Правки не переписывают карточку молча: сервер сравнивает поля со старыми
 * значениями и пишет в историю, кто именно и что поменял. К сигналу можно
 * приложить новые файлы и пояснение.
 *
 * Эта же форма — доработка сигнала подрядчиком после возврата с входного
 * контроля: сверху комментарий проверяющего, снизу кнопка «Отправить на
 * повторную проверку».
 */

import { html, formatDateTime } from '../../core/utils.js';
import { SIGNAL_ACTION, categoryLabel } from '/shared/constants.js';
import { validateComment, validateSignalInput } from '/shared/validation.js';
import { can, canEdit } from '/shared/state-machine.js';
import { currentActor, isStaff, isSuperadmin } from '../../domain/session.js';
import { findAny, lastAction, updateSignal } from '../../domain/signals.js';
import { bindFileField, emptyState, fileField, numberTag, statusBadge } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/** Доработка после возврата с входного контроля — правка автором с отправкой на проверку. */
const isResubmit = (signal, actor) => can(SIGNAL_ACTION.RESUBMIT, signal, actor).allowed;

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
    const resubmit = isResubmit(signal, actor);
    const returned = resubmit ? lastAction(signal, SIGNAL_ACTION.INTAKE_RETURN) : null;
    // Заметку к распределению правит только главный администратор: это
    // сообщение кураторам, и переписывать его на ходу может лишь тот,
    // кто задачу раздавал.
    const editsNote = isSuperadmin(actor);
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

        <h1 class="wizard__title">${resubmit ? 'Доработка сигнала' : 'Редактирование сигнала'}</h1>
        <p class="wizard__lead">
          ${[numberTag(signal)]} ${[statusBadge(signal.status)]}
          ${[signal.category ? html` · категория: <strong>${categoryLabel(signal.category)}</strong>` : '']}
          ${[isStaff(actor) ? html` · правка будет записана в историю от вашего имени` : '']}
        </p>

        ${[
          returned
            ? html`<div class="callout callout--rework">
                <span class="callout__title">Что нужно дополнить</span>
                <span class="callout__meta">${formatDateTime(returned.at)} · ${returned.byName}</span>
                <div class="callout__quote">${returned.note}</div>
              </div>`
            : '',
        ]}

        <form class="form" id="edit-signal-form" novalidate>
          ${fields}

          ${[fileField({ label: 'Добавить файлы (необязательно)' })]}

          <label class="field" data-field="comment">
            <span class="field__label">${resubmit ? 'Пояснение для проверяющего' : 'Комментарий к изменениям'}</span>
            <textarea class="field__control" name="comment" rows="3"
              placeholder="${resubmit
                ? 'Что дополнено или уточнено (необязательно, если это видно из правок и файлов)'
                : 'Необязательно — попадет в ленту событий и в письмо участникам'}"></textarea>
            <span class="field__error" data-error-for="comment"></span>
          </label>

          ${[
            editsNote
              ? html`<label class="field" data-field="assignmentNote">
                  <span class="field__label">Заметка к распределению</span>
                  <textarea class="field__control" name="assignmentNote" rows="3"
                    placeholder="Что важно учесть кураторам (необязательно)">${signal.assignmentNote ?? ''}</textarea>
                  <span class="field__hint">
                    Видна кураторам задачи. Изменение попадет в историю событий отдельной записью.
                  </span>
                </label>`
              : '',
          ]}

          <div class="form__hint form__hint--error" data-role="summary" hidden></div>

          <div class="wizard__actions">
            <a class="btn btn--ghost" href="${backHref}">Отмена</a>
            <button class="btn btn--primary" type="submit">
              ${resubmit ? 'Отправить на повторную проверку' : 'Сохранить изменения'}
            </button>
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
    const resubmit = isResubmit(signal, currentActor());
    const submitLabel = resubmit ? 'Отправить на повторную проверку' : 'Сохранить изменения';
    const attachments = bindFileField(form);
    const commentControl = form.querySelector('[name="comment"]');
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

    [...controls, ['comment', commentControl]].forEach(([name, control]) => {
      control.addEventListener('input', () => {
        form.querySelector(`[data-field="${name}"]`).classList.remove('is-invalid');
        form.querySelector(`[data-error-for="${name}"]`).textContent = '';
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const noteControl = form.querySelector('[name="assignmentNote"]');
      const payload = {
        // Подрядчик поля автора не видит — подставляем текущее значение,
        // чтобы форма прошла ту же проверку, что и на сервере.
        contractorName: controls.get('contractorName')?.value ?? signal?.contractorName ?? '',
        sector: controls.get('sector').value,
        description: controls.get('description').value,
        // Ключа нет вовсе, когда поля нет: сервер отличает «не трогали»
        // от «очистили» именно по его отсутствию.
        ...(noteControl ? { assignmentNote: noteControl.value } : {}),
        comment: commentControl.value,
        resubmit,
      };

      const { valid, errors } = validateSignalInput(payload);
      const commentError = validateComment(payload.comment, { required: false });
      if (commentError) errors.comment = commentError;
      if (!valid || commentError) {
        showErrors(errors);
        form.querySelector(`[data-field="comment"]`).classList.toggle('is-invalid', Boolean(commentError));
        form.querySelector(`[data-error-for="comment"]`).textContent = commentError ?? '';
        controls.get(formFields.find((field) => errors[field.name])?.name)?.focus();
        return;
      }

      button.disabled = true;
      button.textContent = attachments.getFiles().length ? 'Загружаем файлы…' : 'Сохраняем…';

      try {
        await updateSignal(ctx.params.id, payload, attachments.getFiles());
        showToast(
          resubmit ? 'Сигнал дополнен и отправлен на повторную проверку' : 'Изменения сохранены и записаны в историю',
          'success',
        );
        navigate(backHref);
      } catch (error) {
        button.disabled = false;
        button.textContent = submitLabel;
        if (error.errors) showErrors(error.errors, error.message);
        else {
          summary.hidden = false;
          summary.textContent = error.message;
        }
      }
    });
  },
};
