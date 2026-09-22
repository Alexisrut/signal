/**
 * Снимки экранов под каждой ролью. Сервер должен быть запущен на 5175 с посеянной базой.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'http://127.0.0.1:5175';
const OUT = path.join(HERE, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const ids = JSON.parse(fs.readFileSync(path.join(HERE, 'seed-ids.json'), 'utf8'));

const browser = await chromium.launch();

async function ctxFor(login, password, { mobile = false, theme = 'dark' } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('sms-theme', t); } catch {} }, theme);
  if (login) {
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { login, password } });
    if (!r.ok()) throw new Error(`login ${login}: ${r.status()}`);
  }
  return ctx;
}

async function open(ctx, hash) {
  // SSE-поток держит соединение: закрываем предыдущие вкладки, иначе браузер
  // упирается в лимит соединений на хост и новая страница не загружается.
  for (const old of ctx.pages()) await old.close();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__signalMonitorBooted === true);
  await page.waitForTimeout(400);
  return page;
}

async function shot(page, name, { full = false, clip } = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, clip });
  console.log('shot', name);
}

/* ---------------------------------- гость ---------------------------------- */
if (!process.env.ONLY_SUPER) {
  const ctx = await ctxFor(null);
  let p = await open(ctx, '#/');
  await shot(p, 'guest-home');
  p = await open(ctx, '#/login');
  await shot(p, 'guest-login');
  p = await open(ctx, '#/register');
  await shot(p, 'guest-register', { full: true });
  p = await open(ctx, '#/forgot');
  await shot(p, 'guest-forgot');
  // Пустая форма входа с ошибкой валидации
  p = await open(ctx, '#/login');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(300);
  await shot(p, 'guest-login-error');
  await ctx.close();
}

/* -------------------------------- подрядчик -------------------------------- */
if (!process.env.ONLY_SUPER) {
  const ctx = await ctxFor('ООО «СтройМонтаж»', 'stroy123');
  let p = await open(ctx, '#/');
  await shot(p, 'contractor-home');
  p = await open(ctx, '#/my');
  await shot(p, 'contractor-my', { full: true });
  p = await open(ctx, `#/my/${ids.s1}`);
  await shot(p, 'contractor-signal', { full: true });
  p = await open(ctx, `#/my/${ids.s5}`);
  await shot(p, 'contractor-signal-closed', { full: true });
  p = await open(ctx, `#/my/${ids.s1}/edit`);
  await shot(p, 'contractor-edit', { full: true });
  p = await open(ctx, '#/new');
  await p.fill('[name="sector"]', 'Блок Б, 4 этаж');
  await p.fill('[name="description"]', 'Не подключено временное освещение в коридоре, работы в вечернюю смену невозможны.');
  await p.setInputFiles('[data-role="file-input"]', [HERE + '/fixtures/фото-протечки.png']);
  await p.waitForTimeout(300);
  await shot(p, 'contractor-new', { full: true });
  // Ошибки валидации
  p = await open(ctx, '#/new');
  await p.fill('[name="sector"]', '');
  await p.fill('[name="description"]', 'коротко');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(300);
  await shot(p, 'contractor-new-errors', { full: true });
  p = await open(ctx, '#/account');
  await shot(p, 'contractor-account', { full: true });
  await ctx.close();

  const m = await ctxFor('ООО «СтройМонтаж»', 'stroy123', { mobile: true });
  p = await open(m, '#/my');
  await shot(p, 'contractor-mobile-my');
  await p.click('[data-action="menu"]');
  await p.waitForTimeout(300);
  await shot(p, 'contractor-mobile-menu');
  await m.close();
}

/* ------------------------------- администратор ------------------------------ */
if (!process.env.ONLY_SUPER) {
  const ctx = await ctxFor('petrov', 'petrov123');
  let p = await open(ctx, '#/');
  await shot(p, 'admin-home');
  p = await open(ctx, '#/admin');
  await shot(p, 'admin-dashboard', { full: true });
  p = await open(ctx, '#/admin?category=supply&status=active&stats=open');
  await shot(p, 'admin-dashboard-filtered', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s2}`);
  await shot(p, 'admin-signal-red', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s1}`);
  await shot(p, 'admin-signal-yellow', { full: true });
  // Диалог подтверждения перевода в красный
  await p.click('[data-status="red"]');
  await p.waitForTimeout(300);
  await shot(p, 'admin-confirm-red');
  await p.keyboard.press('Escape');
  p = await open(ctx, `#/admin/signal/${ids.s5}`);
  await shot(p, 'admin-signal-closed', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s1}/edit`);
  await shot(p, 'admin-edit', { full: true });
  p = await open(ctx, '#/account');
  await shot(p, 'admin-account', { full: true });
  p = await open(ctx, '#/new');
  await shot(p, 'admin-new');
  await ctx.close();
}

/* -------------------------------- руководитель ------------------------------ */
if (!process.env.ONLY_SUPER) {
  const ctx = await ctxFor('kuznetsov', 'kuznetsov123');
  let p = await open(ctx, '#/admin');
  await shot(p, 'manager-dashboard', { full: true });
  p = await open(ctx, '#/my');
  await shot(p, 'manager-my', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s2}`);
  await shot(p, 'manager-signal', { full: true });
  await ctx.close();
}

/* ----------------------------- главный администратор ------------------------ */
{
  const ctx = await ctxFor('admin', 'admin123');
  let p = await open(ctx, '#/');
  await shot(p, 'super-home');
  p = await open(ctx, '#/admin');
  await shot(p, 'super-dashboard', { full: true });
  p = await open(ctx, '#/admin/distribution');
  await shot(p, 'super-distribution', { full: true });
  // Окно распределения
  await p.click(`[data-signal="${ids.s6}"][data-category="other"]`);
  await p.waitForTimeout(400);
  await shot(p, 'super-assign-dialog');
  await p.keyboard.press('Escape');
  p = await open(ctx, `#/admin/signal/${ids.s1}`);
  await shot(p, 'super-signal', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s4}`);
  await shot(p, 'super-signal-gray', { full: true });
  p = await open(ctx, `#/admin/signal/${ids.s1}/edit`);
  await shot(p, 'super-edit', { full: true });
  p = await open(ctx, '#/admin/users');
  await shot(p, 'super-users', { full: true });
  // Редактор категорий в строке
  await p.click('[data-edit]');
  await p.waitForTimeout(300);
  await shot(p, 'super-users-editor', { full: true });
  // Форма создания: выбран тип «Руководитель»
  await p.click('label.radio:has(input[value="manager"])');
  await p.waitForTimeout(200);
  const form = await p.$('#admin-form');
  const box = await form.boundingBox();
  await shot(p, 'super-users-form', { clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 60), width: box.width + 48, height: Math.min(box.height + 90, 900) } });
  p = await open(ctx, '#/account');
  await shot(p, 'super-account', { full: true });
  // Dev-инбокс
  for (const old of ctx.pages()) await old.close();
  p = await ctx.newPage();
  await p.goto(`${BASE}/dev/mailbox`, { waitUntil: 'load' });
  await shot(p, 'super-mailbox', { full: true });
  const link = await p.$('table a.link');
  if (link) {
    await link.click();
    await p.waitForLoadState('load');
    await shot(p, 'super-mail', { full: true });
  }
  await ctx.close();

  // Светлая тема
  const light = await ctxFor('admin', 'admin123', { theme: 'light' });
  p = await open(light, '#/admin');
  await shot(p, 'super-dashboard-light');
  await light.close();

  const m = await ctxFor('admin', 'admin123', { mobile: true });
  p = await open(m, '#/admin');
  await shot(p, 'super-mobile-dashboard');
  await m.close();
}

await browser.close();
console.log('ALL DONE');
