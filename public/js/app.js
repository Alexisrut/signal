/**
 * Точка сборки клиента: загрузка состояния с сервера, подписка на live-поток,
 * маршрутизация и guard-ы доступа.
 */

import * as store from './data/store.js';
import { UI_TICK_MS } from '/shared/constants.js';
import { isVerifiedAdmin, isAdmin, isPendingVerification, tasksEnabled } from './domain/session.js';

import { createRouter } from './ui/router.js';
import { renderHeader } from './ui/chrome.js';
import { html } from './core/utils.js';
import { emptyState } from './ui/components.js';

import { homeView } from './ui/views/home.js';
import { chooseLineView, signalFormView } from './ui/views/new-signal.js';
import { mySignalsView, mySignalView } from './ui/views/my-signals.js';
import { adminLoginView } from './ui/views/admin-login.js';
import { adminDashboardView } from './ui/views/admin-dashboard.js';
import { adminSignalView } from './ui/views/admin-signal.js';
import { adminUsersView } from './ui/views/admin-users.js';
import { adminProfileView } from './ui/views/admin-profile.js';
import { verifyPendingView } from './ui/views/verify-pending.js';
import { tasksDashboardView, taskFormView, taskDetailView } from './ui/views/tasks.js';

/** Панель доступна только подтвержденному администратору. */
function requireAdmin() {
  if (isVerifiedAdmin()) return null;
  if (isPendingVerification()) return '/admin/verify';
  return '/admin/login';
}

/** Модуль задач вдобавок управляется флагом в настройках профиля. */
function requireTasks() {
  const redirect = requireAdmin();
  if (redirect) return redirect;
  return tasksEnabled() ? null : '/admin/profile';
}

const routes = [
  { path: '/', view: homeView },
  { path: '/new', view: chooseLineView },
  { path: '/new/form', view: signalFormView },
  { path: '/my', view: mySignalsView },
  { path: '/my/:id', view: mySignalView },

  {
    path: '/admin/login',
    view: adminLoginView,
    guard: () => (isVerifiedAdmin() ? '/admin' : isPendingVerification() ? '/admin/verify' : null),
  },
  {
    path: '/admin/verify',
    view: verifyPendingView,
    guard: () => (isAdmin() ? (isVerifiedAdmin() ? '/admin' : null) : '/admin/login'),
  },
  { path: '/admin', view: adminDashboardView, guard: requireAdmin },
  { path: '/admin/signal/:id', view: adminSignalView, guard: requireAdmin },
  { path: '/admin/users', view: adminUsersView, guard: requireAdmin },
  { path: '/admin/profile', view: adminProfileView, guard: requireAdmin },

  // Порядок важен: конкретный '/tasks/new' должен проверяться раньше '/tasks/:id'.
  { path: '/tasks', view: tasksDashboardView, guard: requireTasks },
  { path: '/tasks/new', view: taskFormView, guard: requireTasks },
  { path: '/tasks/:id', view: taskDetailView, guard: requireTasks },
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
  // Смена прав (вход, выход, подтверждение почты, переключение модуля задач)
  // требует переоценки guard-ов, поэтому маршрут разрешается заново.
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
}

function accessKey() {
  const actor = store.getState().actor;
  return [actor?.id, actor?.role, actor?.isEmailVerified, actor?.settings?.tasksDashboardEnabled].join('|');
}

bootstrap().catch((error) => {
  console.error('[app] критическая ошибка запуска', error);
  document.getElementById('app').innerHTML =
    '<section class="page"><h1 class="page__title">Не удалось запустить приложение</h1>' +
    '<p class="page__lead">Проверьте, запущен ли сервер, и загляните в консоль браузера.</p></section>';
});
