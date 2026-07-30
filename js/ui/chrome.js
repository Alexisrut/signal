/** Шапка приложения и всплывающие уведомления. */

import { html } from '../core/utils.js';
import { ROLE, STATUS } from '../core/constants.js';
import { currentActor, logout } from '../domain/auth.js';
import { listAll, listByAuthor } from '../domain/signals.js';
import { navigate } from './router.js';

let toastHost = null;

export function showToast(message, type = 'info') {
  if (!toastHost) toastHost = document.getElementById('toast');
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.textContent = message;
  toastHost.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

function navLink(href, label, currentPath, badge) {
  const active = currentPath === href.replace('#', '') ? 'is-active' : '';
  return html`<a class="nav__link ${active}" href="${href}"
    >${label}${[badge ? html`<span class="nav__badge">${badge}</span>` : '']}</a
  >`;
}

export function renderHeader(currentPath = '/') {
  const host = document.getElementById('topbar');
  const actor = currentActor();
  const isAdmin = actor.role === ROLE.ADMIN;

  const mine = listByAuthor(actor.id);
  const activeMine = mine.filter((s) => s.status === STATUS.YELLOW || s.status === STATUS.RED).length;
  const activeAll = isAdmin
    ? listAll().filter((s) => s.status === STATUS.YELLOW || s.status === STATUS.RED).length
    : 0;

  const links = [
    navLink('#/', 'Главная', currentPath),
    navLink('#/my', 'Мои сигналы', currentPath, activeMine || ''),
  ];
  if (isAdmin) {
    links.push(navLink('#/admin', 'Дашборд', currentPath, activeAll || ''));
    links.push(navLink('#/admin/users', 'Администраторы', currentPath));
  }

  host.innerHTML = html`
    <div class="topbar__inner">
      <a class="brand" href="#/">
        <span class="brand__mark"></span>
        <span class="brand__text">
          <strong>Мониторинг сигналов</strong>
          <small>Система контроля проблем подрядчиков</small>
        </span>
      </a>

      <nav class="nav">${links}</nav>

      <div class="topbar__side">
        <span class="who who--${actor.role}">
          <span class="who__role">${isAdmin ? 'Администратор' : 'Подрядчик'}</span>
          <span class="who__name">${actor.displayName}</span>
        </span>
        ${[
          isAdmin
            ? html`<button class="btn btn--ghost btn--sm" data-action="logout">Выйти</button>`
            : html`<a class="btn btn--ghost btn--sm" href="#/admin/login">Вход для администратора</a>`,
        ]}
      </div>
    </div>
  `;

  host.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
    logout();
    showToast('Вы вышли из аккаунта администратора');
    navigate('/');
  });
}
