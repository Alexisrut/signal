/**
 * Раздел «Мои сигналы» — личный список, разный по смыслу для двух ролей.
 *
 * У подрядчика это его собственные обращения: сервер отдает в mySignals только
 * сигналы, где он автор. У руководителя и администратора — задачи, за которые
 * он лично отвечает как исполнитель.
 *
 * Подрядчику внутренняя кухня не показывается: ни «не распределен», ни
 * «не принят», ни лента действий — только статус его проблемы и её движение.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { STATUS, STATUS_META, STATUS_ORDER, categoryLabel } from '/shared/constants.js';
import { canEdit, canTransition } from '/shared/state-machine.js';
import { currentActor, isContractor } from '../../domain/session.js';
import { listMine, findMine, changeStatus, countByStatus, unreadCount } from '../../domain/signals.js';
import {
  statusBadge,
  categoryTag,
  historyList,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsList,
  attachmentsBadge,
  assigneeChip,
  resolutionTimer,
  unreadBadge,
} from '../components.js';
import { showToast } from '../chrome.js';

/**
 * Сводка подрядчика: сколько обращений он подал за все время и сколько
 * из них решено. Считается только по его собственным сигналам — других
 * в mySignals у подрядчика не бывает по построению.
 */
function contractorStats(signals) {
  const resolved = signals.filter((signal) => signal.status === STATUS.GREEN).length;
  const active = signals.filter((signal) => !STATUS_META[signal.status].terminal).length;

  return html`<div class="stats stats--contractor">
    <div class="stat stat--total">
      <span class="stat__value">${signals.length}</span>
      <span class="stat__label">Всего сигналов за все время</span>
    </div>
    <div class="stat stat--green">
      <span class="stat__value">${resolved}</span>
      <span class="stat__label">Решенных сигналов</span>
    </div>
    <div class="stat stat--yellow">
      <span class="stat__value">${active}</span>
      <span class="stat__label">Сейчас в работе</span>
    </div>
  </div>`;
}

function bindResolveButtons(root) {
  root.querySelectorAll('[data-resolve]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await changeStatus(button.dataset.resolve, STATUS.GREEN);
        showToast('Сигнал переведен в статус «Проблема решена»', 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
    });
  });
}

/* --------------------------------- Список ------------------------------------ */

export const mySignalsView = {
  live: true,

  render() {
    const actor = currentActor();
    const mine = isContractor(actor);
    const signals = listMine();
    const counters = countByStatus(signals);
    const now = Date.now();

    const empty = mine
      ? emptyState(
          'Пока ни одного сигнала',
          'Здесь появится история ваших обращений и их текущие статусы.',
          html`<a class="btn btn--primary" href="#/new">Задать проблему</a>`,
        )
      : emptyState(
          'На вас пока не назначено ни одной задачи',
          'Сигнал появится здесь, как только администратор назначит вас ответственным.',
          html`<a class="btn btn--secondary" href="#/admin">К карте сигналов</a>`,
        );

    if (!signals.length) {
      return html`
        <section class="page">
          <header class="page__head"><h1 class="page__title">Мои сигналы</h1></header>
          ${[mine ? contractorStats(signals) : '']}
          ${[empty]}
        </section>
      `;
    }

    const rows = signals.map((signal) => {
      const canResolve = canTransition(signal, STATUS.GREEN, actor).allowed;
      // Подрядчик ведет карточку в своем разделе, ответственный — в рабочей.
      const href = mine ? `#/my/${signal.id}` : `#/admin/signal/${signal.id}`;

      return html`<article class="row row--${signal.status}">
        <div class="row__main">
          <div class="row__head">
            ${[statusBadge(signal.status, { withHint: true })]}
            ${[categoryTag(signal.category, { hideUndistributed: mine })]}
            ${[assigneeChip(signal, { hideFree: mine })]} ${[attachmentsBadge(signal.attachments)]}
            <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
            ${[mine ? '' : unreadBadge(unreadCount(signal.id))]}
          </div>
          <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
          ${[resolutionTimer(signal, { now })]}
          <p class="row__desc">${truncate(signal.description, 180)}</p>
          <div class="row__foot">
            <span>Создан ${formatDateTime(signal.createdAt)}</span>
            <span>Обновлен ${formatDateTime(signal.updatedAt)}</span>
            ${[escalationHint(signal, now)]}
          </div>
        </div>
        <div class="row__actions">
          <a class="btn btn--ghost btn--sm" href="${href}">Подробнее</a>
          ${[
            mine && canEdit(signal, actor).allowed
              ? html`<a class="btn btn--ghost btn--sm" href="#/my/${signal.id}/edit">Изменить</a>`
              : '',
          ]}
          ${[
            canResolve
              ? html`<button class="btn btn--success btn--sm" data-resolve="${signal.id}">Проблема решена</button>`
              : '',
          ]}
        </div>
      </article>`;
    });

    const chips = STATUS_ORDER.filter((status) => counters[status] > 0).map(
      (status) =>
        html`<span class="chip chip--static chip--${status}">${STATUS_META[status].label}: ${counters[status]}</span>`,
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Мои сигналы</h1>
            <p class="page__lead">
              ${mine ? 'Вы видите только собственные сигналы.' : 'Задачи, за которые вы отвечаете.'}
            </p>
          </div>
          ${[mine ? html`<a class="btn btn--primary" href="#/new">Задать проблему</a>` : '']}
        </header>
        ${[mine ? contractorStats(signals) : '']}
        <div class="chips">${chips}</div>
        <div class="rows">${rows}</div>
      </section>
    `;
  },

  mount(root) {
    bindResolveButtons(root);
  },
};

/* --------------------------------- Карточка ---------------------------------- */

export const mySignalView = {
  live: true,

  render(ctx) {
    const actor = currentActor();
    const signal = findMine(ctx.params.id);
    const mine = isContractor(actor);

    if (!signal) {
      return html`
        <section class="page">
          ${[
            emptyState(
              'Сигнал не найден',
              'Возможно, он принадлежит другому подрядчику или был удален.',
              html`<a class="btn btn--secondary" href="#/my">Вернуться к моим сигналам</a>`,
            ),
          ]}
        </section>
      `;
    }

    const canResolve = canTransition(signal, STATUS.GREEN, actor).allowed;
    const now = Date.now();
    const assignees = signal.assignees.map((person) => person.name).join(', ');

    return html`
      <section class="page">
        <div class="page__crumbs">
          <a class="link link--back" href="#/my">← Мои сигналы</a>
          ${[
            canEdit(signal, actor).allowed
              ? html`<a class="btn btn--secondary btn--sm" href="#/my/${signal.id}/edit">Редактировать</a>`
              : '',
          ]}
        </div>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[statusBadge(signal.status, { withHint: true })]}
              ${[categoryTag(signal.category, { hideUndistributed: mine })]}
              ${[assigneeChip(signal, { compact: false, hideFree: mine })]}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          <dl class="detail__facts">
            ${[
              // Пустые «не принят» и «не распределен» подрядчику не показываем.
              assignees ? html`<div><dt>Исполнители</dt><dd>${assignees}</dd></div>` : '',
            ]}
            ${[
              signal.category
                ? html`<div><dt>Категория</dt><dd>${categoryLabel(signal.category)}</dd></div>`
                : '',
            ]}
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
          </dl>

          <div class="detail__timer">${[resolutionTimer(signal, { now, size: 'lg' })]}</div>

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

          <div class="detail__actions">
            ${[
              canResolve
                ? html`<button class="btn btn--success" data-resolve="${signal.id}">Проблема решена</button>`
                : html`<span class="detail__note"
                    >${STATUS_META[signal.status].terminal
                      ? 'Сигнал закрыт — действия недоступны.'
                      : 'Изменение статуса недоступно.'}</span
                  >`,
            ]}
          </div>

          <div class="detail__section">
            <h2>История статусов</h2>
            ${[historyList(signal.history, { statusOnly: mine })]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root) {
    bindResolveButtons(root);
  },
};
