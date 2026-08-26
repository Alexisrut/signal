/** Шапка приложения, глобальные баннеры и всплывающие уведомления. */

import { html } from '../core/utils.js';
import { ROLE, ROLE_LABEL, STATUS, THEME, formatShortName } from '/shared/constants.js';
import { currentTheme, onThemeChange, toggleTheme } from '../core/theme.js';
import * as store from '../data/store.js';
import { currentActor, hasSignalsTab, isAdmin, isAuthenticated, isStaff, isSuperadmin, logout } from '../domain/session.js';
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

/** Подпись пользователя в шапке: ФИО сокращаем, название компании — нет. */
function headerName(actor) {
  return actor.role === ROLE.CONTRACTOR ? actor.displayName : formatShortName(actor.displayName);
}

/** Переключатель темы доступен всем, включая гостя на форме входа. */
function themeButton() {
  const dark = currentTheme() === THEME.DARK;
  const label = dark ? 'Включить светлую тему' : 'Включить темную тему';
  return html`<button class="theme-toggle" type="button" data-action="theme" title="${label}" aria-label="${label}">
    ${dark ? '☀' : '☾'}
  </button>`;
}

/**
 * Последний отрисованный маршрут. Тему можно переключить и из раздела «Аккаунт» —
 * кнопка в шапке должна поменять подпись, не дожидаясь смены экрана.
 */
let lastPath = '/';
onThemeChange(() => {
  if (document.getElementById('topbar')) renderHeader(lastPath);
});

export function renderHeader(currentPath = '/') {
  lastPath = currentPath;
  const host = document.getElementById('topbar');
  const actor = currentActor();
  const state = store.getState();

  // Порядок пунктов: Главная → Мои сигналы → Дашборд → Распределение →
  // Учетные записи → Аккаунт. «Аккаунт» замыкает меню как личный раздел.
  const links = [navLink('#/', 'Главная', currentPath)];

  if (hasSignalsTab(actor)) {
    const activeMine = listMine().filter(isActiveStatus).length;
    links.push(navLink('#/my', 'Мои сигналы', currentPath, activeMine || ''));
  }

  if (isStaff(actor)) {
    const activeAll = (listAll() ?? []).filter(isActiveStatus).length;
    links.push(navLink('#/admin', 'Дашборд', currentPath, activeAll || ''));

    // Распределение и учетные записи — исключительно зона главного администратора.
    if (isSuperadmin(actor)) {
      links.push(navLink('#/admin/distribution', 'Распределение', currentPath, (listUndistributed() ?? []).length || ''));
      links.push(navLink('#/admin/users', 'Учетные записи', currentPath));
    }
  }

  if (isAuthenticated(actor)) links.push(navLink('#/account', 'Аккаунт', currentPath));

  host.innerHTML = html`
    <div class="topbar__inner">
      <a class="brand" href="#/">
        <span class="brand__mark"></span>
        <span class="brand__text">Мониторинг сигналов</span>
      </a>

      <button class="burger" type="button" data-action="menu" aria-label="Меню" aria-expanded="false" aria-controls="main-nav">
        <span class="burger__line"></span><span class="burger__line"></span><span class="burger__line"></span>
      </button>

      <nav class="nav" id="main-nav">${links}</nav>

      <div class="topbar__side">
        ${[state.offline ? html`<span class="conn conn--offline" title="Нет связи с сервером">офлайн</span>` : '']}
        ${[themeButton()]}
        ${[
          isAuthenticated(actor)
            ? // ФИО сокращается до «Фамилия И.О.», чтобы в строку с меню
              // помещались и имя, и должность; полное — в подсказке.
              // Название компании не сокращаем: «ООО Т.» ничего не значит.
              html`<span class="who who--${actor.role}"
                  title="${actor.displayName} · ${ROLE_LABEL[actor.role] ?? 'Пользователь'}">
                  <span class="who__name">${headerName(actor)}</span>
                  <span class="who__role">${ROLE_LABEL[actor.role] ?? 'Пользователь'}</span>
                </span>
                <button class="btn btn--ghost btn--sm" data-action="logout">Выйти</button>`
            : html`<a class="btn btn--ghost btn--sm" href="#/login">Войти</a>
                <a class="btn btn--primary btn--sm" href="#/register">Регистрация</a>`,
        ]}
      </div>
    </div>
  `;

  bindMenu(host);

  // Перерисовку шапки после переключения запускает подписка onThemeChange выше.
  host.querySelector('[data-action="theme"]')?.addEventListener('click', () => toggleTheme());

  host.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
    const wasStaff = isAdmin() || isStaff();
    await logout();
    showToast(wasStaff ? 'Вы вышли из рабочего аккаунта' : 'Вы вышли из системы');
    navigate('/login');
  });
}
