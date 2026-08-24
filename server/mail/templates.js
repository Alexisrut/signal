/**
 * HTML-шаблоны писем.
 *
 * Вёрстка намеренно табличная и с инлайновыми стилями — почтовые клиенты
 * не поддерживают внешний CSS, flex и grid.
 */

import {
  STATUS_META,
  NOTIFICATION_EVENT,
  categoryLabel,
  formatBytes,
} from '../../shared/constants.js';

const STATUS_COLOR = {
  yellow: '#e0a800',
  red: '#d93a26',
  green: '#1e9e52',
  gray: '#6b7785',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(ts) {
  return dateFormatter.format(new Date(ts)).replace(', ', ' · ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text, limit = 400) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function layout({ title, accent, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f2f4f7;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1c2430;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e6ec;">
    <tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr>
      <td style="padding:28px 32px 8px;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b99ab;font-weight:700;">Мониторинг сигналов</div>
        <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
      </td>
    </tr>
    <tr><td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
    ${
      ctaUrl
        ? `<tr><td style="padding:16px 32px 28px;">
             <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;border-radius:10px;background:${accent};color:#ffffff;font-weight:700;text-decoration:none;font-size:15px;">${escapeHtml(ctaLabel)}</a>
             <div style="margin-top:14px;font-size:12px;color:#8b99ab;word-break:break-all;">Если кнопка не работает, скопируйте ссылку: ${escapeHtml(ctaUrl)}</div>
           </td></tr>`
        : ''
    }
    <tr><td style="padding:16px 32px 26px;border-top:1px solid #eef1f5;font-size:12px;color:#8b99ab;">${footerNote}</td></tr>
  </table>
</body>
</html>`;
}

function factsTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border-collapse:collapse;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="padding:7px 12px 7px 0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#8b99ab;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:7px 0;font-size:14px;vertical-align:top;">${value}</td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

/* ------------------------------- верификация --------------------------------- */

export function verificationEmail({ user, url, ttlHours }) {
  const title = 'Подтвердите адрес электронной почты';
  const html = layout({
    title,
    accent: '#3b74e8',
    bodyHtml: `
      <p style="margin:0 0 14px;">Здравствуйте, ${escapeHtml(user.displayName)}!</p>
      <p style="margin:0 0 14px;">Для учетной записи <b>${escapeHtml(user.login)}</b> в системе мониторинга сигналов указан этот адрес.</p>
      <p style="margin:0;">Подтверждение нужно для восстановления пароля и писем — работе в системе оно не мешает. Ссылка действует ${ttlHours} ч.</p>`,
    ctaLabel: 'Подтвердить почту',
    ctaUrl: url,
    footerNote: 'Если вы не создавали учетную запись, просто проигнорируйте это письмо.',
  });

  const text = `Здравствуйте, ${user.displayName}!\n\nПодтвердите адрес почты для учетной записи «${user.login}»:\n${url}\n\nСсылка действует ${ttlHours} ч.`;

  return { subject: `Подтверждение почты · ${user.login}`, html, text };
}

/* --------------------------- восстановление пароля ---------------------------- */

export function passwordResetEmail({ user, url, ttlMinutes }) {
  const title = 'Восстановление пароля';
  const html = layout({
    title,
    accent: '#3b74e8',
    bodyHtml: `
      <p style="margin:0 0 14px;">Здравствуйте, ${escapeHtml(user.displayName)}!</p>
      <p style="margin:0 0 14px;">Кто-то запросил новый пароль для учетной записи <b>${escapeHtml(user.login)}</b>.</p>
      <p style="margin:0;">Ссылка одноразовая и действует ${ttlMinutes} мин. После смены пароля все открытые сессии завершатся.</p>`,
    ctaLabel: 'Задать новый пароль',
    ctaUrl: url,
    footerNote: 'Если вы не запрашивали восстановление, просто проигнорируйте письмо — пароль останется прежним.',
  });

  const text = `Здравствуйте, ${user.displayName}!\n\nНовый пароль для учетной записи «${user.login}»:\n${url}\n\nСсылка действует ${ttlMinutes} мин.`;

  return { subject: `Восстановление пароля · ${user.login}`, html, text };
}

/* ------------------------------- уведомления --------------------------------- */

const EVENT_TITLE = {
  [NOTIFICATION_EVENT.CREATE]: 'Новый сигнал в системе',
  [NOTIFICATION_EVENT.RED]: 'Сигнал стал критичным',
  [NOTIFICATION_EVENT.RESOLVE]: 'Сигнал закрыт',
  [NOTIFICATION_EVENT.REOPEN]: 'Сигнал возобновлен',
};

const EVENT_LEAD = {
  [NOTIFICATION_EVENT.CREATE]: 'Подрядчик сообщил о новой проблеме.',
  [NOTIFICATION_EVENT.RED]: 'Проблема не решена дольше 48 часов — система эскалировала сигнал.',
  [NOTIFICATION_EVENT.RESOLVE]: 'Сигнал переведен в закрытый статус.',
  [NOTIFICATION_EVENT.REOPEN]: 'Сигнал возвращен в активную фазу, отсчет времени решения продолжен.',
};

const FOOTER_NOTE = {
  staff: 'Письмо отправлено сотрудникам, подписанным на это событие. Подписки настраиваются в разделе «Аккаунт».',
  contractor:
    'Письмо отправлено автору обращения. Отключить уведомления можно в разделе «Аккаунт».',
};

export function signalNotificationEmail({ event, signal, actor, url, audience = 'staff' }) {
  const meta = STATUS_META[signal.status];
  const accent = STATUS_COLOR[signal.status] ?? '#3b74e8';
  const changedAt = signal.history.at(-1)?.at ?? signal.updatedAt;

  const attachmentsRow = signal.attachments.length
    ? [
        [
          'Вложения',
          signal.attachments
            .map((file) => `${escapeHtml(file.filename)} <span style="color:#8b99ab;">(${formatBytes(file.size)})</span>`)
            .join('<br>'),
        ],
      ]
    : [];

  const html = layout({
    title: EVENT_TITLE[event],
    accent,
    bodyHtml: `
      <p style="margin:0 0 14px;">${escapeHtml(EVENT_LEAD[event])}</p>
      ${factsTable([
        ['ID сигнала', `<span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(signal.id)}</span>`],
        [
          'Статус',
          `<span style="display:inline-block;padding:3px 11px;border-radius:999px;background:${accent};color:#fff;font-size:13px;font-weight:700;">${escapeHtml(meta.label)}</span>`,
        ],
        ['Категория', escapeHtml(categoryLabel(signal.category))],
        ['Дата изменения', escapeHtml(formatDateTime(changedAt))],
        ['Кто изменил', escapeHtml(actor?.displayName ?? 'Система')],
        ['Подрядчик', escapeHtml(signal.contractorName)],
        ['Сектор', escapeHtml(signal.sector)],
        ['Описание', escapeHtml(truncate(signal.description))],
        ...attachmentsRow,
      ])}`,
    ctaLabel: 'Открыть карточку сигнала',
    ctaUrl: url,
    footerNote: FOOTER_NOTE[audience] ?? FOOTER_NOTE.staff,
  });

  const text = [
    EVENT_TITLE[event],
    '',
    `ID сигнала: ${signal.id}`,
    `Статус: ${meta.label}`,
    `Категория: ${categoryLabel(signal.category)}`,
    `Дата изменения: ${formatDateTime(changedAt)}`,
    `Подрядчик: ${signal.contractorName}`,
    `Сектор: ${signal.sector}`,
    `Описание: ${truncate(signal.description)}`,
    '',
    `Карточка сигнала: ${url}`,
  ].join('\n');

  return { subject: `${EVENT_TITLE[event]} · ${categoryLabel(signal.category)} · ${signal.contractorName}`, html, text };
}
