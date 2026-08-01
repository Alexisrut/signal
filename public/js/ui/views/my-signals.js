/**
 * Личный кабинет подрядчика (и «мои сигналы» администратора).
 * Изолированная среда: сервер отдает в mySignals только сигналы текущего автора.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { STATUS, STATUS_META, STATUS_ORDER, lineLabel } from '/shared/constants.js';
import { canTransition } from '/shared/state-machine.js';
import { currentActor } from '../../domain/session.js';
import { listMine, findMine, changeStatus, countByStatus } from '../../domain/signals.js';
import {
  statusBadge,
  lineTag,
  historyList,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsList,
  attachmentsBadge,
} from '../components.js';
import { showToast } from '../chrome.js';

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
    const signals = listMine();
    const counters = countByStatus(signals);
    const now = Date.now();

    if (!signals.length) {
      return html`
        <section class="page">
          <header class="page__head"><h1 class="page__title">Мои сигналы</h1></header>
          ${[
            emptyState(
              'Пока ни одного сигнала',
              'Здесь появится история ваших обращений и их текущие статусы.',
              html`<a class="btn btn--primary" href="#/new">Задать проблему</a>`,
            ),
          ]}
        </section>
      `;
    }

    const rows = signals.map((signal) => {
      const canResolve = canTransition(signal, STATUS.GREEN, actor).allowed;
      return html`<article class="row row--${signal.status}">
        <div class="row__main">
          <div class="row__head">
            ${[statusBadge(signal.status, { withHint: true })]} ${[lineTag(signal.line)]}
            ${[attachmentsBadge(signal.attachments)]}
            <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
          </div>
          <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
          <p class="row__desc">${truncate(signal.description, 180)}</p>
          <div class="row__foot">
            <span>Создан ${formatDateTime(signal.createdAt)}</span>
            <span>Обновлен ${formatDateTime(signal.updatedAt)}</span>
            ${[escalationHint(signal, now)]}
          </div>
        </div>
        <div class="row__actions">
          <a class="btn btn--ghost btn--sm" href="#/my/${signal.id}">Подробнее</a>
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
            <p class="page__lead">Всего обращений: ${counters.total}. Вы видите только собственные сигналы.</p>
          </div>
          <a class="btn btn--primary" href="#/new">Задать проблему</a>
        </header>
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

    return html`
      <section class="page">
        <a class="link link--back" href="#/my">← Мои сигналы</a>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[statusBadge(signal.status, { withHint: true })]} ${[lineTag(signal.line)]}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          <dl class="detail__facts">
            <div><dt>Линия</dt><dd>${lineLabel(signal.line)}</dd></div>
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
          </dl>

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
            ${[historyList(signal)]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root) {
    bindResolveButtons(root);
  },
};
