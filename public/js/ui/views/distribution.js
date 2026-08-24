/**
 * Раздел «Распределение» — видит только главный администратор.
 *
 * Сюда попадает каждый новый сигнал и остается здесь, пока ему не назначена
 * категория. Выбор категории открывает окно, где задачу сразу выдают одному
 * или нескольким руководителям — в том числе курирующим другие категории —
 * и прикладывают заметку для ответственных.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { CATEGORIES, categoryLabel } from '/shared/constants.js';
import { listUndistributed, authorLabel, distribute } from '../../domain/signals.js';
import {
  statusBadge,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsBadge,
  attachmentsList,
  resolutionTimer,
} from '../components.js';
import { openAssignDialog } from '../assign-dialog.js';
import { showToast } from '../chrome.js';

export const distributionView = {
  live: true,

  render() {
    const signals = listUndistributed() ?? [];
    const now = Date.now();

    if (!signals.length) {
      return html`<section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Распределение</h1>
            <p class="page__lead">Новые сигналы, которым еще не назначена категория.</p>
          </div>
          <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
        </header>
        ${[
          emptyState(
            'Нераспределенных сигналов нет',
            'Как только подрядчик создаст обращение, оно появится здесь.',
            html`<a class="btn btn--primary" href="#/admin">Открыть дашборд</a>`,
          ),
        ]}
      </section>`;
    }

    const cards = signals.map((signal) => {
      const buttons = CATEGORIES.map(
        (category) => html`<button class="btn btn--secondary btn--sm" data-signal="${signal.id}"
          data-category="${category.id}" title="Назначить категорию «${category.label}»">
          ${category.label}
        </button>`,
      );

      return html`<article class="row row--${signal.status}">
        <div class="row__main">
          <div class="row__head">
            ${[statusBadge(signal.status, { withHint: true })]}
            <span class="tag tag--none">Не распределен</span>
            ${[attachmentsBadge(signal.attachments)]}
            <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
          </div>
          <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
          ${[resolutionTimer(signal, { now })]}
          <p class="row__desc">${truncate(signal.description, 240)}</p>
          ${[signal.attachments.length ? attachmentsList(signal.attachments, { compact: true }) : '']}
          <div class="row__foot">
            <span>Автор: ${authorLabel(signal.id)}</span>
            <span>Создан ${formatDateTime(signal.createdAt)}</span>
            ${[escalationHint(signal, now)]}
          </div>
          <div class="distribute">
            <span class="distribute__label">Направить в категорию:</span>
            <div class="distribute__actions">${buttons}</div>
          </div>
        </div>
        <div class="row__actions">
          <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
        </div>
      </article>`;
    });

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Распределение</h1>
            <p class="page__lead">Ожидают категории: ${signals.length}.</p>
          </div>
          <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
        </header>

        <div class="rows">${cards}</div>
      </section>
    `;
  },

  mount(root) {
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const signalId = button.dataset.signal;
        const category = button.dataset.category;
        const signal = (listUndistributed() ?? []).find((item) => item.id === signalId);

        // Категория выбрана — дальше решаем, кому именно выдать задачу.
        const picked = await openAssignDialog({
          signal,
          category,
          title: `Направить в «${categoryLabel(category)}»`,
          confirmLabel: 'Распределить',
          // Категорию можно назначить и не выбирая исполнителей.
          allowEmpty: true,
        });
        if (!picked) return;

        const group = button.closest('.distribute__actions');
        group?.querySelectorAll('button').forEach((item) => (item.disabled = true));

        try {
          const updated = await distribute(signalId, category, picked.assignees, picked.note);
          const label = categoryLabel(updated.category);
          showToast(
            picked.assignees.length
              ? `Сигнал направлен в «${label}», исполнителей: ${updated.assignees.length}`
              : `Сигнал направлен в «${label}»`,
            'success',
          );
        } catch (error) {
          group?.querySelectorAll('button').forEach((item) => (item.disabled = false));
          showToast(error.message, 'error');
        }
      });
    });
  },
};
