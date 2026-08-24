/**
 * Дашборд администратора — «карта сигналов»: сигналы, сгруппированные по категориям,
 * с фильтрами по категории и статусу и экспортом в Excel.
 *
 * Колонки строятся только из тех категорий, которые открыты текущему
 * сотруднику: главный администратор видит все, остальные — закрепленный набор.
 * Состояние фильтров живет в query-строке: оно переживает live-перерисовку
 * и теми же параметрами уходит в серверный отчет.
 */

import { html } from '../../core/utils.js';
import { ASSIGNMENT, CATEGORIES, STATUS_META, STATUS_ORDER, categoryLabel } from '/shared/constants.js';
import { isActive, isAssignedTo } from '/shared/state-machine.js';
import { currentActor, isAdmin, isSuperadmin, myCategories } from '../../domain/session.js';
import {
  listAll,
  listUndistributed,
  filterSignals,
  countByStatus,
  resolutionStats,
  unreadCount,
} from '../../domain/signals.js';
import { downloadReport } from '../../domain/reports.js';
import { signalCard, statCounters, statusLegend, emptyState, formatAverage } from '../components.js';
import { showToast } from '../chrome.js';

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

/**
 * Свернутая строка со средним временем решения по всей платформе; развернутая
 * показывает разбивку по категориям. Состояние живет в query-строке — иначе
 * live-перерисовка схлопывала бы строку обратно на каждое событие с сервера.
 */
function resolutionPanel(stats, { open, href }) {
  if (!stats) return '';

  const rows = stats.byCategory.map(
    (row) => html`<li class="resolution__row">
      <span class="resolution__name">
        <span class="status-card__dot status-card__dot--${row.id}"></span>${categoryLabel(row.id)}
      </span>
      <span class="resolution__count">${row.resolved} решено</span>
      <span class="resolution__time">${formatAverage(row.avgMs)}</span>
    </li>`,
  );

  return html`<section class="resolution ${open ? 'is-open' : ''}">
    <a class="resolution__head" href="${href}" aria-expanded="${open ? 'true' : 'false'}">
      <span class="resolution__chevron" aria-hidden="true">▸</span>
      <span class="resolution__label">Среднее время решения по платформе</span>
      <strong class="resolution__value">${formatAverage(stats.overall.avgMs)}</strong>
      <span class="resolution__count">решено задач: ${stats.overall.resolved}</span>
    </a>
    ${[
      open
        ? html`<div class="resolution__body">
            <div class="resolution__legend">
              <span>Категория</span><span>Решено задач</span><span>Среднее время решения</span>
            </div>
            <ul class="resolution__list">${rows}</ul>
          </div>`
        : '',
    ]}
  </section>`;
}

export const adminDashboardView = {
  live: true,

  render(ctx) {
    const actor = currentActor();
    const allowed = CATEGORIES.filter((category) => myCategories(actor).includes(category.id));

    const category = ctx.query.category ?? 'all';
    const status = ctx.query.status ?? 'all';
    const statsOpen = ctx.query.stats === 'open';
    const now = Date.now();

    const all = listAll() ?? [];
    const visible = filterSignals(all, { category, status });
    const counters = countByStatus(all);
    const waiting = (listUndistributed() ?? []).length;

    /**
     * Индикатор новых изменений видят администраторы — по всем своим карточкам,
     * и руководители — только по тем задачам, за которые они отвечают.
     */
    const showsUnread = (signal) => isAdmin(actor) || isAssignedTo(signal, actor.id);

    const columns = (category === 'all' ? allowed : allowed.filter((item) => item.id === category)).map((column) => {
      const items = visible.filter((signal) => signal.category === column.id);
      const active = items.filter((signal) => isActive(signal.status)).length;
      const cards = items.map((signal) =>
        signalCard(signal, {
          href: `#/admin/signal/${signal.id}`,
          now,
          unread: showsUnread(signal) ? unreadCount(signal.id) : 0,
        }),
      );

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

    const href = (nextCategory, nextStatus, nextStats = statsOpen) =>
      `#/admin?category=${nextCategory}&status=${nextStatus}${nextStats ? '&stats=open' : ''}`;

    const categoryFilters = [{ id: 'all', label: 'Все категории' }, ...allowed];

    const board = !allowed.length
      ? emptyState(
          'Вам не открыта ни одна категория',
          'Доступ к категориям сигналов выдает главный администратор в разделе «Учетные записи».',
        )
      : all.length
        ? html`<div class="board board--${category === 'all' ? 'wide' : 'single'}">${columns}</div>`
        : emptyState(
            'В доступных вам категориях пока нет сигналов',
            'Сигнал появится здесь, как только главный администратор распределит его в вашу категорию.',
          );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Карта сигналов</h1>
            <p class="page__lead">Сигналы доступных вам категорий в реальном времени.</p>
          </div>
          <div class="page__head-actions">
            <button class="btn btn--secondary" data-action="export">Экспорт в Excel</button>
            ${[
              isSuperadmin(actor)
                ? html`<a class="btn btn--primary" href="#/admin/distribution"
                    >Распределение${waiting ? ` · ${waiting}` : ''}</a
                  >`
                : '',
            ]}
          </div>
        </header>

        ${[
          isSuperadmin(actor) && waiting
            ? html`<div class="banner banner--info">
                Ожидают распределения: <b>${waiting}</b>.
                <a class="link" href="#/admin/distribution">Открыть раздел</a>
              </div>`
            : '',
        ]}

        ${[statCounters(counters)]}

        ${[resolutionPanel(resolutionStats(), { open: statsOpen, href: href(category, status, !statsOpen) })]}

        <div class="filters">
          <div class="filters__group">
            <span class="filters__label">Категория</span>
            <div class="chips">
              ${categoryFilters.map((filter) => chipLink(filter, category, (id) => href(id, status)))}
            </div>
          </div>
          <div class="filters__group">
            <span class="filters__label">Статус</span>
            <div class="chips">${STATUS_FILTERS.map((filter) => chipLink(filter, status, (id) => href(category, id)))}</div>
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
          category: ctx.query.category ?? 'all',
          status: ctx.query.status ?? 'all',
          assignment: ASSIGNMENT.ALL,
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
