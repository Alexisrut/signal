/**
 * Модуль «Задачи»: канбан, создание и карточка.
 *
 * Раздел намеренно изолирован от логики сигналов — здесь нет таймеров,
 * автоэскалации и почтовых уведомлений. Общая только визуальная структура.
 */

import { html, formatDateTime } from '../../core/utils.js';
import { TASK_STATUS_META, TASK_STATUS_ORDER } from '/shared/constants.js';
import { validateTaskInput } from '/shared/validation.js';
import { listAll, find, filterTasks, countByStatus, createTask, changeStatus } from '../../domain/tasks.js';
import { upload } from '../../domain/files.js';
import { downloadReport } from '../../domain/reports.js';
import { taskCard, taskBadge, emptyState, attachmentsList, fileField, bindFileField } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

const STATUS_FILTERS = [
  { id: 'all', label: 'Все статусы' },
  ...TASK_STATUS_ORDER.map((status) => ({ id: status, label: TASK_STATUS_META[status].label })),
];

/* -------------------------------- Дашборд ------------------------------------ */

export const tasksDashboardView = {
  live: true,

  render(ctx) {
    const tasks = listAll() ?? [];
    const status = ctx.query.status ?? 'all';
    const visible = filterTasks(tasks, { status });
    const counters = countByStatus(tasks);

    const stats = html`<div class="stats">
      <div class="stat stat--total">
        <span class="stat__value">${counters.total}</span><span class="stat__label">Всего задач</span>
      </div>
      ${TASK_STATUS_ORDER.map(
        (id) => html`<div class="stat stat--task-${id}">
          <span class="stat__value">${counters[id]}</span>
          <span class="stat__label">${TASK_STATUS_META[id].label}</span>
        </div>`,
      )}
    </div>`;

    const columns = TASK_STATUS_ORDER.map((id) => {
      const items = visible.filter((task) => task.status === id);
      const cards = items.map((task) => taskCard(task, { href: `#/tasks/${task.id}` }));
      return html`<section class="column">
        <header class="column__head">
          <h3>${TASK_STATUS_META[id].label}</h3>
          <span class="column__count">${items.length}</span>
        </header>
        <div class="column__body">
          ${[cards.length ? cards.join('') : html`<p class="column__empty">Нет задач</p>`]}
        </div>
      </section>`;
    });

    const chips = STATUS_FILTERS.map(
      (filter) => html`<a class="chip ${filter.id === status ? 'is-active' : ''}" href="#/tasks?status=${filter.id}"
        >${filter.label}</a
      >`,
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Задачи</h1>
            <p class="page__lead">Независимый модуль: без таймеров эскалации и почтовых уведомлений.</p>
          </div>
          <div class="page__head-actions">
            <button class="btn btn--secondary" data-action="export">Экспорт в Excel</button>
            <a class="btn btn--primary" href="#/tasks/new">Создать задачу</a>
          </div>
        </header>

        ${[stats]}

        <div class="filters">
          <div class="filters__group">
            <span class="filters__label">Статус</span>
            <div class="chips">${chips}</div>
          </div>
        </div>

        ${[
          tasks.length
            ? html`<div class="board board--wide">${columns}</div>`
            : emptyState(
                'Задач пока нет',
                'Заведите первую задачу — она появится на доске и попадет в отчет.',
                html`<a class="btn btn--primary" href="#/tasks/new">Создать задачу</a>`,
              ),
        ]}
      </section>
    `;
  },

  mount(root, ctx) {
    root.querySelector('[data-action="export"]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Формируем…';

      try {
        const { filename, rows } = await downloadReport('tasks', { status: ctx.query.status ?? 'all' });
        showToast(`Отчет ${filename} сформирован (${rows} строк)`, 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Экспорт в Excel';
      }
    });
  },
};

/* -------------------------------- Создание ----------------------------------- */

const FIELDS = [
  { name: 'title', label: 'Заголовок', type: 'input', placeholder: 'Например: Согласовать график поставок' },
  {
    name: 'description',
    label: 'Описание',
    type: 'textarea',
    placeholder: 'Что нужно сделать, с кем согласовать, к какому сроку',
  },
];

export const taskFormView = {
  live: false,

  render() {
    const fields = FIELDS.map((field) => {
      const control =
        field.type === 'textarea'
          ? html`<textarea class="field__control" name="${field.name}" rows="6" placeholder="${field.placeholder}"></textarea>`
          : html`<input class="field__control" name="${field.name}" type="text" placeholder="${field.placeholder}" autocomplete="off" />`;

      return html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        ${[control]}
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`;
    });

    return html`
      <section class="wizard">
        <a class="link link--back" href="#/tasks">← Задачи</a>
        <h1 class="wizard__title">Новая задача</h1>

        <form class="form" id="task-form" novalidate>
          ${fields}
          ${[fileField({ label: 'Вложения (необязательно)' })]}
          <div class="form__hint form__hint--error" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/tasks">Отмена</a>
            <button class="btn btn--primary" type="submit">Создать задачу</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#task-form');
    const summary = form.querySelector('[data-role="summary"]');
    const button = form.querySelector('button[type="submit"]');
    const attachments = bindFileField(form);

    const controls = new Map(FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

    function showErrors(errors, message = 'Заполните подсвеченные поля — задача не создана.') {
      FIELDS.forEach((field) => {
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
        title: controls.get('title').value,
        description: controls.get('description').value,
      };

      const { valid, errors } = validateTaskInput(payload);
      if (!valid) {
        showErrors(errors);
        controls.get(FIELDS.find((field) => errors[field.name]).name).focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Создаем…';

      try {
        const uploaded = await upload(attachments.getFiles());
        const task = await createTask({ ...payload, fileIds: uploaded.map((file) => file.id) });
        showToast('Задача создана', 'success');
        navigate(`/tasks/${task.id}`);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Создать задачу';
        if (error.errors) showErrors(error.errors, error.message);
        else {
          summary.hidden = false;
          summary.textContent = error.message;
        }
      }
    });
  },
};

/* -------------------------------- Карточка ----------------------------------- */

export const taskDetailView = {
  live: true,

  render(ctx) {
    const task = find(ctx.params.id);

    if (!task) {
      return html`<section class="page">
        ${[
          emptyState(
            'Задача не найдена',
            'Возможно, она была удалена или у вас нет доступа к модулю.',
            html`<a class="btn btn--secondary" href="#/tasks">К списку задач</a>`,
          ),
        ]}
      </section>`;
    }

    const buttons = TASK_STATUS_ORDER.filter((status) => status !== task.status).map(
      (status) => html`<button class="btn btn--secondary btn--sm" data-status="${status}">
        ${TASK_STATUS_META[status].label}
      </button>`,
    );

    return html`
      <section class="page">
        <a class="link link--back" href="#/tasks">← Задачи</a>

        <article class="detail detail--task-${task.status}">
          <header class="detail__head">
            <div class="detail__badges">${[taskBadge(task.status)]}</div>
            <h1 class="detail__title">${task.title}</h1>
            <p class="detail__subtitle">Автор: ${task.authorName}</p>
          </header>

          <dl class="detail__facts">
            <div><dt>Создана</dt><dd>${formatDateTime(task.createdAt)}</dd></div>
            <div><dt>Обновлена</dt><dd>${formatDateTime(task.updatedAt)}</dd></div>
            <div><dt>ID</dt><dd class="mono">${task.id}</dd></div>
          </dl>

          <div class="detail__section">
            <h2>Описание</h2>
            <p class="detail__text">${task.description}</p>
          </div>

          ${[
            task.attachments.length
              ? html`<div class="detail__section">
                  <h2>Вложения (${task.attachments.length})</h2>
                  ${[attachmentsList(task.attachments)]}
                </div>`
              : '',
          ]}

          <div class="detail__section">
            <h2>Перевести в статус</h2>
            <div class="detail__actions">${buttons}</div>
            <p class="detail__hint">
              Статусы задач меняются вручную и в любом направлении: таймеров и автоматических
              переходов в этом модуле нет.
            </p>
          </div>
        </article>
      </section>
    `;
  },

  mount(root, ctx) {
    root.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await changeStatus(ctx.params.id, button.dataset.status);
          showToast(`Статус задачи: ${TASK_STATUS_META[button.dataset.status].label}`, 'success');
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });
  },
};
