/**
 * Точка сборки приложения: инициализация data-слоя, посев администратора,
 * запуск фонового воркера эскалации, маршрутизация и подписки live-режима.
 */

import * as store from './data/store.js';
import { UI_TICK_MS } from './core/constants.js';
import { initAuthSync, seedDefaultAdmin, subscribeSession, isAdmin } from './domain/auth.js';
import { startEscalationWorker } from './domain/escalation-worker.js';

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

const requireAdmin = () => (isAdmin() ? null : '/admin/login');

const routes = [
  { path: '/', view: homeView },
  { path: '/new', view: chooseLineView },
  { path: '/new/form', view: signalFormView },
  { path: '/my', view: mySignalsView },
  { path: '/my/:id', view: mySignalView },
  { path: '/admin/login', view: adminLoginView, guard: () => (isAdmin() ? '/admin' : null) },
  { path: '/admin', view: adminDashboardView, guard: requireAdmin },
  { path: '/admin/signal/:id', view: adminSignalView, guard: requireAdmin },
  { path: '/admin/users', view: adminUsersView, guard: requireAdmin },
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
  store.init();
  initAuthSync();
  await seedDefaultAdmin();

  const router = createRouter({
    root: document.getElementById('app'),
    routes,
    notFound: notFoundView,
    onRender: (current) => renderHeader(current.ctx.path),
  });

  // LIVE-режим: любое изменение данных (в этой или в другой вкладке, включая
  // автоэскалацию воркером) перерисовывает шапку и активный экран.
  store.subscribe(() => {
    renderHeader(router.current?.ctx.path ?? '/');
    router.refreshIfLive();
  });

  // Смена сессии (вход/выход администратора) переоценивает guard-ы маршрута.
  subscribeSession(() => router.resolve());

  // Тик интерфейса: обновляет счетчики возраста и таймеры «до эскалации».
  setInterval(() => router.refreshIfLive(), UI_TICK_MS);

  startEscalationWorker();
  router.start();
}

bootstrap().catch((error) => {
  console.error('[app] критическая ошибка запуска', error);
  document.getElementById('app').innerHTML =
    '<section class="page"><h1 class="page__title">Не удалось запустить приложение</h1>' +
    '<p class="page__lead">Подробности — в консоли браузера.</p></section>';
});
