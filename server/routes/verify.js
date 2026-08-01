/** Страница подтверждения почты — переход по ссылке из письма. */

import { sendHtml } from '../http.js';
import { createSession } from '../identity.js';
import { verifyEmailToken } from '../domain/admins.js';

function page({ title, tone, message, actions }) {
  const accent = tone === 'ok' ? '#35c46a' : '#f2543d';
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <main class="app">
    <section class="auth" style="border-top:3px solid ${accent};">
      <h1 class="auth__title">${title}</h1>
      <p class="auth__lead">${message}</p>
      <div class="wizard__actions">${actions}</div>
    </section>
  </main>
</body>
</html>`;
}

export function verifyEmail(req, res, { url }) {
  const result = verifyEmailToken(url.searchParams.get('token'));

  if (!result.ok) {
    sendHtml(
      res,
      400,
      page({
        title: 'Ссылка не подошла',
        tone: 'error',
        message: `${result.reason}. Войдите в систему и запросите новое письмо подтверждения.`,
        actions: '<a class="btn btn--primary" href="/#/admin/login">К форме входа</a>',
      }),
    );
    return;
  }

  // Переход по одноразовой ссылке из собственного почтового ящика сразу
  // открывает панель управления — отдельный вход после этого не требуется.
  createSession(res, result.user.id);

  sendHtml(
    res,
    200,
    page({
      title: result.alreadyVerified ? 'Почта уже подтверждена' : 'Почта подтверждена',
      tone: 'ok',
      message: `Учетная запись <b>${result.user.login}</b> (${result.user.email}) активна. Панель управления доступна.`,
      actions: '<a class="btn btn--primary" href="/#/admin">Открыть дашборд</a>',
    }),
  );
}
