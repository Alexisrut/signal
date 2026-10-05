/**
 * Раздел «Входной контроль» — видит только главный администратор.
 *
 * Сюда попадает каждый новый сигнал. Прежде чем уйти в работу, он проходит
 * проверку: достаточно ли в нем данных, чтобы ответственный мог действовать.
 *
 *   • данных достаточно — выбирается категория, и в открывшемся окне задачу
 *     выдают одному или нескольким ответственным (с заметкой для них);
 *   • данных мало — сигнал возвращается подрядчику с комментарием, что
 *     дополнить. Доработанный сигнал снова приходит сюда же.
 *
 * Сигналы на доработке у подрядчика показаны отдельной группой: действовать
 * по ним пока не нужно, но видеть, что они ждут ответа, полезно.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { CATEGORIES, SIGNAL_ACTION, STATUS, categoryLabel } from '/shared/constants.js';
import { can, isTerminal } from '/shared/state-machine.js';
import { currentActor } from '../../domain/session.js';
import { listUndistributed, authorLabel, distribute, lastAction } from '../../domain/signals.js';
import {
  statusBadge,
  numberTag,
  emptyState,
  ageLabel,
  attachmentsBadge,
  attachmentsList,
  resolutionTimer,
} from '../components.js';
import { openAssignDialog } from '../assign-dialog.js';
import { rejectSignal, returnToContractor } from '../signal-actions.js';
import { showToast } from '../chrome.js';

const findSignal = (id) => (listUndistributed() ?? []).find((item) => item.id === id);

/** Сигнал на проверке: категории для распределения и возврат на доработку. */
function intakeRow(signal, actor, now) {
  const buttons = CATEGORIES.map(
    (category) => html`<button class="btn btn--secondary btn--sm" data-signal="${signal.id}"
      data-category="${category.id}" title="Распределить в категорию «${category.label}»">
      ${category.label}
    </button>`,
  );

  // Доработанный сигнал приходит с ответом подрядчика — его видно сразу.
  const resubmitted = lastAction(signal, SIGNAL_ACTION.RESUBMIT);

  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">
        ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
        ${[attachmentsBadge(signal.attachments)]}
        <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
      </div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      ${[resolutionTimer(signal, { now })]}
      <p class="row__desc">${truncate(signal.description, 240)}</p>
      ${[signal.attachments.length ? attachmentsList(signal.attachments, { compact: true }) : '']}
      ${[
        resubmitted
          ? html`<div class="callout callout--intake">
              <span class="callout__title">Доработан подрядчиком ${formatDateTime(resubmitted.at)}</span>
              <div class="callout__quote">${resubmitted.note}</div>
            </div>`
          : '',
      ]}
      <div class="row__foot">
        <span>Автор: ${authorLabel(signal.id)}</span>
        <span>Создан ${formatDateTime(signal.createdAt)}</span>
      </div>
      <div class="distribute">
        <span class="distribute__label">Данных достаточно — распределить в категорию:</span>
        <div class="distribute__actions">${buttons}</div>
      </div>
      <div class="intake-actions">
        ${[
          can(SIGNAL_ACTION.INTAKE_RETURN, signal, actor).allowed
            ? html`<button class="btn btn--secondary btn--sm" data-action="return" data-signal="${signal.id}">
                Вернуть подрядчику на доработку
              </button>`
            : '',
        ]}
        ${[
          can(SIGNAL_ACTION.REJECT, signal, actor).allowed
            ? html`<button class="btn btn--muted btn--sm" data-action="reject" data-signal="${signal.id}">
                Отклонить
              </button>`
            : '',
        ]}
      </div>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

/** Сигнал на доработке: что попросили дополнить и когда. */
function reworkRow(signal, now) {
  const returned = lastAction(signal, SIGNAL_ACTION.INTAKE_RETURN);

  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">
        ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
        ${[attachmentsBadge(signal.attachments)]}
        <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
      </div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      <p class="row__desc">${truncate(signal.description, 180)}</p>
      ${[
        returned
          ? html`<div class="callout callout--rework">
              <span class="callout__title">Возвращен ${formatDateTime(returned.at)} · ${returned.byName}</span>
              <div class="callout__quote">${returned.note}</div>
            </div>`
          : '',
      ]}
      <div class="row__foot">
        <span>Автор: ${authorLabel(signal.id)}</span>
        <span>Создан ${formatDateTime(signal.createdAt)}</span>
      </div>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

/** Закрытые без распределения — коротко, для справки. */
function closedRow(signal) {
  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">${[numberTag(signal)]} ${[statusBadge(signal.status)]}</div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      <p class="row__desc">${truncate(signal.description, 140)}</p>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

function group(title, rows) {
  if (!rows.length) return '';
  return html`<section class="intake-group">
    <h2 class="intake-group__title">${title} (${rows.length})</h2>
    <div class="rows">${rows}</div>
  </section>`;
}

export const distributionView = {
  live: true,

  render() {
    const actor = currentActor();
    const signals = listUndistributed() ?? [];
    const now = Date.now();

    const awaiting = signals.filter((signal) => signal.status === STATUS.INTAKE);
    const rework = signals.filter((signal) => signal.status === STATUS.REWORK);
    const closed = signals.filter((signal) => isTerminal(signal.status));

    const head = html`<header class="page__head">
      <div>
        <h1 class="page__title">Входной контроль</h1>
        <p class="page__lead">
          Новый сигнал уходит в работу только после проверки: хватает данных — распределите его
          ответственному, не хватает — верните подрядчику с комментарием, что дополнить.
        </p>
      </div>
      <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
    </header>`;

    if (!awaiting.length && !rework.length) {
      return html`<section class="page">
        ${[head]}
        ${[
          emptyState(
            'Новых сигналов нет',
            'Как только подрядчик создаст или доработает обращение, оно появится здесь.',
            html`<a class="btn btn--primary" href="#/admin">Открыть дашборд</a>`,
          ),
        ]}
        ${[group('Закрыты без распределения', closed.map(closedRow))]}
      </section>`;
    }

    return html`
      <section class="page">
        ${[head]}
        ${[group('Ожидают проверки', awaiting.map((signal) => intakeRow(signal, actor, now)))]}
        ${[group('На доработке у подрядчика', rework.map((signal) => reworkRow(signal, now)))]}
        ${[group('Закрыты без распределения', closed.map(closedRow))]}
      </section>
    `;
  },

  mount(root) {
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const signalId = button.dataset.signal;
        const category = button.dataset.category;

        // Категория выбрана — дальше решаем, кому именно выдать задачу.
        const picked = await openAssignDialog({
          signal: findSignal(signalId),
          category,
          title: `Распределить в «${categoryLabel(category)}»`,
          confirmLabel: 'Передать в работу',
          requireAssignee: true,
        });
        if (!picked) return;

        const group = button.closest('.distribute__actions');
        group?.querySelectorAll('button').forEach((item) => (item.disabled = true));

        try {
          const updated = await distribute(signalId, category, picked.assignees, picked.note);
          showToast(
            `Сигнал передан в работу: «${categoryLabel(updated.category)}», ответственных — ${updated.assignees.length}`,
            'success',
          );
        } catch (error) {
          group?.querySelectorAll('button').forEach((item) => (item.disabled = false));
          showToast(error.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-action="return"]').forEach((button) => {
      button.addEventListener('click', () => returnToContractor(findSignal(button.dataset.signal), button));
    });

    root.querySelectorAll('[data-action="reject"]').forEach((button) => {
      button.addEventListener('click', () => rejectSignal(findSignal(button.dataset.signal), button));
    });
  },
};
