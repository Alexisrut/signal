/**
 * Точка сборки клиента: загрузка состояния с сервера, подписка на live-поток,
 * маршрутизация и guard-ы доступа.
 */

import * as store from './data/store.js';
import { UI_TICK_MS } from '/shared/constants.js';
import {
  isAuthenticated,
  isContractor,
  isSuperadmin,
  isVerifiedAdmin,
  isAdmin,
  isPendingVerification,
  currentActor,
} from './domain/session.js';

import { createRouter } from './ui/router.js';
import { renderHeader } from './ui/chrome.js';
import { html } from './core/utils.js';
import { emptyState } from './ui/components.js';

import { homeView } from './ui/views/home.js';
import { newSignalView } from './ui/views/new-signal.js';
import { mySignalsView, mySignalView } from './ui/views/my-signals.js';
import { loginView, landingFor } from './ui/views/login.js';
import { registerView } from './ui/views/register.js';
import { adminDashboardView } from './ui/views/admin-dashboard.js';
import { distributionView } from './ui/views/distribution.js';
import { adminSignalView } from './ui/views/admin-signal.js';
import { adminUsersView } from './ui/views/admin-users.js';
import { verifyPendingView } from './ui/views/verify-pending.js';
import { editSignalView } from './ui/views/edit-signal.js';

/** Любой раздел, кроме входа и регистрации, требует учетной записи. */
function requireAuth() {
  return isAuthenticated() ? null : '/login';
}

/** Сигналы создает и ведет подрядчик. */
function requireContractor() {
  const redirect = requireAuth();
  if (redirect) return redirect;
  return isContractor() ? null : '/admin';
}

/** Панель доступна только администратору с подтвержденной почтой. */
function requireAdmin() {
  if (isVerifiedAdmin()) return null;
  if (isPendingVerification()) return '/admin/verify';
  return isAuthenticated() ? '/' : '/login';
}

/** Распределение и учетные записи — зона главного администратора. */
function requireSuperadmin() {
  const redirect = requireAdmin();
  if (redirect) return redirect;
  return isSuperadmin() ? null : '/admin';
}

const routes = [
  { path: '/', view: homeView },

  {
    path: '/login',
    view: loginView,
    guard: () => (isAuthenticated() ? landingFor(currentActor()) : null),
  },
  {
    path: '/register',
    view: registerView,
    guard: () => (isAuthenticated() ? landingFor(currentActor()) : null),
  },

  { path: '/new', view: newSignalView, guard: requireContractor },
  { path: '/my', view: mySignalsView, guard: requireContractor },
  { path: '/my/:id', view: mySignalView, guard: requireContractor },
  { path: '/my/:id/edit', view: editSignalView, guard: requireContractor },

  {
    path: '/admin/verify',
    view: verifyPendingView,
    guard: () => (isAdmin() ? (isVerifiedAdmin() ? '/admin' : null) : '/login'),
  },
  { path: '/admin', view: adminDashboardView, guard: requireAdmin },
  { path: '/admin/distribution', view: distributionView, guard: requireSuperadmin },
  { path: '/admin/signal/:id', view: adminSignalView, guard: requireAdmin },
  { path: '/admin/signal/:id/edit', view: editSignalView, guard: requireAdmin },
  { path: '/admin/users', view: adminUsersView, guard: requireSuperadmin },
];

const notFoundView = {
  live: false,
  render() {
    return html`<section class="page">
      ${[
        emptyState(
          'Страница не найдена',
          'Проверьте адрес или вернитесь на главную.',
          html`<a class="btn btn--primary" href="#/">На главную</a>`,
        ),
      ]}
    </section>`;
  },
};

async function bootstrap() {
  const root = document.getElementById('app');
  root.innerHTML = '<div class="loader">Загрузка данных…</div>';

  await store.init();

  const router = createRouter({
    root,
    routes,
    notFound: notFoundView,
    onRender: (current) => renderHeader(current.ctx.path),
  });

  // LIVE-режим: сервер сообщил об изменении → состояние перечитано → экран перерисован.
  // Смена прав (вход, выход, подтверждение почты, выданные категории) требует
  // переоценки guard-ов, поэтому маршрут разрешается заново.
  let previousAccess = accessKey();
  store.subscribe(() => {
    const key = accessKey();
    if (key !== previousAccess) {
      previousAccess = key;
      router.resolve();
      return;
    }
    renderHeader(router.current?.ctx.path ?? '/');
    router.refreshIfLive();
  });

  // Тик интерфейса: обновляет возраст сигналов и таймеры «до эскалации».
  setInterval(() => router.refreshIfLive(), UI_TICK_MS);

  router.start();

  // Сигнал сторожу загрузки в index.html: приложение поднялось, диагностика не нужна.
  window.__signalMonitorBooted = true;
}

function accessKey() {
  const actor = store.getState().actor;
  return [actor?.id, actor?.role, actor?.isEmailVerified, (actor?.categories ?? []).join(',')].join('|');
}

bootstrap().catch((error) => {
  // Модуль выполнился, значит искать ненайденные файлы бессмысленно —
  // показываем собственное сообщение и глушим сторож.
  window.__signalMonitorBooted = true;
  console.error('[app] критическая ошибка запуска', error);
  document.getElementById('app').innerHTML =
    '<section class="page"><h1 class="page__title">Не удалось запустить приложение</h1>' +
    '<p class="page__lead">Проверьте, запущен ли сервер, и загляните в консоль браузера.</p></section>';
});
