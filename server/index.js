/**
 * HTTP-сервер: маршрутизация, статика, единая обработка ошибок.
 *
 *   node server/index.js                → http://localhost:5175
 *   PORT=8080 node server/index.js      → другой порт
 *   SMTP_HOST=... SMTP_USER=... ...     → реальная отправка писем вместо dev-инбокса
 */

import http from 'node:http';

import { HOST, PORT, PUBLIC_DIR, SHARED_DIR, APP_URL, IS_HTTPS, TRUST_PROXY } from './config.js';
import { seedDefaultAdmin, cleanupExpired } from './db.js';
import { resolveActor } from './identity.js';
import { sseHandler } from './events.js';
import { HttpError, sendJson, sendText, serveStatic, setSecurityHeaders, clientIp, unauthorized } from './http.js';
import { startEscalationWorker } from './domain/escalation.js';
import { deliveryMode, verifyTransport } from './mail/transport.js';

import * as api from './routes/api.js';
import * as files from './routes/files.js';
import * as exportRoutes from './routes/export.js';
import { verifyEmail } from './routes/verify.js';
import { mailboxIndex, mailboxItem } from './routes/mailbox.js';

import { DEFAULT_ADMIN, ESCALATION_MS } from '../shared/constants.js';

/** Таблица маршрутов: метод, шаблон пути с `:param`, обработчик. */
const routes = [
  ['GET', '/api/state', api.getState],
  ['GET', '/api/whoami', api.whoami],
  ['GET', '/api/events', (req, res, { actor }) => {
    if (!actor) throw unauthorized();
    sseHandler(req, res);
  }],

  ['POST', '/api/signals', api.createSignal],
  ['GET', '/api/signals/:id', api.getSignal],
  ['PUT', '/api/signals/:id', api.updateSignal],
  ['POST', '/api/signals/:id/status', api.changeSignalStatus],
  ['POST', '/api/signals/:id/reopen', api.reopenSignal],
  ['POST', '/api/signals/:id/assign', api.assignSignal],
  ['POST', '/api/signals/:id/assignees', api.assignPeople],
  ['POST', '/api/signals/:id/seen', api.seenSignal],
  ['POST', '/api/signals/:id/category', api.distributeSignal],

  ['POST', '/api/auth/login', api.login],
  ['POST', '/api/auth/logout', api.logout],
  ['POST', '/api/auth/register', api.register],
  ['POST', '/api/auth/forgot', api.forgotPassword],
  ['GET', '/api/auth/reset', api.checkResetToken],
  ['POST', '/api/auth/reset', api.resetPassword],
  ['POST', '/api/auth/password', api.changePassword],

  ['POST', '/api/admins', api.createAdmin],
  ['PUT', '/api/users/:id/categories', api.updateUserCategories],
  ['PUT', '/api/users/:id/role', api.updateUserRole],
  ['DELETE', '/api/users/:id', api.deleteUser],
  ['PUT', '/api/notifications', api.updateNotify],
  ['POST', '/api/verification/resend', api.resendVerification],

  ['POST', '/api/files', files.uploadFiles],
  ['GET', '/files/:id', files.downloadFile],

  ['GET', '/api/export/signals', exportRoutes.exportSignals],

  ['GET', '/verify', verifyEmail],
  // Ссылка из письма ведет на обычный маршрут приложения: форму нового пароля
  // рисует SPA, серверу остается только перебросить токен в хеш.
  ['GET', '/reset', resetRedirect],
  ['GET', '/dev/mailbox', mailboxIndex],
  ['GET', '/dev/mailbox/:id', mailboxItem],
];

function resetRedirect(req, res, { url }) {
  const token = url.searchParams.get('token') ?? '';
  res.writeHead(302, { Location: `/#/reset?token=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store' });
  res.end();
}

function matchRoute(method, pathname) {
  const segments = pathname.split('/').filter(Boolean);

  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;

    const patternSegments = pattern.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const expected = patternSegments[i];
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(segments[i]);
      else if (expected !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) return { handler, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // Заголовки ставятся до маршрутизации, чтобы попасть в любой ответ,
  // включая ошибки и отдачу статики.
  setSecurityHeaders(res);
  req.ip = clientIp(req);

  try {
    // Идентичность определяется до маршрутизации: сессия нужна и API, и странице
    // подтверждения почты, и статике.
    const actor = resolveActor(req, res);
    const route = matchRoute(req.method, pathname);

    if (route) {
      await route.handler(req, res, { actor, params: route.params, url });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      // Общие с браузером модули предметной области.
      if (pathname.startsWith('/shared/') && serveStatic(res, SHARED_DIR, pathname.slice('/shared/'.length))) return;
      if (serveStatic(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1))) return;

      // SPA-фолбэк отдает оболочку приложения на неизвестный путь, но НЕ на путь
      // с расширением: иначе пропавший .js возвращается как HTML со статусом 200,
      // браузер молча отвергает модуль по MIME-типу, и вместо ошибки видно
      // пустую страницу. Ассеты должны честно отвечать 404.
      const looksLikeAsset = /\.[a-z0-9]+$/i.test(pathname);
      if (!looksLikeAsset && !pathname.startsWith('/api/') && serveStatic(res, PUBLIC_DIR, 'index.html')) return;
    }

    throw new HttpError(404, 'Не найдено');
  } catch (error) {
    handleError(error, req, res, pathname);
  }
});

function handleError(error, req, res, pathname) {
  const status = error instanceof HttpError ? error.status : 500;

  if (status >= 500) console.error(`[http] ${req.method} ${pathname}:`, error);

  if (res.headersSent) {
    res.end();
    return;
  }

  const wantsJson = pathname.startsWith('/api/') || (req.headers.accept ?? '').includes('application/json');

  // Текст сбоя наружу не уходит: в нем бывают пути на диске и куски SQL.
  // Клиенту достаточно кода, подробности остаются в журнале сервера.
  const message = status >= 500 ? 'Внутренняя ошибка сервера' : error.message || 'Ошибка запроса';
  const payload = { error: message };
  if (error.errors) payload.errors = error.errors;
  if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));

  if (wantsJson) sendJson(res, status, payload);
  else sendText(res, status, message);
}

cleanupExpired();
// Протухшие сессии и токены чистятся не только на старте: сервер живет неделями.
const cleanupTimer = setInterval(cleanupExpired, 60 * 60 * 1000);
cleanupTimer.unref?.();

const seeded = seedDefaultAdmin();
startEscalationWorker();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  Система мониторинга сигналов → ${APP_URL}`);
  console.log(`  Слушает: ${HOST}:${PORT}${HOST === '127.0.0.1' ? ' (только петля — наружу через обратный прокси)' : ''}`);
  if (!IS_HTTPS) console.log('  ВНИМАНИЕ: APP_URL без https — куки уходят без флага Secure');
  if (HOST !== '127.0.0.1' && !TRUST_PROXY) {
    console.log('  ВНИМАНИЕ: порт открыт наружу напрямую — проверьте, что его закрывает firewall');
  }
  if (HOST === '127.0.0.1' && !TRUST_PROXY) {
    console.log('  ВНИМАНИЕ: TRUST_PROXY выключен — за прокси все клиенты считаются одним адресом');
  }
  console.log(`  Почта: ${deliveryMode === 'smtp' ? 'реальная отправка через SMTP' : 'dev-инбокс → /dev/mailbox'}`);
  console.log(`  Автоэскалация: порог ${Math.round(ESCALATION_MS / 3600000)} ч, фоновый процесс запущен`);
  if (seeded) {
    console.log(`  Создан главный администратор: ${seeded.login}`);
    if (seeded.isDefaultPassword) {
      console.log(`  ВНИМАНИЕ: пароль по умолчанию «${DEFAULT_ADMIN.password}» опубликован в README и известен всем.`);
      console.log('           Смените его в разделе «Аккаунт» или задайте DEFAULT_ADMIN_PASSWORD до первого запуска.');
    }
  }
  // Проверка SMTP идет после старта: сервер поднимается независимо от почты.
  verifyTransport().finally(() => console.log(''));
});
