/**
 * Запись видео-туториала по приложению.
 *
 * Скрипт поднимает отдельный экземпляр сервера на чистой базе, проходит
 * браузером все сценарии, накладывает подписи прямо в страницу и снимает кадры.
 * Затем ffmpeg собирает из кадров MP4: у каждого кадра своя длительность,
 * чтобы подпись успевали прочитать.
 *
 * Требования: playwright-core с браузером и ffmpeg.
 *   npm i --no-save playwright-core
 *   npx playwright install chromium
 *   node tools/record-tutorial.mjs
 *
 * Почта в записи намеренно уходит в dev-инбокс: туториал не должен рассылать
 * настоящие письма.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.TUTORIAL_OUT ?? path.join(ROOT, 'tutorial');
const FRAMES_DIR = path.join(OUT_DIR, 'frames');
const DATA_DIR = path.join(OUT_DIR, 'data');
const PORT = Number(process.env.TUTORIAL_PORT) || 5399;
const BASE = `http://localhost:${PORT}`;

const CANVAS = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 780 };

fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

/* --------------------------------- сервер ------------------------------------ */

const server = spawn('node', [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    APP_URL: BASE,
    // Пустой хост выключает SMTP: письма идут в локальный dev-инбокс.
    SMTP_HOST: '',
    DEFAULT_ADMIN_EMAIL: 'admin@signal.local',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (chunk) => process.stdout.write(`  [сервер] ${chunk}`));

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/api/state`)).ok) return;
    } catch {
      /* сервер еще поднимается */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('сервер не поднялся');
}

/* ------------------------------- API-помощники -------------------------------- */

let adminCookie = '';

async function api(method, url, body, cookie = adminCookie) {
  const response = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status}: ${payload?.error}`);
  return payload;
}

async function loginApi(login, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!response.ok) throw new Error(`вход ${login} не удался`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

/* --------------------------------- кадры ------------------------------------- */

const frames = [];
let stepNumber = 0;

/** Подпись живет вне #app, поэтому переживает перерисовку приложения. */
function injectCaption(payload) {
  let host = document.getElementById('tutorial-caption');
  if (!host) {
    host = document.createElement('div');
    host.id = 'tutorial-caption';
    host.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
      'padding:20px 28px 24px', 'pointer-events:none',
      'background:linear-gradient(to top, rgba(5,9,14,.98) 58%, rgba(5,9,14,0))',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif',
      'display:flex', 'align-items:flex-end', 'gap:16px',
    ].join(';');
    host.innerHTML =
      '<div id="tc-step" style="flex:none;min-width:48px;height:48px;border-radius:13px;' +
      'background:#4f8cff;color:#06121f;font-weight:800;font-size:20px;display:flex;' +
      'align-items:center;justify-content:center"></div>' +
      '<div style="flex:1;min-width:0">' +
      '<div id="tc-title" style="color:#8b99ab;font-size:12.5px;letter-spacing:.12em;' +
      'text-transform:uppercase;font-weight:700;margin-bottom:6px"></div>' +
      '<div id="tc-text" style="color:#fff;font-size:22px;line-height:1.35;font-weight:600"></div>' +
      '</div>';
    document.body.appendChild(host);
  }
  document.getElementById('tc-step').textContent = payload.step;
  document.getElementById('tc-title').textContent = payload.title;
  document.getElementById('tc-text').textContent = payload.text;
}

function injectHighlight(selector) {
  document.getElementById('tutorial-highlight')?.remove();
  if (!selector) return;

  const target = document.querySelector(selector);
  if (!target) return;

  const box = target.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.id = 'tutorial-highlight';
  ring.style.cssText = [
    'position:fixed', 'z-index:99998', 'pointer-events:none',
    `left:${box.left - 6}px`, `top:${box.top - 6}px`,
    `width:${box.width + 12}px`, `height:${box.height + 12}px`,
    'border:3px solid #4f8cff', 'border-radius:14px',
    'box-shadow:0 0 0 9999px rgba(5,9,14,.5), 0 0 24px rgba(79,140,255,.9)',
  ].join(';');
  document.body.appendChild(ring);
}

const FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const CANVAS_PX = { width: CANVAS.width * 1.5, height: CANVAS.height * 1.5 };

/**
 * Кадр телефона собирается иначе: подпись, сверстанная внутрь узкого экрана,
 * налезала бы на содержимое. Поэтому снимок ставится слева, а текст рисуется
 * на свободном поле справа.
 */
function composeMobileFrame(source, target, { step, title, text }) {
  const textX = 900;
  const result = spawnSync('magick', [
    '-size', `${CANVAS_PX.width}x${CANVAS_PX.height}`, 'xc:#0d1117',
    '(', source, '-resize', 'x1060', ')', '-gravity', 'west', '-geometry', '+150+0', '-composite',
    '(', '-background', 'none', '-fill', '#8b99ab', '-font', FONT, '-pointsize', '28',
    '-size', '860x', '-gravity', 'northwest', `caption:${step} · ${title.toUpperCase()}`, ')',
    '-gravity', 'northwest', '-geometry', `+${textX}+470`, '-composite',
    '(', '-background', 'none', '-fill', 'white', '-font', FONT, '-pointsize', '44',
    '-size', '860x', '-gravity', 'northwest', `caption:${text}`, ')',
    '-gravity', 'northwest', '-geometry', `+${textX}+520`, '-composite',
    target,
  ]);

  if (result.status !== 0) throw new Error(`magick: ${result.stderr?.toString().slice(0, 300)}`);
}

async function shot(page, { title, text, seconds = 3.6, highlight = null, settle = 320, mobile = false }) {
  stepNumber += 1;
  if (!mobile) await page.evaluate(injectCaption, { step: String(stepNumber), title, text });
  await page.evaluate(injectHighlight, highlight);
  await page.waitForTimeout(settle);

  const index = String(frames.length).padStart(4, '0');
  const file = path.join(FRAMES_DIR, `frame-${index}.png`);

  if (mobile) {
    const raw = path.join(FRAMES_DIR, `raw-${index}.png`);
    await page.screenshot({ path: raw });
    composeMobileFrame(raw, file, { step: String(stepNumber), title, text });
    fs.rmSync(raw);
  } else {
    await page.screenshot({ path: file });
  }

  frames.push({ file, seconds });
  console.log(`  кадр ${String(frames.length).padStart(2, '0')} · ${title}: ${text.slice(0, 60)}…`);
}

const clearHighlight = (page) => page.evaluate(injectHighlight, null);
const goHash = async (page, hash, selector) => {
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
  if (selector) await page.waitForSelector(selector, { timeout: 15000 });
  await page.waitForTimeout(250);
};

/* --------------------------------- сценарий ---------------------------------- */

async function record() {
  await waitForServer();
  adminCookie = await loginApi('admin', 'admin123');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: CANVAS,
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    acceptDownloads: true,
  });
  const page = await context.newPage();

  /* ------------------------------ 1. Знакомство ------------------------------ */

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.hero__title');

  await shot(page, {
    title: 'Система мониторинга сигналов',
    text: 'Подрядчики сообщают о проблемах, администраторы их разбирают. Пройдем по всем возможностям.',
    seconds: 5.5,
  });
  await shot(page, {
    title: 'Главная страница',
    text: '«Задать проблему» — основное действие подрядчика. Регистрация не нужна.',
    highlight: '.hero__actions .btn--primary',
  });
  await shot(page, {
    title: 'Главная страница',
    text: '«Зайти в админ аккаунт» — вход в панель управления по логину и паролю.',
    highlight: '.hero__actions .btn--secondary',
  });

  await clearHighlight(page);
  await page.evaluate(() => document.querySelector('.status-cards').scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Жизненный цикл сигнала',
    text: 'Желтый ставится при создании, Красный — через 48 часов, Зеленый и Серый закрывают сигнал.',
    highlight: '.status-cards',
    seconds: 5,
  });

  /* --------------------------- 2. Создание сигнала --------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/new', '.line-options');
  await shot(page, {
    title: 'Шаг 1 из 2',
    text: 'Выбор линии: Юридическая, Поставка или Проектирование. Шаг можно пропустить.',
    highlight: '.line-options',
    seconds: 4.2,
  });

  await page.click('[data-line="supply"]');
  await page.waitForSelector('#signal-form');
  await clearHighlight(page);
  await shot(page, {
    title: 'Шаг 2 из 2',
    text: 'Форма сигнала: подрядчик, сектор работы, описание и вложения.',
  });

  await page.click('#signal-form button[type="submit"]');
  await page.waitForTimeout(300);
  await shot(page, {
    title: 'Валидация',
    text: 'Пустая форма не отправляется: поля подсвечиваются красным, под каждым указана причина.',
    highlight: '#signal-form',
    seconds: 5,
  });

  await clearHighlight(page);
  await page.fill('[name="contractorName"]', 'ООО «СтройМонтаж»');
  await page.fill('[name="sector"]', 'Блок Б, 3 этаж');
  await page.fill('[name="description"]', 'Не завезли арматуру А500С диаметром 12 мм, армирование перекрытия остановлено.');
  await shot(page, {
    title: 'Заполнение',
    text: 'Подсветка снимается сразу при вводе — не нужно повторно отправлять форму.',
  });

  await page.setInputFiles('[data-role="file-input"]', {
    name: 'акт-осмотра.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 демонстрационный акт осмотра'),
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.dropzone').scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Вложения',
    text: 'Файлы перетаскивают в зону или выбирают на диске. Проверяются формат и размер — до 15 МБ.',
    highlight: '.dropzone',
    seconds: 5,
  });

  await clearHighlight(page);
  await page.click('#signal-form button[type="submit"]');
  await page.waitForSelector('.detail', { timeout: 20000 });
  await shot(page, {
    title: 'Сигнал создан',
    text: 'Статус «Новая проблема» выставлен автоматически, рядом — таймер до эскалации.',
    seconds: 4.6,
  });

  await page.evaluate(() => document.querySelector('.attachments')?.scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Карточка сигнала',
    text: 'Вложение можно скачать, иконка подобрана по типу файла.',
    highlight: '.attachments',
  });

  /* ----------------------------- 3. Кабинет автора --------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/my', '.rows');
  await shot(page, {
    title: 'Мои сигналы',
    text: 'Личный кабинет подрядчика: только свои обращения. Чужие сюда не попадают.',
    seconds: 4.6,
  });
  await shot(page, {
    title: 'Действия автора',
    text: '«Изменить» правит карточку, «Проблема решена» закрывает сигнал. Оба действия попадут в историю.',
    highlight: '.row__actions',
    seconds: 4.6,
  });

  /* ------------------------- 4. Вход администратора -------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/admin/login', '#login-form');
  await shot(page, {
    title: 'Вход администратора',
    text: 'Панель управления доступна только по учетным данным.',
    highlight: '#login-form',
  });

  await page.fill('[name="login"]', 'admin');
  await page.fill('[name="password"]', 'admin123');
  await clearHighlight(page);
  await shot(page, { title: 'Вход администратора', text: 'Вводим логин и пароль и нажимаем «Войти».' });

  // Фон дашборда: несколько сигналов по разным линиям.
  await api('POST', '/api/signals', {
    line: 'legal', contractorName: 'ООО «ЮрГарант»', sector: 'Договор №14/2026',
    description: 'Не согласовано допсоглашение по переносу сроков, работы простаивают вторую неделю.',
  });
  await api('POST', '/api/signals', {
    line: 'design', contractorName: 'АО «ПроектСервис»', sector: 'Секция В, кровля',
    description: 'Разночтения в РД по узлу примыкания парапета, требуется решение проектировщика.',
  });
  await api('POST', '/api/signals', {
    line: null, contractorName: 'ИП Соколов', sector: 'Бытовой городок',
    description: 'Отсутствует освещение на подходе к бытовкам, работа во вторую смену небезопасна.',
  });

  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('.board', { timeout: 20000 });

  /* -------------------------------- 5. Дашборд -------------------------------- */

  await shot(page, {
    title: 'Карта сигналов',
    text: 'Все обращения системы. Изменения приходят сразу, без перезагрузки страницы.',
    seconds: 5,
  });
  await shot(page, {
    title: 'Счетчики',
    text: 'Сводка по статусам: сколько всего, сколько новых, критичных, решенных и отклоненных.',
    highlight: '.stats',
    seconds: 4.4,
  });
  await shot(page, {
    title: 'Фильтр по линии',
    text: 'Показать все линии сразу или одну конкретную, включая сигналы без линии.',
    highlight: '.filters__group:nth-child(1)',
    seconds: 4.4,
  });
  await shot(page, {
    title: 'Фильтр по статусу',
    text: 'Только активные, либо конкретный статус — фильтры складываются друг с другом.',
    highlight: '.filters__group:nth-child(2)',
    seconds: 4.4,
  });
  await shot(page, {
    title: 'Фильтр «В работе»',
    text: 'Принятые и непринятые сигналы. Если ничего не выбрано — показываются все.',
    highlight: '.filters__group:nth-child(3)',
    seconds: 4.6,
  });

  await clearHighlight(page);
  await page.evaluate(() => document.querySelector('.board').scrollIntoView({ block: 'start' }));
  await shot(page, {
    title: 'Колонки по линиям',
    text: 'Карточки разложены по линиям и окрашены по статусу — цвет виден с одного взгляда.',
    highlight: '.board',
    seconds: 4.6,
  });

  /* --------------------- 6. Карточка сигнала у админа ------------------------ */

  const state = await api('GET', '/api/state');
  const supply = state.allSignals.find((signal) => signal.line === 'supply');

  await clearHighlight(page);
  await goHash(page, `#/admin/signal/${supply.id}`, '.detail');
  await shot(page, {
    title: 'Карточка сигнала',
    text: 'Администратор видит автора, линию, возраст, вложения и полную историю.',
    seconds: 4.6,
  });

  await page.evaluate(() => document.querySelector('.detail__actions').scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Принять в работу',
    text: 'Администратор берет сигнал на себя — фамилия исполнителя становится видна всем.',
    highlight: '[data-assign="true"]',
    seconds: 4.6,
  });

  await page.click('[data-assign="true"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('Исполнители'));
    heading?.scrollIntoView({ block: 'center' });
  });
  await shot(page, {
    title: 'Исполнители',
    text: 'Сигнал могут вести несколько человек. Крестик снимает исполнителя — себя или коллегу.',
    highlight: '.roster',
    seconds: 5,
  });

  await clearHighlight(page);
  await page.evaluate(() => document.querySelector('.detail__actions').scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Управление статусом',
    text: '«Проблема решена» и «Отклонить сигнал» — терминальные статусы: после них правки закрыты.',
    highlight: '.detail__actions',
    seconds: 4.8,
  });
  await shot(page, {
    title: 'Ручная эскалация',
    text: '«Перевести в Красный» поднимает критичность, не дожидаясь 48 часов.',
    highlight: '[data-status="red"]',
    seconds: 4.6,
  });

  /* --------------------------- 7. Автоэскалация ------------------------------ */

  const design = state.allSignals.find((signal) => signal.line === 'design');
  await clearHighlight(page);
  await goHash(page, `#/admin/signal/${design.id}`, '.detail');
  await page.evaluate(() => document.querySelector('.devtool')?.scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Автоэскалация',
    text: 'Демо-кнопка сдвигает метки времени на 48 часов назад — статус она не меняет.',
    highlight: '.devtool',
    seconds: 5,
  });

  await page.click('[data-age]');
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('История'));
    heading?.scrollIntoView({ block: 'start' });
  });
  await clearHighlight(page);
  await shot(page, {
    title: 'Сработал фоновый процесс',
    text: 'Через несколько секунд сервер сам перевел сигнал в Красный и записал это от имени Системы.',
    highlight: '.history',
    seconds: 6,
  });

  /* --------------------------- 8. Редактирование ----------------------------- */

  await clearHighlight(page);
  await goHash(page, `#/admin/signal/${design.id}/edit`, '#edit-signal-form');
  await shot(page, {
    title: 'Редактирование',
    text: 'Править можно линию, подрядчика, сектор и описание. Действуют те же правила валидации.',
    highlight: '#edit-signal-form',
    seconds: 4.6,
  });

  // Сам input скрыт, кликаем по видимой подписи — как это сделал бы человек.
  await page.locator('label.radio', { has: page.locator('[name="line"][value="legal"]') }).click();
  await page.fill('[name="sector"]', 'Секция В, кровля — уточнено');
  await page.fill('[name="description"]', 'После выезда на объект: течь по узлу примыкания парапета, нужен проектировщик.');
  await clearHighlight(page);
  await shot(page, { title: 'Редактирование', text: 'Меняем линию, сектор и описание и сохраняем.' });

  await page.click('#edit-signal-form button[type="submit"]');
  await page.waitForSelector('.detail', { timeout: 20000 });
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('История'));
    heading?.scrollIntoView({ block: 'start' });
  });
  await shot(page, {
    title: 'История правок',
    text: 'Видно, кто правил и что именно: старое значение зачеркнуто, новое рядом.',
    highlight: '.diff',
    seconds: 6,
  });

  /* ------------------------------- 9. Задачи --------------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/tasks', '.page__title');
  await shot(page, {
    title: 'Модуль «Задачи»',
    text: 'Независимый раздел: у задач нет таймеров эскалации и почтовых уведомлений.',
    seconds: 4.6,
  });

  await goHash(page, '#/tasks/new', '#task-form');
  await page.fill('[name="title"]', 'Согласовать график поставок на август');
  await page.fill('[name="description"]', 'Собрать заявки от бригад и согласовать график с отделом снабжения.');
  await shot(page, {
    title: 'Создание задачи',
    text: 'Заголовок, описание и вложения — форма устроена так же, как у сигнала.',
    highlight: '#task-form',
    seconds: 4.4,
  });

  await clearHighlight(page);
  await page.click('#task-form button[type="submit"]');
  await page.waitForSelector('.detail', { timeout: 20000 });
  await shot(page, {
    title: 'Карточка задачи',
    text: 'Статусы задач меняются вручную в любом направлении: Открыта, В работе, Завершена.',
    highlight: '.detail__section:last-child .detail__actions, .detail__actions',
    seconds: 4.6,
  });

  await page.click('[data-assign="true"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('Исполнители'));
    heading?.scrollIntoView({ block: 'center' });
  });
  await clearHighlight(page);
  await shot(page, {
    title: 'Задачу тоже принимают в работу',
    text: 'Исполнителей может быть несколько — коллега не блокирует задачу для остальных.',
    highlight: '.roster',
    seconds: 5,
  });

  await clearHighlight(page);
  await goHash(page, '#/tasks', '.board');
  await shot(page, {
    title: 'Доска задач',
    text: 'Колонки по статусам, фильтры по статусу и по принятию в работу, экспорт в Excel.',
    highlight: '.filters',
    seconds: 4.8,
  });

  /* --------------------------- 10. Администраторы ---------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/admin/users', '#admin-form');
  await shot(page, {
    title: 'Администраторы',
    text: 'Список учетных записей: логин, email и статус подтверждения почты.',
    highlight: '.table',
    seconds: 4.6,
  });

  await page.fill('[name="displayName"]', 'Петров Сергей Иванович');
  await page.fill('[name="login"]', 'petrov');
  await page.fill('[name="email"]', 'petrov@example.com');
  await page.fill('[name="password"]', 'stroy2026');
  await page.fill('[name="password2"]', 'stroy2026');
  await shot(page, {
    title: 'Новый администратор',
    text: 'Имя вводится как ФИО — из него собираются фамилия и инициалы для карточек.',
    highlight: '#admin-form',
    seconds: 4.8,
  });

  await clearHighlight(page);
  await page.click('#admin-form button[type="submit"]');
  await page.waitForTimeout(2000);
  await shot(page, {
    title: 'Письмо подтверждения',
    text: 'Система сразу отправила письмо со ссылкой. Доступ к панели закрыт, пока почта не подтверждена.',
    seconds: 5,
  });

  await page.goto(`${BASE}/dev/mailbox`, { waitUntil: 'load' });
  await shot(page, {
    title: 'Dev-инбокс',
    text: 'В записи SMTP выключен, поэтому письма видны локально. В рабочем режиме они уходят почтой.',
    highlight: '.table',
    seconds: 5,
  });

  const mailLink = await page.locator('.table a.link').first().getAttribute('href');
  await page.goto(BASE + mailLink, { waitUntil: 'load' });
  await clearHighlight(page);
  await shot(page, {
    title: 'Письмо',
    text: 'HTML-шаблон с кнопкой подтверждения. Ссылка одноразовая и живет 24 часа.',
    seconds: 5,
  });

  /* ----------------------- 11. Несколько исполнителей ------------------------ */

  // Подтверждаем почту так же, как это сделал бы человек: открываем письмо
  // в чистой сессии и жмем кнопку в нем. Разбирать сырой .eml не нужно —
  // там quoted-printable, и ссылка в нем закодирована.
  const secondContext = await browser.newContext({ viewport: CANVAS, deviceScaleFactor: 2, locale: 'ru-RU' });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(BASE + mailLink, { waitUntil: 'load' });
  await secondPage.click('a[href*="/verify?token="]');
  await secondPage.waitForSelector('.auth', { timeout: 15000 });
  await shot(secondPage, {
    title: 'Почта подтверждена',
    text: 'Переход по ссылке активирует учетную запись и сразу открывает панель управления.',
    seconds: 5,
  });

  await secondPage.goto(`${BASE}/#/admin/signal/${supply.id}`, { waitUntil: 'load' });
  await secondPage.waitForSelector('.detail');
  await secondPage.evaluate(() => document.querySelector('.detail__actions').scrollIntoView({ block: 'center' }));
  await secondPage.click('[data-assign="true"]');
  await secondPage.waitForTimeout(1200);
  await secondPage.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('Исполнители'));
    heading?.scrollIntoView({ block: 'center' });
  });
  await shot(secondPage, {
    title: 'Двое в работе',
    text: 'Второй администратор принял тот же сигнал: в списке теперь оба, с датой принятия.',
    highlight: '.roster',
    seconds: 5.5,
  });
  await secondContext.close();

  /* ------------------------------ 12. Профиль -------------------------------- */

  // Вкладка сейчас на странице письма — это обычный HTML, а не SPA,
  // поэтому возвращаемся в приложение полноценной навигацией.
  await page.goto(`${BASE}/#/admin/profile`, { waitUntil: 'load' });
  await page.waitForSelector('#settings-form', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#settings-form').scrollIntoView({ block: 'center' }));
  await shot(page, {
    title: 'Профиль администратора',
    text: 'Настройки уведомлений действуют только на вашу учетную запись.',
    highlight: '#settings-form',
    seconds: 4.6,
  });
  await shot(page, {
    title: 'Главный тумблер',
    text: 'Выключает рассылку целиком — вся группа условий ниже становится неактивной.',
    highlight: '[name="notificationsEnabled"] ~ .switch__track, .switch',
    seconds: 4.6,
  });

  const masterSwitch = page.locator('label.switch', { has: page.locator('[name="notificationsEnabled"]') });
  await masterSwitch.click();
  await page.waitForTimeout(400);
  await shot(page, {
    title: 'Зависимая группа',
    text: 'Линии и события гаснут: без включенной рассылки настраивать их нечего.',
    highlight: '[data-role="dependent"]',
    seconds: 5,
  });

  await masterSwitch.click();
  await page.waitForTimeout(400);
  await shot(page, {
    title: 'Условия рассылки',
    text: 'Линии сигналов и три события: создание, переход в Красный, решение или отклонение.',
    highlight: '[data-role="dependent"]',
    seconds: 5,
  });
  await shot(page, {
    title: 'Дашборд задач',
    text: 'Независимый тумблер: при выключении раздел «Задачи» пропадает из меню.',
    highlight: '[name="tasksDashboardEnabled"] ~ .switch__track, .switch:last-of-type',
    seconds: 4.6,
  });

  /* ------------------------------- 13. Экспорт -------------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/admin?line=all&status=all&assignment=all', '.board');
  await shot(page, {
    title: 'Экспорт в Excel',
    text: 'Кнопка отдает .xlsx с текущими фильтрами: сервер собирает файл SQL-запросом.',
    highlight: '[data-action="export"]',
    seconds: 4.8,
  });

  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('[data-action="export"]');
  const file = await download;
  await page.waitForTimeout(900);
  await clearHighlight(page);
  await shot(page, {
    title: 'Отчет готов',
    text: `Файл ${file.suggestedFilename()} скачан: колонки типизированы, даты остаются датами.`,
    seconds: 5,
  });

  /* ------------------------------ 14. Мобильная ------------------------------- */

  const mobileContext = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    storageState: await context.storageState(),
  });
  const mobile = await mobileContext.newPage();

  await mobile.goto(`${BASE}/#/admin`, { waitUntil: 'load' });
  await mobile.waitForSelector('.stats');
  await shot(mobile, {
    mobile: true,
    title: 'Мобильная версия',
    text: 'Та же система на телефоне: шапка свернута в кнопку меню, счетчики в две колонки.',
    seconds: 5,
  });

  await mobile.click('[data-action="menu"]');
  await mobile.waitForTimeout(500);
  await shot(mobile, {
    mobile: true,
    title: 'Меню',
    text: 'Разделы, имя администратора и выход. Меню закрывается тапом по пункту или мимо шапки.',
    seconds: 4.8,
  });

  await mobile.click('[data-action="menu"]');
  await mobile.goto(`${BASE}/#/admin/users`, { waitUntil: 'load' });
  await mobile.waitForTimeout(700);
  await shot(mobile, {
    mobile: true,
    title: 'Таблицы на телефоне',
    text: 'Список администраторов превращается в карточки с подписями — горизонтальной прокрутки нет.',
    seconds: 5,
  });

  await mobile.goto(`${BASE}/#/admin/signal/${supply.id}`, { waitUntil: 'load' });
  await mobile.waitForSelector('.detail');
  await mobile.evaluate(() => {
    const heading = [...document.querySelectorAll('.detail__section h2')].find((el) => el.textContent.includes('Исполнители'));
    heading?.scrollIntoView({ block: 'center' });
  });
  await shot(mobile, {
    mobile: true,
    title: 'Карточка на телефоне',
    text: 'Кнопки во всю ширину, цели нажатия не меньше 44 пикселей.',
    seconds: 5,
  });

  await mobileContext.close();

  /* -------------------------------- 15. Финал -------------------------------- */

  await clearHighlight(page);
  await goHash(page, '#/admin?line=all&status=all&assignment=all', '.board');
  await shot(page, {
    title: 'Это всё',
    text: 'Двухшаговое создание, автоэскалация, исполнители, правки с историей, задачи, почта и экспорт.',
    seconds: 6,
  });

  await context.close();
  await browser.close();
}

/* --------------------------------- сборка ------------------------------------ */

function buildVideo() {
  const listFile = path.join(OUT_DIR, 'frames.txt');
  const lines = [];

  for (const frame of frames) {
    lines.push(`file '${frame.file}'`);
    lines.push(`duration ${frame.seconds}`);
  }
  // Последний кадр дублируется: иначе ffmpeg обрежет его длительность.
  lines.push(`file '${frames.at(-1).file}'`);
  fs.writeFileSync(listFile, lines.join('\n'));

  const output = path.join(OUT_DIR, 'signal-monitor-tutorial.mp4');
  const width = CANVAS.width * 1.5;
  const height = CANVAS.height * 1.5;
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0d1117`,
    'format=yuv420p',
  ].join(',');

  const result = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filter, '-r', '30',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', output],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  if (result.status !== 0) {
    console.error(result.stderr?.toString().split('\n').slice(-20).join('\n'));
    throw new Error('ffmpeg завершился с ошибкой');
  }
  return output;
}

/* ---------------------------------- запуск ----------------------------------- */

try {
  await record();
  const output = buildVideo();
  const seconds = frames.reduce((total, frame) => total + frame.seconds, 0);
  console.log(`\n  Готово: ${output}`);
  console.log(`  Кадров: ${frames.length}, длительность ≈ ${Math.round(seconds)} с\n`);
} catch (error) {
  console.error('\n  Запись не удалась:', error);
  process.exitCode = 1;
} finally {
  server.kill();
}
