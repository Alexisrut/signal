/** Детальная карточка сигнала для администратора: просмотр, история, управление статусом. */

import { html, formatDateTime } from '../../core/utils.js';
import { STATUS, STATUS_META, ESCALATION_MS, CATEGORIES, categoryLabel } from '/shared/constants.js';
import { canAssign, canEdit, canTransition, isActive, isAssignedTo } from '/shared/state-machine.js';
import { currentActor, isSuperadmin } from '../../domain/session.js';
import { findAny, authorLabel, changeStatus, ageSignal, setAssignee, distribute } from '../../domain/signals.js';
import {
  statusBadge,
  categoryTag,
  historyList,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsList,
  assigneeChip,
  assigneeRoster,
} from '../components.js';
import { showToast } from '../chrome.js';

export const adminSignalView = {
  live: true,

  render(ctx) {
    const actor = currentActor();
    const signal = findAny(ctx.params.id);

    if (!signal) {
      return html`<section class="page">
        ${[
          emptyState(
            'Сигнал не найден',
            'Проверьте ссылку — возможно, сигнал был удален.',
            html`<a class="btn btn--secondary" href="#/admin">К карте сигналов</a>`,
          ),
        ]}
      </section>`;
    }

    const now = Date.now();
    const canResolve = canTransition(signal, STATUS.GREEN, actor).allowed;
    const canReject = canTransition(signal, STATUS.GRAY, actor).allowed;
    const canEscalate = canTransition(signal, STATUS.RED, actor).allowed;
    const takeVerdict = canAssign(signal, actor);
    const mine = isAssignedTo(signal, actor.id);
    const active = isActive(signal.status);

    const actions = active
      ? html`
          ${[
            mine
              ? html`<button class="btn btn--ghost" data-release="${actor.id}">Выйти из работы</button>`
              : html`<button class="btn btn--primary" data-assign="true" ${[takeVerdict.allowed ? '' : 'disabled']}
                  title="${takeVerdict.allowed ? 'Взять сигнал на себя' : takeVerdict.reason}">
                  Принять в работу
                </button>`,
          ]}
          <button class="btn btn--success" data-status="${STATUS.GREEN}" ${[canResolve ? '' : 'disabled']}>
            Проблема решена
          </button>
          <button class="btn btn--muted" data-status="${STATUS.GRAY}" ${[canReject ? '' : 'disabled']}>
            Отклонить сигнал
          </button>
          ${[
            canEscalate
              ? html`<button class="btn btn--danger" data-status="${STATUS.RED}"
                  title="Не дожидаясь порога 48 часов">
                  Перевести в Красный
                </button>`
              : '',
          ]}
        `
      : html`<span class="detail__note">
          Статус «${STATUS_META[signal.status].short}» терминальный — дальнейшие изменения запрещены.
        </span>`;

    return html`
      <section class="page">
        <div class="page__crumbs">
          <a class="link link--back" href="#/admin">← Карта сигналов</a>
          ${[
            canEdit(signal, actor).allowed
              ? html`<a class="btn btn--secondary btn--sm" href="#/admin/signal/${signal.id}/edit">Редактировать</a>`
              : '',
          ]}
        </div>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[statusBadge(signal.status, { withHint: true })]} ${[categoryTag(signal.category)]}
              ${[assigneeChip(signal, { compact: false })]}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          <dl class="detail__facts">
            <div><dt>Автор</dt><dd>${authorLabel(signal.id)}</dd></div>
            <div><dt>Категория</dt><dd>${categoryLabel(signal.category)}</dd></div>
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
            <div><dt>ID</dt><dd class="mono">${signal.id}</dd></div>
          </dl>

          ${[
            isSuperadmin(actor)
              ? html`<div class="detail__section">
                  <h2>Категория</h2>
                  <div class="distribute">
                    <span class="distribute__label">
                      ${signal.category ? 'Изменить категорию:' : 'Сигнал не распределен — выберите категорию:'}
                    </span>
                    <div class="distribute__actions">
                      ${CATEGORIES.map(
                        (category) => html`<button class="btn btn--secondary btn--sm ${
                          signal.category === category.id ? 'is-active' : ''
                        }" data-category="${category.id}" ${[signal.category === category.id ? 'disabled' : '']}>
                          ${category.label}
                        </button>`,
                      )}
                    </div>
                  </div>
                </div>`
              : '',
          ]}

          <div class="detail__section">
            <h2>Исполнители (${signal.assignees.length})</h2>
            ${[assigneeRoster(signal, { removable: true })]}
          </div>

          <div class="detail__section">
            <h2>Описание</h2>
            <p class="detail__text">${signal.description}</p>
          </div>

          ${[
            signal.attachments.length
              ? html`<div class="detail__section">
                  <h2>Вложения (${signal.attachments.length})</h2>
                  ${[attachmentsList(signal.attachments)]}
                </div>`
              : '',
          ]}

          ${[
            signal.status === STATUS.YELLOW
              ? html`<div class="detail__escalation">${[escalationHint(signal, now)]}</div>`
              : '',
          ]}

          <div class="detail__actions">${[actions]}</div>
          <p class="detail__hint">
            Желтый статус выставляется только автоматически при создании. Красный ставит фоновый
            процесс через ${Math.round(ESCALATION_MS / 3600000)} часов — либо администратор вручную,
            не дожидаясь порога; в истории эти случаи различимы по автору события.
          </p>

          ${[
            signal.status === STATUS.YELLOW
              ? html`<div class="devtool">
                  <span class="devtool__label">Демо-режим</span>
                  <button class="btn btn--ghost btn--sm" data-age="${signal.id}">Состарить сигнал на 48 часов</button>
                  <small>Меняет только метки времени. Красный статус все равно выставит фоновый процесс сервера.</small>
                </div>`
              : '',
          ]}

          <div class="detail__section">
            <h2>История событий</h2>
            ${[historyList(signal.history)]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root, ctx) {
    root.querySelectorAll('[data-assign]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const signal = await setAssignee(ctx.params.id, true);
          showToast(`Исполнителей по сигналу: ${signal.assignees.length}`, 'success');
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });

    // Снять можно и себя, и коллегу — идентификатор берется из кнопки.
    root.querySelectorAll('[data-release]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await setAssignee(ctx.params.id, false, button.dataset.release);
          showToast('Исполнитель снят', 'success');
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });

    // Распределение доступно только главному администратору — кнопки рисуются под его ролью.
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const group = button.closest('.distribute__actions');
        group?.querySelectorAll('button').forEach((item) => (item.disabled = true));
        try {
          await distribute(ctx.params.id, button.dataset.category);
          showToast(`Сигнал направлен в «${categoryLabel(button.dataset.category)}»`, 'success');
        } catch (error) {
          group?.querySelectorAll('button').forEach((item) => (item.disabled = false));
          showToast(error.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await changeStatus(ctx.params.id, button.dataset.status);
          showToast(`Статус изменен: ${STATUS_META[button.dataset.status].label}`, 'success');
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });

    root.querySelector('[data-age]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await ageSignal(event.currentTarget.dataset.age);
        showToast('Метки времени сдвинуты — дождитесь тика фонового процесса', 'info');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  },
};
