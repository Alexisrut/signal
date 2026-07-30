/** Переиспользуемые фрагменты разметки. */

import { html, escapeHtml, formatDateTime, formatDuration, truncate } from '../core/utils.js';
import { STATUS_META, STATUS_ORDER, ROLE, lineLabel } from '../core/constants.js';
import { escalationDueAt, isActive } from '../domain/state-machine.js';

export function statusBadge(status, { withHint = false } = {}) {
  const meta = STATUS_META[status];
  if (!meta) return '';
  const titleAttr = withHint ? `title="${escapeHtml(meta.hint)}"` : '';
  return html`<span class="badge badge--${status}" ${[titleAttr]}>
    <span class="badge__dot"></span>${meta.label}
  </span>`;
}

export function statusLegend() {
  const items = STATUS_ORDER.map(
    (status) => html`<li class="legend__item" title="${STATUS_META[status].hint}">
      <span class="legend__dot legend__dot--${status}"></span>
      <span class="legend__label">${STATUS_META[status].label}</span>
    </li>`,
  );
  return html`<ul class="legend">${items}</ul>`;
}

export function lineTag(line) {
  const cls = line ? `tag--${line}` : 'tag--none';
  return html`<span class="tag ${cls}">${lineLabel(line)}</span>`;
}

function actorLabel(entry) {
  if (entry.byRole === ROLE.SYSTEM) return 'Система';
  if (entry.byRole === ROLE.ADMIN) return `${entry.byName} · администратор`;
  return `${entry.byName} · подрядчик`;
}

/** Таймер до автоэскалации либо отметка о её просрочке. */
export function escalationHint(signal, now = Date.now()) {
  const due = escalationDueAt(signal);
  if (due === null) return '';
  const left = due - now;
  if (left <= 0) {
    return html`<span class="escalation escalation--due">Порог 48 ч пройден — ожидает эскалации</span>`;
  }
  return html`<span class="escalation">До эскалации: ${formatDuration(left)}</span>`;
}

export function signalCard(signal, { href, now = Date.now() } = {}) {
  return html`<a class="card card--${signal.status}" href="${href}">
    <div class="card__head">
      ${[statusBadge(signal.status)]}
      ${[lineTag(signal.line)]}
    </div>
    <h3 class="card__title">${signal.contractorName}</h3>
    <p class="card__sector">Сектор: ${signal.sector}</p>
    <p class="card__desc">${truncate(signal.description, 120)}</p>
    <div class="card__foot">
      <span>Создан ${formatDateTime(signal.createdAt)}</span>
      ${[escalationHint(signal, now)]}
    </div>
  </a>`;
}

export function historyList(signal) {
  const items = [...signal.history]
    .sort((a, b) => a.at - b.at)
    .map(
      (entry) => html`<li class="history__item history__item--${entry.to}">
        <div class="history__marker"></div>
        <div class="history__body">
          <div class="history__row">
            ${[statusBadge(entry.to)]}
            <span class="history__time">${formatDateTime(entry.at)}</span>
          </div>
          <div class="history__meta">
            ${entry.from ? `${STATUS_META[entry.from].short} → ${STATUS_META[entry.to].short} · ` : ''}${actorLabel(entry)}
          </div>
          ${[entry.note ? html`<div class="history__note">${entry.note}</div>` : '']}
        </div>
      </li>`,
    );
  return html`<ol class="history">${items}</ol>`;
}

export function emptyState(title, text, actionHtml = '') {
  return html`<div class="empty">
    <div class="empty__icon">◎</div>
    <h3>${title}</h3>
    <p>${text}</p>
    ${[actionHtml]}
  </div>`;
}

export function statCounters(counters) {
  const cells = STATUS_ORDER.map(
    (status) => html`<div class="stat stat--${status}">
      <span class="stat__value">${counters[status]}</span>
      <span class="stat__label">${STATUS_META[status].label}</span>
    </div>`,
  );
  return html`<div class="stats">
    <div class="stat stat--total">
      <span class="stat__value">${counters.total}</span>
      <span class="stat__label">Всего сигналов</span>
    </div>
    ${cells}
  </div>`;
}

export function ageLabel(signal, now = Date.now()) {
  const base = isActive(signal.status) ? now : signal.updatedAt;
  return formatDuration(base - signal.createdAt);
}
