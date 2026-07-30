/** Детальная карточка сигнала для администратора: просмотр, история, управление статусом. */

import { html, formatDateTime } from '../../core/utils.js';
import { STATUS, STATUS_META, ESCALATION_MS, lineLabel } from '../../core/constants.js';
import * as store from '../../data/store.js';
import { currentActor } from '../../domain/auth.js';
import { getForActor, changeStatus, ageSignal } from '../../domain/signals.js';
import { canTransition, isActive } from '../../domain/state-machine.js';
import { statusBadge, lineTag, historyList, emptyState, escalationHint, ageLabel } from '../components.js';
import { showToast } from '../chrome.js';

function authorLabel(signal) {
  const user = store.getState().users[signal.authorId];
  if (!user) return `Аноним · ${signal.authorId}`;
  const role = user.role === 'admin' ? 'администратор' : 'подрядчик';
  return `${user.displayName} · ${role}`;
}

export const adminSignalView = {
  live: true,

  render(ctx) {
    const actor = currentActor();
    const signal = getForActor(ctx.params.id, actor);

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
    const active = isActive(signal.status);

    const actions = active
      ? html`
          <button class="btn btn--success" data-status="${STATUS.GREEN}" ${[canResolve ? '' : 'disabled']}>
            Проблема решена
          </button>
          <button class="btn btn--muted" data-status="${STATUS.GRAY}" ${[canReject ? '' : 'disabled']}>
            Отклонить сигнал
          </button>
        `
      : html`<span class="detail__note">
          Статус «${STATUS_META[signal.status].short}» терминальный — дальнейшие изменения запрещены.
        </span>`;

    return html`
      <section class="page">
        <a class="link link--back" href="#/admin">← Карта сигналов</a>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[statusBadge(signal.status, { withHint: true })]} ${[lineTag(signal.line)]}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          <dl class="detail__facts">
            <div><dt>Автор</dt><dd>${authorLabel(signal)}</dd></div>
            <div><dt>Линия</dt><dd>${lineLabel(signal.line)}</dd></div>
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
            <div><dt>ID</dt><dd class="mono">${signal.id}</dd></div>
          </dl>

          <div class="detail__section">
            <h2>Описание</h2>
            <p class="detail__text">${signal.description}</p>
          </div>

          ${[
            signal.status === STATUS.YELLOW
              ? html`<div class="detail__escalation">${[escalationHint(signal, now)]}</div>`
              : '',
          ]}

          <div class="detail__actions">${[actions]}</div>
          <p class="detail__hint">
            Желтый и Красный статусы выставляются только автоматически: Желтый — при создании,
            Красный — фоновым процессом через ${Math.round(ESCALATION_MS / 3600000)} часов.
          </p>

          ${[
            signal.status === STATUS.YELLOW
              ? html`<div class="devtool">
                  <span class="devtool__label">Демо-режим</span>
                  <button class="btn btn--ghost btn--sm" data-age="${signal.id}">
                    Состарить сигнал на 48 часов
                  </button>
                  <small>Меняет только метки времени. Красный статус все равно выставит фоновый воркер.</small>
                </div>`
              : '',
          ]}

          <div class="detail__section">
            <h2>История статусов</h2>
            ${[historyList(signal)]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root, ctx) {
    const actor = currentActor();

    root.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = changeStatus(ctx.params.id, button.dataset.status, actor);
        if (!result.ok) {
          showToast(result.error, 'error');
          return;
        }
        showToast(`Статус изменен: ${STATUS_META[button.dataset.status].label}`, 'success');
      });
    });

    root.querySelector('[data-age]')?.addEventListener('click', (event) => {
      ageSignal(event.currentTarget.dataset.age, ESCALATION_MS);
      showToast('Метки времени сдвинуты — дождитесь тика фонового воркера', 'info');
    });
  },
};
