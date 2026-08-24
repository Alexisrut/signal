/**
 * Модальные окна.
 *
 * Одно окно за раз, поверх приложения. Нужны в двух местах: подтверждение
 * необратимого действия (удаление учетной записи) и окно выбора руководителей
 * при распределении задачи.
 *
 * Окно живет вне цикла рендера роутера: экран под ним может перерисоваться
 * по live-событию, и терять наполовину заполненную форму из-за этого нельзя.
 */

import { html } from '../core/utils.js';

let host = null;
let closeCurrent = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'modal-host';
  document.body.appendChild(host);
  return host;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeCurrent?.();
});

/**
 * Открыть окно.
 *
 * @param {object} options
 * @param {string} options.title заголовок
 * @param {string} options.bodyHtml готовая разметка тела
 * @param {string} [options.confirmLabel] подпись основной кнопки
 * @param {string} [options.cancelLabel] подпись кнопки отмены
 * @param {'primary'|'danger'} [options.tone] оформление основной кнопки
 * @param {(root: HTMLElement) => void} [options.mount] подключение поведения тела
 * @param {(root: HTMLElement) => any} [options.collect] что вернуть при подтверждении
 * @returns {Promise<any|null>} null — окно закрыли без подтверждения
 */
export function openModal({
  title,
  bodyHtml = '',
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  tone = 'primary',
  mount,
  collect,
}) {
  closeCurrent?.();

  const root = ensureHost();
  root.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal__backdrop" data-role="backdrop"></div>
    <div class="modal__window">
      <header class="modal__head">
        <h2 class="modal__title">${title}</h2>
        <button class="modal__close" type="button" data-role="close" aria-label="Закрыть">×</button>
      </header>
      <div class="modal__body" data-role="body">${[bodyHtml]}</div>
      <footer class="modal__foot">
        <button class="btn btn--ghost" type="button" data-role="cancel">${cancelLabel}</button>
        <button class="btn btn--${tone === 'danger' ? 'danger' : 'primary'}" type="button" data-role="confirm">
          ${confirmLabel}
        </button>
      </footer>
    </div>
  </div>`;

  document.body.classList.add('is-modal-open');
  const body = root.querySelector('[data-role="body"]');
  mount?.(body);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeCurrent = null;
      root.innerHTML = '';
      document.body.classList.remove('is-modal-open');
      resolve(value);
    };

    closeCurrent = () => finish(null);

    root.querySelector('[data-role="backdrop"]').addEventListener('click', () => finish(null));
    root.querySelector('[data-role="close"]').addEventListener('click', () => finish(null));
    root.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(null));
    root.querySelector('[data-role="confirm"]').addEventListener('click', () => {
      const value = collect ? collect(body) : true;
      // collect может отменить подтверждение, вернув null — например, когда
      // в форме окна не хватает данных и она уже подсветила проблему.
      if (value === null || value === undefined) return;
      finish(value);
    });

    root.querySelector('.modal__window').addEventListener('click', (event) => event.stopPropagation());
    root.querySelector('[data-role="confirm"]').focus();
  });
}

/** Подтверждение необратимого действия. */
export function confirmDialog({ title, message, confirmLabel = 'Удалить', tone = 'danger' }) {
  return openModal({
    title,
    bodyHtml: html`<p class="modal__message">${message}</p>`,
    confirmLabel,
    tone,
  }).then(Boolean);
}
