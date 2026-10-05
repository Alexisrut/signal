/**
 * Детальная карточка сигнала для сотрудника: просмотр, переписка, история,
 * действия входного контроля и работы со статусом.
 */

import { html, formatDateTime } from '../../core/utils.js';
import { STATUS, STATUS_META, SIGNAL_ACTION, ESCALATION_MS, CATEGORIES, categoryLabel } from '/shared/constants.js';
import { can, canAssignOthers, canComment, canEdit, canReopen, isActive } from '/shared/state-machine.js';
import { currentActor, isSuperadmin } from '../../domain/session.js';
import {
  findAny,
  authorLabel,
  setAssignee,
  assignPeople,
  distribute,
  markSeen,
  unreadCount,
  lastAction,
} from '../../domain/signals.js';
import {
  statusBadge,
  numberTag,
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
import {
  commentOnSignal,
  escalateSignal,
  rejectSignal,
  reopen,
  resolveSignal,
  returnToContractor,
} from '../signal-actions.js';
import { showToast } from '../chrome.js';

/** Кнопки категорий: на входном контроле — распределение, в работе — смена категории. */
function categoryButtons(signal) {
  return CATEGORIES.map(
    (category) => html`<button class="btn btn--secondary btn--sm ${signal.category === category.id ? 'is-active' : ''}"
      data-category="${category.id}" ${[signal.category === category.id ? 'disabled' : '']}>
      ${category.label}
    </button>`,
  );
}

/** Плашка над описанием: что сейчас происходит с сигналом и что можно сделать. */
function stageCallout(signal, actor) {
  if (signal.status === STATUS.INTAKE) {
    const resubmitted = lastAction(signal, SIGNAL_ACTION.RESUBMIT);
    const checks = isSuperadmin(actor);

    return html`<div class="callout callout--intake">
      <span class="callout__title">Сигнал на входном контроле</span>
      <span class="callout__text">
        ${checks
          ? 'Проверьте, достаточно ли данных для работы. Хватает — распределите сигнал ответственному, не хватает — верните подрядчику с комментарием.'
          : 'Главный администратор проверяет, достаточно ли в сигнале данных, чтобы передать его в работу.'}
      </span>
      ${[
        resubmitted
          ? html`<span class="callout__meta">Доработан ${formatDateTime(resubmitted.at)} · ${resubmitted.byName}</span>
              <div class="callout__quote">${resubmitted.note}</div>`
          : '',
      ]}
      ${[
        checks
          ? html`<div class="distribute">
                <span class="distribute__label">Данных достаточно — распределить в категорию:</span>
                <div class="distribute__actions">${categoryButtons(signal)}</div>
              </div>
              <div class="callout__actions">
                ${[
                  can(SIGNAL_ACTION.INTAKE_RETURN, signal, actor).allowed
                    ? html`<button class="btn btn--secondary" data-action="return">Вернуть подрядчику на доработку</button>`
                    : '',
                ]}
                ${[
                  can(SIGNAL_ACTION.REJECT, signal, actor).allowed
                    ? html`<button class="btn btn--muted" data-action="reject">Отклонить</button>`
                    : '',
                ]}
              </div>`
          : '',
      ]}
    </div>`;
  }

  if (signal.status === STATUS.REWORK) {
    const returned = lastAction(signal, SIGNAL_ACTION.INTAKE_RETURN);
    return html`<div class="callout callout--rework">
      <span class="callout__title">На доработке у подрядчика</span>
      <span class="callout__text">
        Подрядчик дополняет сигнал. После его ответа сигнал снова придет на входной контроль.
      </span>
      ${[
        returned
          ? html`<span class="callout__meta">Возвращен ${formatDateTime(returned.at)} · ${returned.byName}</span>
              <div class="callout__quote">${returned.note}</div>`
          : '',
      ]}
    </div>`;
  }

  return '';
}

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
    const active = isActive(signal.status);
    const reopenVerdict = canReopen(signal, actor);
    // Состав кураторов целиком за главным администратором: остальные роли
    // задачу ведут, но не раздают и никого с нее не снимают.
    const distributes = canAssignOthers(signal, actor).allowed;
    const distributed = Boolean(signal.category);

    const canResolve = can(SIGNAL_ACTION.RESOLVE, signal, actor).allowed;
    // На входном контроле кнопка «Отклонить» живет в плашке проверки.
    const canReject = signal.status !== STATUS.INTAKE && can(SIGNAL_ACTION.REJECT, signal, actor).allowed;
    const canEscalate = can(SIGNAL_ACTION.ESCALATE, signal, actor).allowed;
    const comments = canComment(signal, actor).allowed;

    const back = !distributed && isSuperadmin(actor)
      ? html`<a class="link link--back" href="#/admin/distribution">← Входной контроль</a>`
      : html`<a class="link link--back" href="#/admin">← Карта сигналов</a>`;

    const actions = active
      ? html`
          ${[canResolve ? html`<button class="btn btn--success" data-action="resolve">Проблема решена</button>` : '']}
          ${[canReject ? html`<button class="btn btn--muted" data-action="reject">Отклонить сигнал</button>` : '']}
          ${[
            canEscalate
              ? html`<button class="btn btn--danger" data-action="escalate" title="Не дожидаясь порога 48 часов">
                  Перевести в Красный
                </button>`
              : '',
          ]}
          ${[comments ? html`<button class="btn btn--secondary" data-action="comment">Написать комментарий</button>` : '']}
        `
      : html`
          ${[
            reopenVerdict.allowed
              ? html`<button class="btn btn--primary" data-action="reopen"
                  title="Вернуть сигнал в работу — отсчет времени решения продолжится">
                  Возобновить работу
                </button>`
              : html`<span class="detail__note">
                  Статус «${STATUS_META[signal.status].label}» закрыт. ${reopenVerdict.reason}.
                </span>`,
          ]}
          ${[comments ? html`<button class="btn btn--secondary" data-action="comment">Написать комментарий</button>` : '']}
        `;

    return html`
      <section class="page">
        <div class="page__crumbs">
          ${[back]}
          ${[
            canEdit(signal, actor).allowed
              ? html`<a class="btn btn--secondary btn--sm" href="#/admin/signal/${signal.id}/edit">Редактировать</a>`
              : '',
          ]}
        </div>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
              ${[categoryTag(signal.category)]}
              ${[distributed ? assigneeChip(signal, { compact: false }) : '']}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          <div class="detail__timer">${[resolutionTimer(signal, { now, size: 'lg' })]}</div>

          ${[stageCallout(signal, actor)]}

          <dl class="detail__facts">
            <div><dt>Номер</dt><dd>${signal.number ? `№${signal.number}` : '—'}</dd></div>
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
            isSuperadmin(actor) && distributed && active
              ? html`<div class="detail__section">
                  <h2>Категория</h2>
                  <div class="distribute">
                    <span class="distribute__label">Изменить категорию:</span>
                    <div class="distribute__actions">${categoryButtons(signal)}</div>
                  </div>
                </div>`
              : '',
          ]}

          ${[
            distributed
              ? html`<div class="detail__section">
                  <div class="detail__section-head">
                    <h2>Ответственные (${signal.assignees.length})</h2>
                    ${[
                      distributes
                        ? html`<button class="btn btn--secondary btn--sm" data-action="assign-people">
                            Назначить ответственных
                          </button>`
                        : '',
                    ]}
                  </div>
                  ${[assigneeRoster(signal, { removable: distributes })]}
                </div>`
              : '',
          ]}

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
            Срок ${Math.round(ESCALATION_MS / 3600000)} часов отсчитывается с передачи сигнала в работу; входной
            контроль и доработка у подрядчика в него не входят. Красный ставит фоновый процесс по истечении
            срока — либо сотрудник вручную; в истории эти случаи различимы по автору события.
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
    const current = () => findAny(ctx.params.id);

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
      const signal = current();
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

    // Категории: на входном контроле — передача в работу с выбором ответственных,
    // у сигнала в работе — смена категории.
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const signal = current();
        const category = button.dataset.category;
        const intake = signal?.status === STATUS.INTAKE;

        let picked = { assignees: [], note: null };
        if (intake) {
          picked = await openAssignDialog({
            signal,
            category,
            title: `Распределить в «${categoryLabel(category)}»`,
            confirmLabel: 'Передать в работу',
            requireAssignee: true,
          });
          if (!picked) return;
        }

        const group = button.closest('.distribute__actions');
        group?.querySelectorAll('button').forEach((item) => (item.disabled = true));
        try {
          await distribute(ctx.params.id, category, picked.assignees, picked.note);
          showToast(
            intake
              ? `Сигнал передан в работу: «${categoryLabel(category)}»`
              : `Сигнал направлен в «${categoryLabel(category)}»`,
            'success',
          );
        } catch (error) {
          group?.querySelectorAll('button').forEach((item) => (item.disabled = false));
          showToast(error.message, 'error');
        }
      });
    });

    const bind = (action, handler) =>
      root.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
        button.addEventListener('click', () => handler(current(), button));
      });

    bind('return', returnToContractor);
    bind('reject', rejectSignal);
    bind('resolve', resolveSignal);
    bind('escalate', escalateSignal);
    bind('comment', commentOnSignal);
    bind('reopen', reopen);
  },
};
