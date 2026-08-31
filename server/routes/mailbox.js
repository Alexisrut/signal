/**
 * Dev-инбокс: просмотр писем, когда SMTP не настроен.
 * Работает только в режиме dev-inbox и только для главного администратора.
 */

import fs from 'node:fs';

import { sendHtml, sendText, notFound, forbidden } from '../http.js';
import { SMTP_CONFIGURED } from '../config.js';
import { isSuperadmin } from '../identity.js';
import { listMailLog, getMail } from '../mail/transport.js';

const formatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Двух проверок здесь не по одной на всякий случай, а потому что каждая
 * закрывает свою дыру.
 *
 * Режим отсекает раздел на рабочей почте. Но одной этой проверки мало:
 * стоит `.env` не доехать до сервера или потерять SMTP_HOST — и раздел
 * открывается снова, уже на публичном адресе, вместе с телами всех писем
 * и действующими ссылками восстановления пароля. Поэтому рядом стоит
 * проверка роли: читать чужую почту может только главный администратор.
 */
function guard(actor) {
  if (SMTP_CONFIGURED) throw notFound('Dev-инбокс отключен: настроен реальный SMTP');
  if (!isSuperadmin(actor)) throw forbidden('Dev-инбокс доступен только главному администратору');
}

export function mailboxIndex(req, res, { actor }) {
  guard(actor);
  const mails = listMailLog(100);

  const rows = mails
    .map(
      (mail) => `<tr>
        <td data-label="Время">${escapeHtml(formatter.format(new Date(mail.created_at)))}</td>
        <td data-label="Кому">${escapeHtml(mail.to_email)}</td>
        <td data-label="Тема"><a class="link" href="/dev/mailbox/${escapeHtml(mail.id)}">${escapeHtml(mail.subject)}</a></td>
        <td data-label="Тип"><span class="tag">${escapeHtml(mail.kind)}</span></td>
        <td data-label="Статус">${mail.error ? `<span style="color:#ff8f7d">${escapeHtml(mail.error)}</span>` : '<span style="color:#7ee2a4">доставлено в инбокс</span>'}</td>
      </tr>`,
    )
    .join('');

  sendHtml(
    res,
    200,
    `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev-инбокс</title><link rel="stylesheet" href="/css/styles.css"></head>
<body>
  <main class="app">
    <section class="page">
      <header class="page__head">
        <div>
          <h1 class="page__title">Dev-инбокс</h1>
          <p class="page__lead">SMTP не настроен, поэтому письма не уходят наружу, а сохраняются здесь и в data/mailbox/*.eml.</p>
        </div>
        <a class="btn btn--secondary" href="/#/">К приложению</a>
      </header>
      <div class="panel">
        <table class="table">
          <thead><tr><th>Время</th><th>Кому</th><th>Тема</th><th>Тип</th><th>Статус</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">Писем пока нет</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`,
  );
}

export function mailboxItem(req, res, { actor, params, url }) {
  guard(actor);
  const mail = getMail(params.id);
  if (!mail) throw notFound('Письмо не найдено');

  // ?raw=1 — исходное MIME-сообщение целиком, как его увидел бы почтовый сервер.
  if (url.searchParams.get('raw') === '1') {
    if (!mail.file_path || !fs.existsSync(mail.file_path)) throw notFound('Исходник письма недоступен');
    sendText(res, 200, fs.readFileSync(mail.file_path, 'utf8'));
    return;
  }

  sendHtml(
    res,
    200,
    `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(mail.subject)}</title></head>
<body style="margin:0;background:#f2f4f7;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <div style="padding:14px 20px;background:#1b2430;color:#e7edf4;font-size:13px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
    <a href="/dev/mailbox" style="color:#9dc0ff;">← Все письма</a>
    <span>Кому: <b>${escapeHtml(mail.to_email)}</b></span>
    <span>Тема: <b>${escapeHtml(mail.subject)}</b></span>
    <a href="/dev/mailbox/${escapeHtml(mail.id)}?raw=1" style="color:#9dc0ff;margin-left:auto;">Исходник .eml</a>
  </div>
  ${mail.html ?? '<p style="padding:20px">Письмо без HTML-части</p>'}
</body>
</html>`,
  );
}
