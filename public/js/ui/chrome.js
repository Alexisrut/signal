/** Шапка приложения, глобальные баннеры и всплывающие уведомления. */

import { html } from '../core/utils.js';
import { ROLE_LABEL, STATUS } from '/shared/constants.js';
import * as store from '../data/store.js';
import {
  currentActor,
  isAdmin,
  isAuthenticated,
  isContractor,
  isSuperadmin,
  isVerifiedAdmin,
  isPendingVerification,
  logout,
} from '../domain/session.js';
import { listMine, listAll, listUndistributed } from '../domain/signals.js';
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
  }, 4000);
}

function navLink(href, label, currentPath, badge) {
  const active = currentPath === href.replace('#', '') ? 'is-active' : '';
  return html`<a class="nav__link ${active}" href="${href}"
    >${label}${[badge ? html`<span class="nav__badge">${badge}</span>` : '']}</a
  >`;
}

const isActiveStatus = (signal) => signal.status === STATUS.YELLOW || signal.status === STATUS.RED;

/**
 * Состояние мобильного меню. Живет вне рендера, потому что шапка перерисовывается
 * на каждое обновление данных — открытое меню не должно схлопываться само по себе.
 * На десктопе кнопка меню скрыта через CSS, поэтому класс ни на что не влияет.
 */
let menuOpen = false;

function applyMenuState() {
  const host = document.getElementById('topbar');
  if (!host) return;
  host.classList.toggle('is-menu-open', menuOpen);
  host.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', String(menuOpen));
}

function setMenu(open) {
  menuOpen = open;
  applyMenuState();
}

// Глобальные слушатели регистрируются один раз: шапка перерисовывается часто,
// и вешать их внутри рендера означало бы копить обработчики.
window.addEventListener('hashchange', () => setMenu(false));

document.addEventListener('click', (event) => {
  if (!menuOpen) return;
  const host = document.getElementById('topbar');
  // Тап по пункту меню или мимо шапки — закрываем.
  if (!host?.contains(event.target) || event.target.closest('.nav__link')) setMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuOpen) setMenu(false);
});

function bindMenu(host) {
  host.querySelector('[data-action="menu"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenu(!menuOpen);
  });
  applyMenuState();
}

export function renderHeader(currentPath = '/') {
  const host = document.getElementById('topbar');
  const actor = currentActor();
  const state = store.getState();

  const links = [navLink('#/', 'Главная', currentPath)];

  if (isContractor(actor)) {
    const activeMine = listMine().filter(isActiveStatus).length;
    links.push(navLink('#/my', 'Мои сигналы', currentPath, activeMine || ''));
  }

  if (isVerifiedAdmin(actor)) {
    const activeAll = (listAll() ?? []).filter(isActiveStatus).length;
    links.push(navLink('#/admin', 'Дашборд', currentPath, activeAll || ''));

    // Распределение и учетные записи — исключительно зона главного администратора.
    if (isSuperadmin(actor)) {
      links.push(navLink('#/admin/distribution', 'Распределение', currentPath, (listUndistributed() ?? []).length || ''));
      links.push(navLink('#/admin/users', 'Учетные записи', currentPath));
    }
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

      <button class="burger" type="button" data-action="menu" aria-label="Меню" aria-expanded="false" aria-controls="main-nav">
        <span class="burger__line"></span><span class="burger__line"></span><span class="burger__line"></span>
      </button>

      <nav class="nav" id="main-nav">${links}</nav>

      <div class="topbar__side">
        ${[state.offline ? html`<span class="conn conn--offline" title="Нет связи с сервером">офлайн</span>` : '']}
        ${[
          isAuthenticated(actor)
            ? html`<span class="who who--${actor.role}">
                  <span class="who__role">${ROLE_LABEL[actor.role] ?? 'Пользователь'}</span>
                  <span class="who__name">${actor.displayName}</span>
                </span>
                <button class="btn btn--ghost btn--sm" data-action="logout">Выйти</button>`
            : html`<a class="btn btn--ghost btn--sm" href="#/login">Войти</a>
                <a class="btn btn--primary btn--sm" href="#/register">Регистрация</a>`,
        ]}
      </div>
    </div>
    ${[
      isPendingVerification(actor)
        ? html`<div class="banner banner--warn">
            Почта <b>${actor.email}</b> не подтверждена — панель управления заблокирована.
            <a class="link" href="#/admin/verify">Что делать</a>
          </div>`
        : '',
    ]}
  `;

  bindMenu(host);

  host.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
    const wasAdmin = isAdmin();
    await logout();
    showToast(wasAdmin ? 'Вы вышли из аккаунта администратора' : 'Вы вышли из системы');
    navigate('/login');
  });
}
