/**
 * Дашборд администратора — «карта сигналов»: все сигналы системы,
 * сгруппированные по линиям, с фильтрами по линии и статусу и экспортом в Excel.
 * Состояние фильтров живет в query-строке: оно переживает live-перерисовку
 * и теми же параметрами уходит в серверный отчет.
 */

import { html } from '../../core/utils.js';
import { LINE, LINE_COLUMNS, STATUS_META, STATUS_ORDER } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';
import { listAll, filterSignals, countByStatus } from '../../domain/signals.js';
import { downloadReport } from '../../domain/reports.js';
import { signalCard, statCounters, statusLegend, emptyState } from '../components.js';
import { showToast } from '../chrome.js';

const LINE_FILTERS = [
  { id: 'all', label: 'Все линии' },
  ...LINE_COLUMNS.map((column) => ({ id: column.id === LINE.NONE ? 'none' : column.id, label: column.label })),
];

const STATUS_FILTERS = [
  { id: 'all', label: 'Все статусы' },
  { id: 'active', label: 'Только активные' },
  ...STATUS_ORDER.map((status) => ({ id: status, label: STATUS_META[status].label })),
];

function chipLink(filter, current, buildHref) {
  const active = filter.id === current ? 'is-active' : '';
  const tone = STATUS_META[filter.id] ? `chip--${filter.id}` : '';
  return html`<a class="chip ${active} ${tone}" href="${buildHref(filter.id)}">${filter.label}</a>`;
}

export const adminDashboardView = {
  live: true,

  render(ctx) {
    const line = ctx.query.line ?? 'all';
    const status = ctx.query.status ?? 'all';
    const now = Date.now();

    const all = listAll() ?? [];
    const visible = filterSignals(all, { line, status });
    const counters = countByStatus(all);

    const columns = (line === 'all'
      ? LINE_COLUMNS
      : LINE_COLUMNS.filter((column) => (column.id === LINE.NONE ? 'none' : column.id) === line)
    ).map((column) => {
      const items = visible.filter((signal) => signal.line === column.id);
      const active = items.filter((signal) => isActive(signal.status)).length;
      const cards = items.map((signal) => signalCard(signal, { href: `#/admin/signal/${signal.id}`, now }));

      return html`<section class="column">
        <header class="column__head">
          <h3>${column.label}</h3>
          <span class="column__count">${items.length}${active ? ` · активных ${active}` : ''}</span>
        </header>
        <div class="column__body">
          ${[cards.length ? cards.join('') : html`<p class="column__empty">Нет сигналов</p>`]}
        </div>
      </section>`;
    });

    const href = (nextLine, nextStatus) => `#/admin?line=${nextLine}&status=${nextStatus}`;

    const board = all.length
      ? html`<div class="board board--${line === 'all' ? 'wide' : 'single'}">${columns}</div>`
      : emptyState(
          'В системе пока нет сигналов',
          'Как только подрядчик создаст обращение, оно появится здесь автоматически.',
          html`<a class="btn btn--primary" href="#/new">Создать сигнал</a>`,
        );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Карта сигналов</h1>
            <p class="page__lead">Все обращения системы в реальном времени.</p>
          </div>
          <div class="page__head-actions">
            <button class="btn btn--secondary" data-action="export">Экспорт в Excel</button>
            <a class="btn btn--primary" href="#/new">Создать сигнал</a>
          </div>
        </header>

        ${[statCounters(counters)]}

        <div class="filters">
          <div class="filters__group">
            <span class="filters__label">Линия</span>
            <div class="chips">${LINE_FILTERS.map((filter) => chipLink(filter, line, (id) => href(id, status)))}</div>
          </div>
          <div class="filters__group">
            <span class="filters__label">Статус</span>
            <div class="chips">${STATUS_FILTERS.map((filter) => chipLink(filter, status, (id) => href(line, id)))}</div>
          </div>
        </div>

        ${[statusLegend()]}
        ${[
          all.length && !visible.length
            ? html`<p class="board__empty">Под выбранные фильтры не подходит ни один сигнал.</p>`
            : board,
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
        // В отчет уходят ровно те же фильтры, что видны на экране.
        const { filename, rows } = await downloadReport('signals', {
          line: ctx.query.line ?? 'all',
          status: ctx.query.status ?? 'all',
        });
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
