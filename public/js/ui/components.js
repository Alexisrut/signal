/** Переиспользуемые фрагменты разметки и мелкие интерактивные компоненты. */

import { html, escapeHtml, formatDateTime, formatDuration, truncate } from '../core/utils.js';
import {
  STATUS_META,
  STATUS_ORDER,
  TASK_STATUS_META,
  ROLE,
  lineLabel,
  iconForFile,
  formatBytes,
} from '/shared/constants.js';
import { escalationDueAt, isActive } from '/shared/state-machine.js';
import { validateFiles, acceptAttribute, limitsHint } from '../domain/files.js';

export function statusBadge(status, { withHint = false } = {}) {
  const meta = STATUS_META[status];
  if (!meta) return '';
  const titleAttr = withHint ? `title="${escapeHtml(meta.hint)}"` : '';
  return html`<span class="badge badge--${status}" ${[titleAttr]}>
    <span class="badge__dot"></span>${meta.label}
  </span>`;
}

export function taskBadge(status) {
  const meta = TASK_STATUS_META[status];
  if (!meta) return '';
  return html`<span class="badge badge--task-${status}" title="${meta.hint}">
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

/* --------------------------------- вложения ---------------------------------- */

export function attachmentsList(files, { compact = false } = {}) {
  if (!files?.length) return '';

  const items = files.map(
    (file) => html`<li class="attachment">
      <span class="attachment__icon">${iconForFile(file)}</span>
      <span class="attachment__body">
        <span class="attachment__name">${file.filename}</span>
        <span class="attachment__meta">${formatBytes(file.size)} · ${file.mime}</span>
      </span>
      <a class="attachment__download" href="${file.url}" download title="Скачать файл">Скачать</a>
    </li>`,
  );

  return html`<ul class="attachments ${compact ? 'attachments--compact' : ''}">${items}</ul>`;
}

export function attachmentsBadge(files) {
  if (!files?.length) return '';
  return html`<span class="clip">📎 ${files.length}</span>`;
}

/** Разметка зоны Drag-and-Drop; поведение подключает bindFileField. */
export function fileField({ label = 'Вложения' } = {}) {
  return html`<div class="field field--files">
    <span class="field__label">${label}</span>
    <div class="dropzone" data-role="dropzone">
      <input type="file" multiple accept="${acceptAttribute}" hidden data-role="file-input" />
      <div class="dropzone__hint">
        <strong>Перетащите файлы сюда</strong>
        <span>или <button class="link" type="button" data-role="pick">выберите на диске</button></span>
        <small>${limitsHint}</small>
      </div>
      <ul class="dropzone__list" data-role="file-list"></ul>
    </div>
    <span class="field__error" data-role="file-error"></span>
  </div>`;
}

/**
 * Подключает поведение зоны загрузки: выбор, drag-and-drop, удаление, валидацию.
 * @returns {{getFiles: () => File[], clear: () => void}}
 */
export function bindFileField(root) {
  const zone = root.querySelector('[data-role="dropzone"]');
  if (!zone) return { getFiles: () => [], clear: () => {} };

  const input = zone.querySelector('[data-role="file-input"]');
  const list = zone.querySelector('[data-role="file-list"]');
  const error = root.querySelector('[data-role="file-error"]');
  const selected = [];

  function renderList() {
    list.innerHTML = selected
      .map(
        (file, index) => html`<li class="dropzone__file">
          <span class="dropzone__file-name">${file.name}</span>
          <span class="dropzone__file-size">${formatBytes(file.size)}</span>
          <button class="dropzone__remove" type="button" data-index="${index}" title="Убрать файл">×</button>
        </li>`,
      )
      .join('');

    list.querySelectorAll('[data-index]').forEach((button) => {
      button.addEventListener('click', () => {
        selected.splice(Number(button.dataset.index), 1);
        renderList();
      });
    });
  }

  function add(fileList) {
    const { accepted, rejected } = validateFiles(fileList);
    for (const file of accepted) {
      const duplicate = selected.some((item) => item.name === file.name && item.size === file.size);
      if (!duplicate) selected.push(file);
    }

    error.textContent = rejected.length
      ? `Не приняты: ${rejected.map((item) => `${item.name} (${item.reason})`).join(', ')}`
      : '';

    renderList();
  }

  zone.querySelector('[data-role="pick"]').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    add(input.files);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('is-dragover');
    }),
  );

  ['dragleave', 'drop'].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && zone.contains(event.relatedTarget)) return;
      zone.classList.remove('is-dragover');
    }),
  );

  zone.addEventListener('drop', (event) => add(event.dataTransfer?.files));

  return {
    getFiles: () => [...selected],
    clear: () => {
      selected.length = 0;
      error.textContent = '';
      renderList();
    },
  };
}

/* ---------------------------------- карточки --------------------------------- */

export function signalCard(signal, { href, now = Date.now() } = {}) {
  return html`<a class="card card--${signal.status}" href="${href}">
    <div class="card__head">
      ${[statusBadge(signal.status)]} ${[lineTag(signal.line)]} ${[attachmentsBadge(signal.attachments)]}
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

export function taskCard(task, { href } = {}) {
  return html`<a class="card card--task-${task.status}" href="${href}">
    <div class="card__head">${[taskBadge(task.status)]} ${[attachmentsBadge(task.attachments)]}</div>
    <h3 class="card__title">${task.title}</h3>
    <p class="card__desc">${truncate(task.description, 140)}</p>
    <div class="card__foot">
      <span>Автор: ${task.authorName}</span>
      <span>Создана ${formatDateTime(task.createdAt)}</span>
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

/* ------------------------------- переключатели -------------------------------- */

export function toggle({ name, label, hint = '', checked, disabled = false }) {
  return html`<label class="switch ${disabled ? 'is-disabled' : ''}">
    <input type="checkbox" name="${name}" ${[checked ? 'checked' : '']} ${[disabled ? 'disabled' : '']} />
    <span class="switch__track"><span class="switch__thumb"></span></span>
    <span class="switch__body">
      <span class="switch__label">${label}</span>
      ${[hint ? html`<span class="switch__hint">${hint}</span>` : '']}
    </span>
  </label>`;
}

export function checkbox({ name, label, checked, disabled = false, value }) {
  return html`<label class="checkbox ${disabled ? 'is-disabled' : ''}">
    <input type="checkbox" name="${name}" ${[value !== undefined ? `value="${escapeHtml(value)}"` : '']}
      ${[checked ? 'checked' : '']} ${[disabled ? 'disabled' : '']} />
    <span class="checkbox__box"></span>
    <span class="checkbox__label">${label}</span>
  </label>`;
}
