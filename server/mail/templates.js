/**
 * HTML-шаблоны писем.
 *
 * Вёрстка намеренно табличная и с инлайновыми стилями — почтовые клиенты
 * не поддерживают внешний CSS, flex и grid.
 */

import {
  ROLE,
  ROLE_LABEL,
  STATUS_META,
  SIGNAL_ACTION,
  SIGNAL_ACTION_LABEL,
  categoryLabel,
  formatBytes,
  signalNumber,
} from '../../shared/constants.js';

const STATUS_COLOR = {
  intake: '#3b74e8',
  rework: '#8a5cd6',
  yellow: '#e0a800',
  red: '#d93a26',
  returned: '#e07b1a',
  confirm: '#119c95',
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

/** Первая строка письма: что произошло. Подрядчику при возврате — что делать дальше. */
function leadFor(action, { audience, actor }) {
  switch (action) {
    case SIGNAL_ACTION.CREATE:
      return audience === 'contractor'
        ? 'Сигнал зарегистрирован и передан на входной контроль: главный администратор проверит, достаточно ли в нем данных для передачи в работу. О каждом следующем шаге придет письмо в эту же цепочку.'
        : 'Поступил новый сигнал. Он ожидает входного контроля.';
    case SIGNAL_ACTION.INTAKE_RETURN:
      return audience === 'contractor'
        ? 'Данных в сигнале недостаточно, чтобы передать его в работу. Дополните сигнал по комментарию ниже — уточните описание, приложите документы или фотографии — и отправьте его на повторную проверку.'
        : 'По результатам входного контроля сигнал возвращен подрядчику на доработку.';
    case SIGNAL_ACTION.UPDATE:
      return 'В сигнал внесены дополнения или изменения.';
    case SIGNAL_ACTION.RESUBMIT:
      return 'Сигнал доработан и повторно направлен на входной контроль.';
    case SIGNAL_ACTION.DISTRIBUTE:
      return 'Сигнал прошел входной контроль и передан в работу ответственному.';
    case SIGNAL_ACTION.ASSIGN:
      return 'По сигналу назначен ответственный.';
    case SIGNAL_ACTION.COMMENT:
      return 'По сигналу добавлен комментарий.';
    case SIGNAL_ACTION.ESCALATE:
      return actor?.role === ROLE.SYSTEM
        ? 'Срок отработки 48 часов истек — система перевела сигнал в критичные.'
        : 'Сигнал переведен в критичные.';
    case SIGNAL_ACTION.REPORT:
      return 'Ответственный добавил отчет о выполненных действиях.';
    case SIGNAL_ACTION.SUBMIT:
      return audience === 'contractor'
        ? 'Ответственный отработал сигнал и направил вам результат. Проверьте по отчету ниже, устранена ли проблема, и в карточке сигнала подтвердите выполнение или верните сигнал на доработку с комментарием.'
        : 'Ответственный отработал сигнал и направил результат подрядчику на подтверждение.';
    case SIGNAL_ACTION.RESUBMIT_WORK:
      return audience === 'contractor'
        ? 'Ответственный доработал решение и повторно направил вам результат. Проверьте по отчету ниже, устранена ли проблема, и подтвердите выполнение или снова верните сигнал на доработку.'
        : 'Ответственный доработал решение и повторно направил результат подрядчику на подтверждение.';
    case SIGNAL_ACTION.CONFIRM:
      return 'Подрядчик подтвердил, что проблема устранена. Сигнал закрыт.';
    case SIGNAL_ACTION.RETURN:
      return audience === 'contractor'
        ? 'Сигнал возвращен ответственному на доработку с вашим комментарием.'
        : 'Подрядчик не подтвердил устранение проблемы и вернул сигнал на доработку. Доработайте решение, дополните отчет и повторно направьте результат на подтверждение.';
    case SIGNAL_ACTION.RESOLVE:
      return 'Автор закрыл сигнал: проблема решена.';
    case SIGNAL_ACTION.REJECT:
      return 'Сигнал отклонен и закрыт без решения.';
    case SIGNAL_ACTION.REOPEN:
      return 'Сигнал возобновлен и возвращен в работу.';
    default:
      return 'По сигналу выполнено действие.';
  }
}

/** Подпись комментария: при возврате это перечень того, что дополнить, при отправке — отчет. */
function commentLabel(action) {
  switch (action) {
    case SIGNAL_ACTION.INTAKE_RETURN:
      return 'Что нужно дополнить';
    case SIGNAL_ACTION.RETURN:
      return 'Что не устранено';
    case SIGNAL_ACTION.REPORT:
    case SIGNAL_ACTION.SUBMIT:
    case SIGNAL_ACTION.RESUBMIT_WORK:
      return 'Отчет о выполнении';
    case SIGNAL_ACTION.REJECT:
      return 'Причина';
    default:
      return 'Комментарий';
  }
}

function actorName(actor) {
  if (!actor || actor.role === ROLE.SYSTEM) return 'Система';
  const role = ROLE_LABEL[actor.role]?.toLowerCase();
  if (!role || actor.displayName?.toLowerCase() === role) return actor.displayName;
  return `${actor.displayName} (${role})`;
}

const FOOTER_NOTE = {
  staff: 'Письма по этому сигналу приходят с одной темой и собираются в почте в одну цепочку. Отключить уведомления можно в разделе «Аккаунт».',
  contractor:
    'Письмо отправлено участнику обращения. Письма по этому сигналу приходят с одной темой и собираются в почте в одну цепочку. Отключить уведомления можно в разделе «Аккаунт».',
};

/**
 * Письмо о действии с сигналом.
 *
 * В каждом письме — номер сигнала, действие и новый статус, кто его выполнил,
 * комментарий, если он был, и ссылка прямо в карточку. Тема приходит снаружи
 * и одинакова для всех писем сигнала.
 */
export function signalNotificationEmail({
  action,
  signal,
  actor,
  url,
  audience = 'staff',
  subject,
  comment = null,
  changes = [],
  files = [],
  assigned = [],
}) {
  const meta = STATUS_META[signal.status];
  const accent = STATUS_COLOR[signal.status] ?? '#3b74e8';
  const changedAt = signal.history.at(-1)?.at ?? signal.updatedAt;
  const title = `${signalNumber(signal)} · ${SIGNAL_ACTION_LABEL[action] ?? 'Действие с сигналом'}`;
  const lead = leadFor(action, { audience, actor });

  const assigneeNames = (signal.assignees ?? []).map((person) => person.name).join(', ');
  const fileNames = files.map((file) => `${file.filename} (${formatBytes(file.size)})`);
  // Заметка адресована ответственным — подрядчику ее не показываем.
  const showNote =
    audience === 'staff' &&
    signal.assignmentNote &&
    (action === SIGNAL_ACTION.DISTRIBUTE || action === SIGNAL_ACTION.ASSIGN);

  const rows = [
    ['Сигнал', `<b>${escapeHtml(signalNumber(signal))}</b>`],
    ['Действие', escapeHtml(SIGNAL_ACTION_LABEL[action] ?? action)],
    [
      'Статус',
      `<span style="display:inline-block;padding:3px 11px;border-radius:999px;background:${accent};color:#fff;font-size:13px;font-weight:700;">${escapeHtml(meta?.label ?? signal.status)}</span>`,
    ],
    ['Кто выполнил', escapeHtml(actorName(actor))],
    ['Когда', escapeHtml(formatDateTime(changedAt))],
    ...(changes.length ? [['Изменено', escapeHtml(changes.map((change) => change.label).join(', '))]] : []),
    ...(fileNames.length ? [['Файлы', fileNames.map(escapeHtml).join('<br>')]] : []),
    ...(assigned.length ? [['Назначены', escapeHtml(assigned.map((person) => person.displayName).join(', '))]] : []),
    ...(signal.category ? [['Категория', escapeHtml(categoryLabel(signal.category))]] : []),
    ...(assigneeNames ? [['Ответственные', escapeHtml(assigneeNames)]] : []),
    ...(showNote ? [['Заметка', escapeHtml(signal.assignmentNote)]] : []),
    ['Подрядчик', escapeHtml(signal.contractorName)],
    ['Сектор', escapeHtml(signal.sector)],
    ['Описание', escapeHtml(truncate(signal.description))],
  ];

  const commentHtml = comment
    ? `<div style="margin:4px 0 16px;padding:12px 16px;border-left:4px solid ${accent};background:#f6f8fb;border-radius:6px;">
         <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#8b99ab;margin-bottom:6px;">${escapeHtml(commentLabel(action))}</div>
         <div style="font-size:15px;white-space:pre-wrap;">${escapeHtml(comment)}</div>
       </div>`
    : '';

  const html = layout({
    title,
    accent,
    bodyHtml: `
      <p style="margin:0 0 14px;">${escapeHtml(lead)}</p>
      ${commentHtml}
      ${factsTable(rows)}`,
    ctaLabel: 'Открыть сигнал',
    ctaUrl: url,
    footerNote: FOOTER_NOTE[audience] ?? FOOTER_NOTE.staff,
  });

  const text = [
    title,
    '',
    lead,
    ...(comment ? ['', `${commentLabel(action)}:`, comment] : []),
    '',
    `Сигнал: ${signalNumber(signal)}`,
    `Статус: ${meta?.label ?? signal.status}`,
    `Кто выполнил: ${actorName(actor)}`,
    `Когда: ${formatDateTime(changedAt)}`,
    ...(changes.length ? [`Изменено: ${changes.map((change) => change.label).join(', ')}`] : []),
    ...(fileNames.length ? [`Файлы: ${fileNames.join(', ')}`] : []),
    ...(signal.category ? [`Категория: ${categoryLabel(signal.category)}`] : []),
    ...(assigneeNames ? [`Ответственные: ${assigneeNames}`] : []),
    `Подрядчик: ${signal.contractorName}`,
    `Сектор: ${signal.sector}`,
    `Описание: ${truncate(signal.description)}`,
    '',
    `Открыть сигнал: ${url}`,
  ].join('\n');

  return { subject, html, text };
}
