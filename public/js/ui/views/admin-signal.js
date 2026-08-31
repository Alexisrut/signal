/** Детальная карточка сигнала для сотрудника: просмотр, история, управление статусом. */

import { html, formatDateTime } from '../../core/utils.js';
import { STATUS, STATUS_META, ESCALATION_MS, CATEGORIES, categoryLabel } from '/shared/constants.js';
import { canAssignOthers, canEdit, canReopen, canTransition, isActive } from '/shared/state-machine.js';
import { currentActor, isSuperadmin } from '../../domain/session.js';
import {
  findAny,
  authorLabel,
  changeStatus,
  reopenSignal,
  setAssignee,
  assignPeople,
  distribute,
  markSeen,
  unreadCount,
} from '../../domain/signals.js';
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
  resolutionTimer,
} from '../components.js';
import { openAssignDialog } from '../assign-dialog.js';
import { confirmDialog } from '../modal.js';
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
    const active = isActive(signal.status);
    const reopenVerdict = canReopen(signal, actor);
    // Состав кураторов целиком за главным администратором: остальные роли
    // задачу ведут, но не раздают и никого с нее не снимают.
    const distributes = canAssignOthers(signal, actor).allowed;

    // Кураторами занимается только главный администратор через окно назначения:
    // брать сигнал на себя и выходить из него вручную больше нельзя никому.
    const actions = active
      ? html`
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
      : html`
          ${[
            reopenVerdict.allowed
              ? html`<button class="btn btn--primary" data-action="reopen"
                  title="Вернуть сигнал в работу — отсчет времени решения продолжится">
                  Возобновить работу
                </button>`
              : html`<span class="detail__note">
                  Статус «${STATUS_META[signal.status].short}» закрыт. ${reopenVerdict.reason}.
                </span>`,
          ]}
        `;

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

          <div class="detail__timer">${[resolutionTimer(signal, { now, size: 'lg' })]}</div>

          <dl class="detail__facts">
            <div><dt>Автор</dt><dd>${authorLabel(signal.id)}</dd></div>
            <div><dt>Категория</dt><dd>${categoryLabel(signal.category)}</dd></div>
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            ${[
              signal.closedAt
                ? html`<div><dt>Закрыт</dt><dd>${formatDateTime(signal.closedAt)}</dd></div>`
                : '',
            ]}
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
            <div><dt>ID</dt><dd class="mono">${signal.id}</dd></div>
          </dl>

          ${[
            signal.assignmentNote
              ? html`<div class="note-card">
                  <span class="note-card__label">Заметка к распределению</span>
                  <p class="note-card__text">${signal.assignmentNote}</p>
                </div>`
              : '',
          ]}

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
            <div class="detail__section-head">
              <h2>Кураторы (${signal.assignees.length})</h2>
              ${[
                distributes
                  ? html`<button class="btn btn--secondary btn--sm" data-action="assign-people">
                      Назначить руководителей
                    </button>`
                  : '',
              ]}
            </div>
            ${[assigneeRoster(signal, { removable: distributes })]}
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

          <div class="detail__section">
            <h2>История событий</h2>
            ${[historyList(signal.history)]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root, ctx) {
    // Открытие карточки — это и есть «прочитано»: индикатор новых изменений гаснет.
    if (unreadCount(ctx.params.id)) markSeen(ctx.params.id).catch(() => {});

    // Снять куратора с задачи — идентификатор берется из кнопки в списке.
    root.querySelectorAll('[data-release]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await setAssignee(ctx.params.id, false, button.dataset.release);
          showToast('Куратор снят с задачи', 'success');
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });

    root.querySelector('[data-action="assign-people"]')?.addEventListener('click', async (event) => {
      // currentTarget обнуляется после всплытия события, поэтому кнопку
      // запоминаем до открытия окна — оно ждет ответа пользователя.
      const button = event.currentTarget;
      const signal = findAny(ctx.params.id);
      const picked = await openAssignDialog({ signal, category: signal?.category });
      if (!picked) return;

      button.disabled = true;

      try {
        const updated = await assignPeople(ctx.params.id, picked.assignees, picked.note);
        showToast(`Исполнителей по сигналу: ${updated.assignees.length}`, 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
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
        // Красный статус эскалирует проблему и рассылает письма — спрашиваем.
        if (button.dataset.status === STATUS.RED) {
          const confirmed = await confirmDialog({
            title: 'Перевод в красный статус',
            message: 'Вы точно хотите перевести сигнал в красный статус?',
            confirmLabel: 'Перевести в красный',
            tone: 'primary',
          });
          if (!confirmed) return;
        }

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

    root.querySelector('[data-action="reopen"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const signal = await reopenSignal(ctx.params.id);
        showToast(`Сигнал возобновлен: ${STATUS_META[signal.status].label}`, 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
    });

  },
};
