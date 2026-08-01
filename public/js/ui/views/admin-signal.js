/** Детальная карточка сигнала для администратора: просмотр, история, управление статусом. */

import { html, formatDateTime } from '../../core/utils.js';
import { STATUS, STATUS_META, ESCALATION_MS, lineLabel } from '/shared/constants.js';
import { canTransition, isActive } from '/shared/state-machine.js';
import { currentActor } from '../../domain/session.js';
import { findAny, authorLabel, changeStatus, ageSignal } from '../../domain/signals.js';
import {
  statusBadge,
  lineTag,
  historyList,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsList,
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
            <div><dt>Автор</dt><dd>${authorLabel(signal.id)}</dd></div>
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
            Желтый и Красный статусы выставляются только автоматически: Желтый — при создании,
            Красный — фоновым процессом через ${Math.round(ESCALATION_MS / 3600000)} часов.
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
            <h2>История статусов</h2>
            ${[historyList(signal)]}
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
