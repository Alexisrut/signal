/**
 * Модель презентации: слайды описываются набором простых примитивов
 * (карточка, круг, текст, картинка) с координатами в дюймах.
 *
 * Из одной модели собираются оба файла — PPTX и PDF, поэтому они не могут
 * разъехаться по верстке.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IMG = (name) => path.join(HERE, 'img', name);

export const CANVAS = { w: 13.333, h: 7.5 };
const M = 0.62;
const CONTENT = CANVAS.w - M * 2;

/** Палитра взята из самого приложения. */
export const C = {
  bg: '0D1117',
  card: '18202C',
  cardSoft: '141B25',
  line: '2B3648',
  text: 'E7EDF4',
  muted: '9AA8BB',
  faint: '8391A6',
  accent: '4F8CFF',
  yellow: 'F5C542',
  red: 'F2543D',
  green: '35C46A',
  gray: '8B99AB',
  violet: 'C58CFF',
  teal: '38C6C0',
  coral: 'FF8F7D',
  indigo: '7C8CFF',
};

const FONT = 'Arial';
const MONO = 'Courier New';

/** Колоночная сетка: все ряды на слайде получают одинаковые левый и правый края. */
function grid(columns, gap = 0.2) {
  const w = (CONTENT - gap * (columns - 1)) / columns;
  return { w, x: (i) => M + i * (w + gap) };
}

/** Пропорции изображений — чтобы не растягивать скриншоты. */
const RATIO = { shot: 1600 / 875, phone: 530 / 1062 };

/* ------------------------------- примитивы ----------------------------------- */

class Slide {
  constructor(background) {
    this.background = background;
    this.blocks = [];
    this.notes = '';
  }

  card({ x, y, w, h, fill = C.card, line = C.line, radius = 0.14 }) {
    this.blocks.push({ t: 'card', x, y, w, h, fill, line, radius });
    return this;
  }

  circle({ x, y, d, color }) {
    this.blocks.push({ t: 'circle', x, y, d, color });
    return this;
  }

  text(value, options) {
    this.blocks.push({ t: 'text', value, font: FONT, size: 13, color: C.text, ...options });
    return this;
  }

  image({ src, x, y, w, h }) {
    this.blocks.push({ t: 'image', src, x, y, w, h });
    return this;
  }

  /* ----------------------------- композиции ---------------------------------- */

  /** Кружок с символом — сквозной мотив презентации. */
  badge({ x, y, d = 0.46, color, glyph, glyphColor = '0B0F16', size = 15 }) {
    this.circle({ x, y, d, color });
    this.text(glyph, {
      x, y, w: d, h: d, size, bold: true, color: glyphColor, align: 'center', valign: 'middle',
    });
    return this;
  }

  /** Карточка «кружок + заголовок + текст». */
  feature({ x, y, w, h, color, glyph, title, text, size = 12.5, glyphSize = 15 }) {
    this.card({ x, y, w, h });
    this.badge({ x: x + 0.28, y: y + 0.26, color, glyph, size: glyphSize });
    this.text(title, { x: x + 0.9, y: y + 0.26, w: w - 1.15, h: 0.46, size: 15, bold: true, valign: 'middle' });
    this.text(text, { x: x + 0.28, y: y + 0.86, w: w - 0.56, h: h - 1.05, size, color: C.muted, lineHeight: 1.28 });
    return this;
  }

  /** Крупная цифра с подписью. */
  stat({ x, y, w, value, label, color = C.accent, size = 34 }) {
    this.text(String(value), { x, y, w, h: 0.62, size, bold: true, color, align: 'center' });
    this.text(label, { x: x + 0.15, y: y + 0.66, w: w - 0.3, h: 0.5, size: 11, color: C.muted, align: 'center', lineHeight: 1.22 });
    return this;
  }

  /**
   * Маркированный список с равномерным ритмом: высота пункта считается по числу
   * строк, поэтому многострочные пункты не съедают зазор до следующего.
   */
  list(items, { x, y, w, size = 12.5, color = C.muted, spacing = 0.17 }) {
    let top = y;
    for (const item of items) {
      const perLine = Math.max(12, Math.floor(((w - 0.22) * 144) / (size * 1.08)));
      const lines = Math.max(1, Math.ceil(item.length / perLine));
      const height = (lines * size * 1.3) / 72;

      this.circle({ x, y: top + 0.085, d: 0.075, color: C.accent });
      this.text(item, { x: x + 0.22, y: top - 0.03, w: w - 0.22, h: height + 0.12, size, color, lineHeight: 1.3 });
      top += height + spacing;
    }
    return this;
  }

  note(text) {
    this.notes = text;
    return this;
  }
}

const slides = [];

/** Базовый слайд: фон, надзаголовок, заголовок. */
function slide({ kicker, title } = {}) {
  const s = new Slide(IMG('bg.png'));
  slides.push(s);

  if (kicker) {
    s.text(kicker.toUpperCase(), {
      x: M, y: 0.44, w: 10, h: 0.3, size: 11.5, bold: true, color: C.accent, charSpacing: 2.6,
    });
  }
  if (title) s.text(title, { x: M, y: 0.78, w: CONTENT, h: 0.66, size: 31, bold: true });
  return s;
}

/** Широкая плашка-вывод внизу слайда. */
function footnote(s, text, { y, h = 0.9, size = 12.5 }) {
  s.card({ x: M, y, w: CONTENT, h, fill: C.cardSoft });
  s.text(text, { x: M + 0.35, y, w: CONTENT - 0.7, h, size, valign: 'middle', lineHeight: 1.3 });
}

const caption = (s, text, y = 6.9) =>
  s.text(text, { x: M, y, w: CONTENT, h: 0.34, size: 10.5, italic: true, color: C.faint });

/* =============================== 1. Титул ==================================== */
{
  const s = new Slide(IMG('bg-title.png'));
  slides.push(s);

  s.text('ПРОИЗВОДСТВЕННАЯ СИСТЕМА · ВНУТРЕННИЙ ПРОДУКТ', {
    x: M, y: 1.4, w: 9, h: 0.32, size: 11.5, bold: true, color: C.accent, charSpacing: 2.6,
  });
  s.text('Система мониторинга\nсигналов', {
    x: M, y: 1.85, w: 8.6, h: 1.95, size: 44, bold: true, lineHeight: 1.06,
  });
  s.text(
    'Единое окно для проблем подрядчиков: фиксация обращений, контроль сроков, ' +
      'автоматическая эскалация и отчетность.',
    { x: M, y: 3.9, w: 7.3, h: 0.9, size: 15, color: C.muted, lineHeight: 1.35 },
  );

  const g = grid(4, 0.22);
  [
    { v: '48 ч', l: 'порог эскалации' },
    { v: '11', l: 'таблиц в базе' },
    { v: '26', l: 'методов API' },
    { v: '~7 900', l: 'строк кода' },
  ].forEach((item, i) => {
    const x = g.x(i);
    const w = i === 3 ? g.w : g.w;
    s.card({ x, y: 5.35, w, h: 1.24, fill: C.cardSoft });
    s.text(item.v, { x, y: 5.5, w, h: 0.5, size: 20, bold: true, color: C.accent, align: 'center' });
    s.text(item.l, { x, y: 6.02, w, h: 0.4, size: 10.5, color: C.muted, align: 'center' });
  });

  const ph = 4.1;
  s.image({ src: IMG('mobile.png'), x: CANVAS.w - M - ph * RATIO.phone, y: 1.05, w: ph * RATIO.phone, h: ph });
  s.note('Проект внедрен: работает на реальной почте mail.ru, есть видео-туториал и README.');
}

/* ============================ 2. Зачем система =============================== */
{
  const s = slide({ kicker: 'Задача', title: 'Что решает система' });
  const two = grid(2, 0.24);

  s.card({ x: two.x(0), y: 1.66, w: two.w, h: 2.06, fill: C.cardSoft });
  s.badge({ x: two.x(0) + 0.3, y: 1.92, color: C.red, glyph: '!', glyphColor: 'FFFFFF' });
  s.text('Было', { x: two.x(0) + 0.92, y: 1.92, w: 3, h: 0.46, size: 15, bold: true, valign: 'middle' });
  s.list(
    ['Проблемы теряются в чатах и звонках', 'Непонятно, кто отвечает и сколько ждет', 'Нет истории: кто, когда и что решил'],
    { x: two.x(0) + 0.32, y: 2.5, w: two.w - 0.64 },
  );

  s.card({ x: two.x(1), y: 1.66, w: two.w, h: 2.06 });
  s.badge({ x: two.x(1) + 0.3, y: 1.92, color: C.green, glyph: '✓' });
  s.text('Стало', { x: two.x(1) + 0.92, y: 1.92, w: 3, h: 0.46, size: 15, bold: true, valign: 'middle' });
  s.list(
    ['Обращение фиксируется за два шага, без регистрации', 'Срок контролирует система, а не человек', 'Каждое действие попадает в историю с автором'],
    { x: two.x(1) + 0.32, y: 2.5, w: two.w - 0.64 },
  );

  const three = grid(3, 0.24);
  [
    { c: C.yellow, g: '1', t: 'Прозрачность', d: 'Руководитель видит все обращения на одной карте и их возраст.' },
    { c: C.accent, g: '2', t: 'Скорость', d: 'Критичное поднимается автоматически и приходит письмом.' },
    { c: C.green, g: '3', t: 'Отчетность', d: 'Выгрузка в Excel с текущими фильтрами за пару секунд.' },
  ].forEach((e, i) => {
    s.feature({ x: three.x(i), y: 4.06, w: three.w, h: 1.92, color: e.c, glyph: e.g, title: e.t, text: e.d });
  });

  caption(s, 'Контроль сроков переложен с людей на систему.', 6.3);
  s.note('Ключевая мысль: контроль сроков переложен с людей на систему.');
}

/* ============================= 3. Процесс ==================================== */
{
  const s = slide({ kicker: 'Как это работает', title: 'Жизненный путь обращения' });
  const g = grid(5, 0.2);

  [
    { g: '1', c: C.accent, t: 'Создание', d: 'Подрядчик заполняет форму за два шага, прикладывает файлы.' },
    { g: '2', c: C.yellow, t: 'Ожидание', d: 'Сигнал получает Желтый статус, начинается отсчет 48 часов.' },
    { g: '3', c: C.red, t: 'Эскалация', d: 'Порог пройден — система сама поднимает до Красного.' },
    { g: '4', c: C.violet, t: 'Работа', d: 'Администраторы принимают в работу, правят, ведут историю.' },
    { g: '5', c: C.green, t: 'Закрытие', d: 'Решено или отклонено, данные уходят в отчет.' },
  ].forEach((step, i) => {
    const x = g.x(i);
    s.card({ x, y: 1.95, w: g.w, h: 2.5 });
    s.badge({ x: x + g.w / 2 - 0.25, y: 2.18, d: 0.5, color: step.c, glyph: step.g, size: 16 });
    s.text(step.t, { x, y: 2.8, w: g.w, h: 0.36, size: 14.5, bold: true, align: 'center' });
    s.text(step.d, { x: x + 0.16, y: 3.22, w: g.w - 0.32, h: 1.1, size: 11.5, color: C.muted, align: 'center', lineHeight: 1.28 });
    if (i < 4) {
      s.text('→', { x: x + g.w, y: 3.0, w: 0.2, h: 0.4, size: 15, bold: true, color: '46536A', align: 'center' });
    }
  });

  footnote(s, 'Отсчет ведет сервер, а не браузер: фоновый процесс работает, даже когда все вкладки закрыты.', {
    y: 4.75, h: 1.0, size: 14,
  });
  caption(s, 'Терминальные статусы — Зеленый и Серый — закрывают сигнал окончательно.', 6.05);
}

/* ============================== 4. Роли ====================================== */
{
  const s = slide({ kicker: 'Роли', title: 'Два типа пользователей' });
  const leftW = 5.9;
  const rightX = M + leftW + 0.28;
  const rightW = CONTENT - leftW - 0.28;

  s.card({ x: M, y: 1.66, w: leftW, h: 2.3 });
  s.badge({ x: M + 0.3, y: 1.92, color: C.teal, glyph: 'П' });
  s.text('Подрядчик', { x: M + 0.92, y: 1.92, w: 4, h: 0.46, size: 16, bold: true, valign: 'middle' });
  s.list(
    ['Без регистрации и пароля', 'Видит только свои обращения', 'Закрывает свой сигнал, правит пока он открыт'],
    { x: M + 0.32, y: 2.5, w: leftW - 0.64 },
  );

  s.card({ x: M, y: 4.18, w: leftW, h: 2.3 });
  s.badge({ x: M + 0.3, y: 4.44, color: C.accent, glyph: 'А' });
  s.text('Администратор', { x: M + 0.92, y: 4.44, w: 4, h: 0.46, size: 16, bold: true, valign: 'middle' });
  s.list(
    ['Вход по логину и паролю, почта подтверждается', 'Видит всю систему, принимает в работу, меняет статусы', 'Управляет учетными записями и своими уведомлениями'],
    { x: M + 0.32, y: 5.02, w: leftW - 0.64 },
  );

  s.image({ src: IMG('home.png'), x: rightX, y: 1.66, w: rightW, h: rightW / RATIO.shot });
  s.card({ x: rightX, y: 1.66 + rightW / RATIO.shot + 0.22, w: rightW, h: 1.32, fill: C.cardSoft });
  s.text(
    'Изоляция подрядчиков обеспечивается на сервере: чужие сигналы не попадают в ответ API, ' +
      'а прямой запрос по чужому идентификатору возвращает «не найдено».',
    { x: rightX + 0.32, y: 1.66 + rightW / RATIO.shot + 0.22, w: rightW - 0.64, h: 1.32, size: 12.5, valign: 'middle', lineHeight: 1.3 },
  );
}

/* =========================== 5. Виды сигналов ================================ */
{
  const s = slide({ kicker: 'Виды сигналов', title: 'Линии обращений' });
  const g = grid(4, 0.24);

  s.text(
    'Линия выбирается на первом шаге и определяет, кому адресован сигнал. Шаг можно пропустить — ' +
      'тогда обращение попадает в отдельную колонку.',
    { x: M, y: 1.56, w: CONTENT, h: 0.5, size: 13.5, color: C.muted, lineHeight: 1.3 },
  );

  [
    { c: C.indigo, g: 'Ю', t: 'Юридическая', d: 'Договоры, претензии, согласования, дополнительные соглашения.' },
    { c: C.teal, g: 'П', t: 'Поставка', d: 'Материалы, сроки поставки, логистика на объект.' },
    { c: C.violet, g: 'Пр', t: 'Проектирование', d: 'Чертежи, рабочая документация, изменения проекта.', fs: 12 },
    { c: C.gray, g: '—', t: 'Без линии', d: 'Шаг пропущен: сигнал виден всем и разбирается вручную.' },
  ].forEach((line, i) => {
    const x = g.x(i);
    s.card({ x, y: 2.24, w: g.w, h: 2.35 });
    s.badge({ x: x + 0.26, y: 2.48, d: 0.52, color: line.c, glyph: line.g, size: line.fs ?? 15 });
    s.text(line.t, { x: x + 0.26, y: 3.16, w: g.w - 0.5, h: 0.38, size: 15, bold: true });
    s.text(line.d, { x: x + 0.26, y: 3.58, w: g.w - 0.52, h: 0.9, size: 11.5, color: C.muted, lineHeight: 1.3 });
  });

  footnote(s, 'Линия — это маршрутизация и фильтр: на карте сигналов каждая линия отдельная колонка, ' +
    'а в настройках администратор подписывается только на нужные ему линии.', { y: 4.9, h: 1.15, size: 13.5 });
  caption(s, 'Виды сигналов и их статусы описаны в общем словаре, одном для сервера и браузера.', 6.3);
}

/* ============================== 6. Статусы =================================== */
{
  const s = slide({ kicker: 'Виды сигналов', title: 'Статусы и кто их ставит' });
  const leftW = 7.45;
  const rightX = M + leftW + 0.28;
  const rightW = CONTENT - leftW - 0.28;

  [
    { c: C.yellow, t: 'Желтый', n: 'Новая проблема', d: 'Ставится автоматически при создании. Вручную — никогда.' },
    { c: C.red, t: 'Красный', n: 'Критичная проблема', d: 'Автоматически через 48 часов либо вручную администратором.' },
    { c: C.green, t: 'Зеленый', n: 'Проблема решена', d: 'Автор сигнала или администратор. Терминальный статус.' },
    { c: C.gray, t: 'Серый', n: 'Отклонен', d: 'Только администратор. Терминальный статус.' },
  ].forEach((st, i) => {
    const y = 1.66 + i * 1.2;
    s.card({ x: M, y, w: leftW, h: 1.06 });
    s.circle({ x: M + 0.3, y: y + 0.38, d: 0.3, color: st.c });
    s.text(st.t, { x: M + 0.76, y: y + 0.12, w: 1.8, h: 0.4, size: 15, bold: true, color: st.c, valign: 'middle' });
    s.text(st.n, { x: M + 0.76, y: y + 0.52, w: 2.3, h: 0.34, size: 11, color: C.muted });
    s.text(st.d, { x: M + 3.16, y, w: leftW - 3.4, h: 1.06, size: 12, valign: 'middle', lineHeight: 1.28 });
  });

  s.card({ x: rightX, y: 1.66, w: rightW, h: 4.66, fill: C.cardSoft });
  s.text('Правила перехода', { x: rightX + 0.32, y: 1.9, w: rightW - 0.6, h: 0.4, size: 15, bold: true });
  s.list(
    [
      'Желтый ставится только при создании',
      'Из терминального статуса выхода нет',
      'Красный вручную доступен администратору',
      'Автоэскалацию в истории подписывает «Система»',
      'Правила действуют и в интерфейсе, и в API',
    ],
    { x: rightX + 0.34, y: 2.46, w: rightW - 0.66, size: 12, spacing: 0.3 },
  );

  caption(s, 'Запрет проверяется на сервере до записи в базу — обойти его прямым запросом нельзя.', 6.55);
}

/* =========================== 7. Автоэскалация ================================ */
{
  const s = slide({ kicker: 'Контроль сроков', title: 'Автоматическая эскалация' });
  const g = grid(3, 0.24);

  [
    { v: '48 ч', l: 'порог до Красного статуса', c: C.red },
    { v: '5 с', l: 'период опроса фонового процесса', c: C.yellow },
    { v: '0', l: 'зависимость от открытых вкладок', c: C.green },
  ].forEach((cell, i) => {
    s.card({ x: g.x(i), y: 1.72, w: g.w, h: 1.98 });
    s.stat({ x: g.x(i), y: 2.06, w: g.w, value: cell.v, label: cell.l, color: cell.c, size: 40 });
  });

  s.card({ x: M, y: 3.96, w: CONTENT, h: 2.42 });
  s.text('Как устроено', { x: M + 0.35, y: 4.16, w: 4, h: 0.38, size: 15, bold: true });
  s.list(
    [
      'Таймер живет на сервере: каждые пять секунд проверяет возраст всех Желтых сигналов',
      'Возраст считается от входа в Желтый статус, а не от «сейчас минус дата создания»',
      'Переход пишется в историю от имени Системы и запускает рассылку писем',
      'Для проверки без ожидания двух суток есть демо-кнопка: она сдвигает метки времени, статус ставит все равно процесс',
    ],
    { x: M + 0.37, y: 4.62, w: CONTENT - 0.74, size: 12.5, spacing: 0.18 },
  );

  caption(s, 'Ручной перевод в Красный доступен администратору и отличается в истории по автору события.', 6.55);
}

/* ============================ 8. Технический стек ============================ */
{
  const s = slide({ kicker: 'Технологии', title: 'Технический стек' });
  const g = grid(3, 0.24);

  [
    { c: C.accent, g: 'S', t: 'Сервер', d: 'Node.js 20, встроенный модуль http без веб-фреймворка: свой роутер, слой ошибок, отдача статики.' },
    { c: C.green, g: 'D', t: 'Хранилище', d: 'SQLite через node-sqlite3-wasm — настоящий SQL без нативной сборки. 11 таблиц, миграции при старте.' },
    { c: C.violet, g: 'C', t: 'Клиент', d: 'Нативные ES-модули без сборщика и фреймворка: свой роутер, компоненты и слой данных.' },
    { c: C.yellow, g: 'M', t: 'Почта', d: 'Nodemailer поверх SMTP mail.ru. HTML-шаблоны, журнал отправок, dev-инбокс для разработки.' },
    { c: C.teal, g: 'X', t: 'Отчеты', d: 'ExcelJS: файл .xlsx собирается на сервере из SQL-выборки с типизированными колонками.' },
    { c: C.coral, g: 'F', t: 'Файлы', d: 'Busboy разбирает multipart, вложения лежат на диске и отдаются по идентификатору.' },
  ].forEach((item, i) => {
    s.feature({
      x: g.x(i % 3), y: 1.66 + Math.floor(i / 3) * 2.34, w: g.w, h: 2.14,
      color: item.c, glyph: item.g, title: item.t, text: item.d, size: 11.5,
    });
  });

  caption(s, 'Всего четыре внешние зависимости. Сборка не требуется: клиент исполняется браузером напрямую.', 6.5);
}

/* ============================= 9. Архитектура ================================ */
{
  const s = slide({ kicker: 'Архитектура', title: 'Как разложен код' });
  const leftW = 7.85;
  const rightX = M + leftW + 0.28;
  const rightW = CONTENT - leftW - 0.28;

  [
    { t: 'Клиент · public/', d: 'Экраны, роутер, компоненты. Данные — только через слой api и снимок состояния.', c: C.violet },
    { t: 'Общий слой · shared/', d: 'Статусы, конечный автомат, правила валидации. Один и тот же файл исполняют сервер и браузер.', c: C.accent },
    { t: 'Сервер · server/', d: 'Маршруты, сервисы предметной области, почта, экспорт, фоновый процесс.', c: C.green },
    { t: 'Данные · SQLite', d: 'Схема, миграции и единственная точка доступа к базе через тонкий адаптер.', c: C.teal },
  ].forEach((layer, i) => {
    const y = 1.66 + i * 1.2;
    s.card({ x: M, y, w: leftW, h: 1.06 });
    s.circle({ x: M + 0.3, y: y + 0.38, d: 0.28, color: layer.c });
    s.text(layer.t, { x: M + 0.74, y: y + 0.1, w: 4.4, h: 0.36, size: 14, bold: true });
    s.text(layer.d, { x: M + 0.74, y: y + 0.46, w: leftW - 1.0, h: 0.54, size: 11.5, color: C.muted, lineHeight: 1.24 });
  });

  s.card({ x: rightX, y: 1.66, w: rightW, h: 4.66, fill: C.cardSoft });
  s.text('Почему так', { x: rightX + 0.32, y: 1.9, w: rightW - 0.6, h: 0.38, size: 15, bold: true });
  s.list(
    [
      'Правила статусов нельзя рассинхронизировать: файл физически один',
      'Замена хранилища затрагивает один файл-адаптер',
      'Нет сборки — правка видна после обновления страницы',
      'Каждый слой читается отдельно от остальных',
    ],
    { x: rightX + 0.34, y: 2.46, w: rightW - 0.66, size: 12, spacing: 0.34 },
  );

  caption(s, 'Общий слой исключает расхождение правил между сервером и интерфейсом.', 6.55);
}

/* ========================== 10. Модель данных ================================ */
{
  const s = slide({ kicker: 'Данные', title: 'Модель данных: 11 таблиц' });
  const g = grid(4, 0.22);

  [
    ['users', 'подрядчики и администраторы'],
    ['signals', 'сигналы'],
    ['signal_history', 'события по сигналам'],
    ['tasks', 'задачи'],
    ['task_history', 'события по задачам'],
    ['assignments', 'исполнители'],
    ['files', 'вложения'],
    ['attachments', 'связь файлов с сущностью'],
    ['sessions', 'сессии администраторов'],
    ['email_tokens', 'токены подтверждения почты'],
    ['mail_log', 'журнал отправленных писем'],
  ].forEach(([name, note], i) => {
    const x = g.x(i % 4);
    const y = 1.66 + Math.floor(i / 4) * 1.24;
    s.card({ x, y, w: g.w, h: 1.06, fill: C.cardSoft });
    s.text(name, { x: x + 0.24, y: y + 0.16, w: g.w - 0.4, h: 0.34, size: 12.5, bold: true, color: C.accent, font: MONO });
    s.text(note, { x: x + 0.24, y: y + 0.52, w: g.w - 0.44, h: 0.44, size: 10.5, color: C.muted, lineHeight: 1.22 });
  });

  footnote(s, 'История хранится событиями, а не полями: каждое действие — отдельная запись с автором и временем. ' +
    'Схема создается и мигрирует при старте сервера, отдельный шаг развертывания не нужен.', { y: 5.4, h: 1.05 });
}

/* ==================== 11. Аккаунт по устройству ============================== */
{
  const s = slide({ kicker: 'Ключевой механизм', title: 'Присваивание аккаунта по устройству' });
  const g = grid(4, 0.24);

  s.text('Подрядчик не регистрируется — личность определяется устройством, с которого он обращается.', {
    x: M, y: 1.54, w: CONTENT, h: 0.4, size: 14, color: C.muted,
  });

  [
    { g: '1', t: 'Первый заход', d: 'Сервер не находит куку устройства и выдает новый идентификатор вида ctr_…' },
    { g: '2', t: 'Кука', d: 'Идентификатор кладется в куку sms_device на год: SameSite=Lax, путь «/».' },
    { g: '3', t: 'Ленивая запись', d: 'Строка в таблице users создается при первом реальном действии — создании сигнала.' },
    { g: '4', t: 'Изоляция', d: 'Все выборки подрядчика идут по его идентификатору автора: чужого он не увидит.' },
  ].forEach((step, i) => {
    const x = g.x(i);
    s.card({ x, y: 2.14, w: g.w, h: 2.42 });
    s.badge({ x: x + 0.26, y: 2.38, d: 0.5, color: C.accent, glyph: step.g, size: 16 });
    s.text(step.t, { x: x + 0.26, y: 3.0, w: g.w - 0.5, h: 0.36, size: 14, bold: true });
    s.text(step.d, { x: x + 0.26, y: 3.42, w: g.w - 0.52, h: 1.0, size: 11.5, color: C.muted, lineHeight: 1.3 });
  });

  s.card({ x: M, y: 4.86, w: CONTENT, h: 1.5, fill: C.cardSoft });
  s.text('Что это значит на практике', { x: M + 0.35, y: 5.0, w: 5, h: 0.3, size: 13, bold: true });
  s.text(
    'Порог входа нулевой: подрядчик открывает ссылку и сразу заводит сигнал. Обратная сторона — ' +
      'очистка кук создает нового подрядчика, поэтому механизм годится для обращений, но не для ' +
      'юридически значимой идентификации.',
    { x: M + 0.35, y: 5.36, w: CONTENT - 0.7, h: 0.9, size: 12, color: C.muted, lineHeight: 1.3 },
  );
}

/* ===================== 12. Доступ администраторов ============================ */
{
  const s = slide({ kicker: 'Доступ', title: 'Учетные записи администраторов' });
  const g = grid(2, 0.24);

  [
    { c: C.accent, g: '1', t: 'Пароль', d: 'Хранится как scrypt-хеш с индивидуальной солью, сравнение в постоянном времени.' },
    { c: C.yellow, g: '2', t: 'Подтверждение почты', d: 'Одноразовый токен со сроком 24 часа. До перехода по ссылке панель управления закрыта.' },
    { c: C.green, g: '3', t: 'Сессия', d: 'Токен в куке HttpOnly на 7 дней, хранится в базе, протухшие чистятся при старте.' },
    { c: C.violet, g: '4', t: 'Проверка прав', d: 'Каждый серверный маршрут самостоятельно проверяет роль и подтверждение почты.' },
  ].forEach((b, i) => {
    s.feature({
      x: g.x(i % 2), y: 1.66 + Math.floor(i / 2) * 2.2, w: g.w, h: 2.0,
      color: b.c, glyph: b.g, title: b.t, text: b.d,
    });
  });

  footnote(s, 'Пароли в открытом виде не хранятся и не логируются. Секреты почты вынесены в файл .env вне репозитория.', {
    y: 6.12, h: 0.86,
  });
}

/* ============================ 13. Почта ====================================== */
{
  const s = slide({ kicker: 'Интеграции', title: 'Технологии отправки писем' });
  const g = grid(2, 0.24);

  [
    { c: C.accent, g: 'N', t: 'Nodemailer', d: 'Сборка и отправка MIME-сообщений, таймауты на соединение, приветствие и сокет.' },
    { c: C.green, g: 'S', t: 'SMTP mail.ru', d: 'Узел smtp.mail.ru, порт 465, SSL. Авторизация паролем для внешних приложений.' },
    { c: C.yellow, g: 'H', t: 'HTML-шаблоны', d: 'Табличная верстка с инлайновыми стилями: почтовые клиенты не понимают внешний CSS.' },
    { c: C.violet, g: 'L', t: 'Журнал и dev-инбокс', d: 'Каждое письмо пишется в mail_log. Без SMTP письма падают в локальный инбокс.' },
  ].forEach((item, i) => {
    s.feature({
      x: g.x(i % 2), y: 1.66 + Math.floor(i / 2) * 2.2, w: g.w, h: 2.0,
      color: item.c, glyph: item.g, title: item.t, text: item.d,
    });
  });

  footnote(s, 'Переключение между реальной отправкой и локальным режимом — одна переменная окружения. ' +
    'При старте сервер проверяет авторизацию на SMTP и печатает результат, ничего не отправляя.', { y: 6.12, h: 0.86 });
}

/* ====================== 14. Кому уходит письмо =============================== */
{
  const s = slide({ kicker: 'Уведомления', title: 'Кому уходит письмо' });
  const leftW = 7.45;
  const rightX = M + leftW + 0.28;
  const rightW = CONTENT - leftW - 0.28;

  s.text('Рассылку запускает конечный автомат: переход статуса превращается в событие, а не наоборот.', {
    x: M, y: 1.54, w: CONTENT, h: 0.4, size: 14, color: C.muted,
  });

  [
    'Почта администратора подтверждена',
    'Уведомления включены в его профиле',
    'Линия сигнала входит в список его линий',
    'Включен флаг именно этого события',
  ].forEach((text, i) => {
    const y = 2.16 + i * 0.94;
    s.card({ x: M, y, w: leftW, h: 0.78, fill: i === 3 ? C.card : C.cardSoft });
    s.badge({ x: M + 0.24, y: y + 0.16, d: 0.46, color: C.accent, glyph: String(i + 1) });
    s.text(text, { x: M + 0.86, y, w: leftW - 1.15, h: 0.78, size: 13, valign: 'middle' });
  });

  s.card({ x: rightX, y: 2.16, w: rightW, h: 3.56 });
  s.text('Три события', { x: rightX + 0.32, y: 2.4, w: rightW - 0.6, h: 0.38, size: 15, bold: true });
  s.list(['Создание сигнала', 'Переход в Красный статус', 'Решение или отклонение'], {
    x: rightX + 0.34, y: 2.92, w: rightW - 0.66, size: 12.5, spacing: 0.2,
  });
  s.text('В письме: идентификатор, статус, линия, дата, автор перехода, описание и прямая ссылка на карточку.', {
    x: rightX + 0.32, y: 4.42, w: rightW - 0.62, h: 1.1, size: 11.5, color: C.muted, lineHeight: 1.3,
  });

  footnote(s, 'Все четыре условия должны совпасть одновременно. Задачи писем не рассылают: модуль отвязан от почты и таймеров.', {
    y: 6.02, h: 0.9,
  });
}

/* ==================== 15. Исполнители и история =============================== */
{
  const s = slide({ kicker: 'Работа с обращением', title: 'Исполнители и история событий' });
  const shotW = 6.3;
  const rightX = M + shotW + 0.28;
  const rightW = CONTENT - shotW - 0.28;

  s.image({ src: IMG('signal.png'), x: M, y: 1.66, w: shotW, h: shotW / RATIO.shot });

  s.feature({
    x: rightX, y: 1.66, w: rightW, h: 1.66, color: C.accent, glyph: '◗',
    title: 'Несколько исполнителей',
    text: 'Сигнал или задачу могут вести несколько администраторов. В списке видны фамилия с инициалами и дата принятия.',
    size: 12,
  });
  s.feature({
    x: rightX, y: 3.48, w: rightW, h: 1.62, color: C.violet, glyph: 'И',
    title: 'История событий',
    text: 'Создание, смена статуса, редактирование, принятие и снятие исполнителя — каждое с автором и временем.',
    size: 12,
  });

  footnote(s, 'У правок видно, что именно изменилось: старое значение зачеркнуто, новое рядом. ' +
    'Автоэскалацию подписывает «Система», ручной перевод — конкретный администратор.', { y: 5.32, h: 1.05 });
}

/* ======================= 16. Задачи, файлы, экспорт =========================== */
{
  const s = slide({ kicker: 'Модули', title: 'Задачи, вложения и отчетность' });
  const leftW = 6.0;
  const rightX = M + leftW + 0.28;
  const rightW = CONTENT - leftW - 0.28;

  s.image({ src: IMG('tasks.png'), x: rightX, y: 1.66, w: rightW, h: rightW / RATIO.shot });

  [
    { c: C.teal, g: 'З', t: 'Задачи', d: 'Отдельный раздел без таймеров и писем: канбан, статусы вручную, своя история.' },
    { c: C.yellow, g: 'Ф', t: 'Вложения', d: 'Drag-and-drop, до 15 МБ, форматы проверяются и на клиенте, и на сервере.' },
    { c: C.green, g: 'X', t: 'Экспорт в Excel', d: 'Сервер собирает .xlsx из SQL с текущими фильтрами: даты остаются датами.' },
  ].forEach((c0, i) => {
    s.feature({
      x: M, y: 1.66 + i * 1.62, w: leftW, h: 1.48,
      color: c0.c, glyph: c0.g, title: c0.t, text: c0.d, size: 11.5,
    });
  });

  s.card({ x: rightX, y: 1.66 + rightW / RATIO.shot + 0.22, w: rightW, h: 1.28, fill: C.cardSoft });
  s.text('Видимость модуля задач включается тумблером в профиле администратора: при выключении раздел исчезает из меню.', {
    x: rightX + 0.32, y: 1.66 + rightW / RATIO.shot + 0.22, w: rightW - 0.64, h: 1.28, size: 12, valign: 'middle', lineHeight: 1.3,
  });
}

/* ==================== 17. Live-режим и мобильная ============================== */
{
  const s = slide({ kicker: 'Интерфейс', title: 'Реальное время и работа с телефона' });
  const leftW = 6.2;
  const phoneH = 4.6;
  const phoneW = phoneH * RATIO.phone;
  const statsW = CONTENT - leftW - phoneW - 0.56;

  s.feature({
    x: M, y: 1.66, w: leftW, h: 2.24, color: C.accent, glyph: '⟳',
    title: 'Живое обновление',
    text: 'Сервер публикует изменения в поток SSE, клиент сразу перечитывает состояние. Новые сигналы и смены статуса видны всем без перезагрузки, в том числе на других устройствах.',
    size: 12,
  });
  s.feature({
    x: M, y: 4.12, w: leftW, h: 2.24, color: C.green, glyph: '☏',
    title: 'Мобильная версия',
    text: 'Шапка сворачивается в меню, таблицы превращаются в карточки, фильтры — в ленты. Цели нажатия не меньше 44 пикселей, поля не вызывают зум на iOS.',
    size: 12,
  });

  const phoneX = M + leftW + 0.28;
  s.image({ src: IMG('mobile.png'), x: phoneX, y: 1.66, w: phoneW, h: phoneH });

  const statsX = phoneX + phoneW + 0.28;
  s.card({ x: statsX, y: 1.66, w: statsW, h: 2.24, fill: C.cardSoft });
  s.stat({ x: statsX, y: 2.1, w: statsW, value: '0', label: 'горизонтальной прокрутки на телефоне', color: C.green, size: 34 });

  s.card({ x: statsX, y: 4.12, w: statsW, h: 2.24, fill: C.cardSoft });
  s.stat({ x: statsX, y: 4.56, w: statsW, value: '183→65', label: 'высота шапки на телефоне, пикселей', color: C.accent, size: 26 });
}

/* ====================== 18. Надежность и качество ============================= */
{
  const s = slide({ kicker: 'Качество', title: 'Надежность и защита данных' });
  const g = grid(3, 0.24);

  [
    { c: C.green, g: '✓', t: 'Проверки на сервере', d: 'Права и правила статусов проверяются до записи в базу, а не только в интерфейсе.' },
    { c: C.accent, g: '✓', t: 'Транзакции', d: 'Сигнал, история и вложения пишутся одной транзакцией: частичных записей не бывает.' },
    { c: C.yellow, g: '✓', t: 'Валидация файлов', d: 'Формат и размер проверяются дважды, тип берется по расширению, а не из заголовка.' },
    { c: C.violet, g: '✓', t: 'Миграции', d: 'Схема догоняется при старте: обновление версии не требует ручных операций с базой.' },
    { c: C.teal, g: '✓', t: 'Диагностика загрузки', d: 'Если клиентский модуль не загрузился, страница сама сообщает, какого файла не хватает.' },
    { c: C.coral, g: '✓', t: 'Секреты вне кода', d: 'Пароли почты только в .env, файл исключен из репозитория.' },
  ].forEach((item, i) => {
    s.feature({
      x: g.x(i % 3), y: 1.66 + Math.floor(i / 3) * 2.34, w: g.w, h: 2.14,
      color: item.c, glyph: item.g, title: item.t, text: item.d, size: 11.5,
    });
  });

  caption(s, 'Каждый сценарий проверен вживую в браузере: интерфейс, права, почта, экспорт и мобильная верстка.', 6.5);
}

/* ========================= 19. Эксплуатация ================================== */
{
  const s = slide({ kicker: 'Эксплуатация', title: 'Запуск и сопровождение' });
  const two = grid(2, 0.24);

  s.card({ x: two.x(0), y: 1.66, w: two.w, h: 2.34 });
  s.text('Запуск', { x: two.x(0) + 0.32, y: 1.88, w: 4, h: 0.38, size: 15, bold: true });
  s.text('npm install\nnpm start', {
    x: two.x(0) + 0.32, y: 2.34, w: two.w - 0.64, h: 0.86, size: 14, color: C.accent, font: MONO, lineHeight: 1.4,
  });
  s.text('База, каталоги вложений и писем создаются автоматически при первом запуске.', {
    x: two.x(0) + 0.32, y: 3.24, w: two.w - 0.64, h: 0.62, size: 12, color: C.muted, lineHeight: 1.3,
  });

  s.card({ x: two.x(1), y: 1.66, w: two.w, h: 2.34 });
  s.text('Настройки окружения', { x: two.x(1) + 0.32, y: 1.88, w: 4.4, h: 0.38, size: 15, bold: true });
  s.list(
    ['SMTP_HOST, SMTP_USER, SMTP_PASS — почта', 'APP_URL — адрес в ссылках писем', 'PORT, DATA_DIR — порт и каталог данных'],
    { x: two.x(1) + 0.34, y: 2.4, w: two.w - 0.68, size: 12, spacing: 0.2 },
  );

  const three = grid(3, 0.24);
  [
    { t: 'Резервная копия', d: 'Достаточно скопировать каталог data: база, вложения и письма лежат вместе.' },
    { t: 'Обновление', d: 'Забрать изменения и перезапустить — миграции применятся сами.' },
    { t: 'Документация', d: 'README с описанием слоев и видео-туториал на четыре минуты.' },
  ].forEach((op, i) => {
    s.card({ x: three.x(i), y: 4.22, w: three.w, h: 1.8, fill: C.cardSoft });
    s.text(op.t, { x: three.x(i) + 0.28, y: 4.44, w: three.w - 0.56, h: 0.34, size: 13.5, bold: true });
    s.text(op.d, { x: three.x(i) + 0.28, y: 4.82, w: three.w - 0.56, h: 1.0, size: 11.5, color: C.muted, lineHeight: 1.3 });
  });

  caption(s, 'Приложение не требует сборки: обновление сводится к перезапуску процесса.', 6.25);
}

/* =========================== 20. Метрики ===================================== */
{
  const s = slide({ kicker: 'Итоги разработки', title: 'Проект в цифрах' });
  const g = grid(4, 0.24);

  [
    { v: '~7 900', l: 'строк кода', c: C.accent },
    { v: '48', l: 'модулей', c: C.violet },
    { v: '11', l: 'таблиц в базе', c: C.green },
    { v: '26', l: 'методов API', c: C.yellow },
    { v: '4', l: 'внешние зависимости', c: C.teal },
    { v: '2', l: 'роли пользователей', c: C.coral },
    { v: '4', l: 'статуса сигнала', c: C.red },
    { v: '55', l: 'сцен в видео-туториале', c: C.gray },
  ].forEach((st, i) => {
    const x = g.x(i % 4);
    const y = 1.72 + Math.floor(i / 4) * 2.1;
    s.card({ x, y, w: g.w, h: 1.86 });
    s.stat({ x, y: y + 0.32, w: g.w, value: st.v, label: st.l, color: st.c, size: 29 });
  });

  footnote(s, 'Функционал реализован и проверен полностью: создание, эскалация, исполнители, правки, задачи, почта, экспорт и мобильная версия.', {
    y: 6.06, h: 0.9,
  });
}

/* ====================== 21. Ограничения и развитие ============================ */
{
  const s = slide({ kicker: 'Честно', title: 'Ограничения и что дальше' });
  const g = grid(2, 0.24);

  s.card({ x: g.x(0), y: 1.66, w: g.w, h: 4.5 });
  s.badge({ x: g.x(0) + 0.3, y: 1.92, color: C.yellow, glyph: '!' });
  s.text('Ограничения текущей версии', { x: g.x(0) + 0.92, y: 1.92, w: 4.8, h: 0.46, size: 15, bold: true, valign: 'middle' });
  s.list(
    [
      'Личность подрядчика привязана к куке: очистка браузера создает нового',
      'SQLite рассчитан на десятки одновременных пользователей, не на сотни',
      'Ссылка подтверждения почты сразу открывает сессию — это компромисс',
      'Вложения нельзя удалить или заменить после создания',
      'Внутри администраторов нет ролей: права у всех одинаковые',
    ],
    { x: g.x(0) + 0.32, y: 2.54, w: g.w - 0.64, size: 12, spacing: 0.26 },
  );

  s.card({ x: g.x(1), y: 1.66, w: g.w, h: 4.5 });
  s.badge({ x: g.x(1) + 0.3, y: 1.92, color: C.green, glyph: '→' });
  s.text('Возможное развитие', { x: g.x(1) + 0.92, y: 1.92, w: 4.6, h: 0.46, size: 15, bold: true, valign: 'middle' });
  s.list(
    [
      'Учетные записи подрядчиков с телефоном вместо куки',
      'Переезд на PostgreSQL — затрагивает один файл-адаптер',
      'Уведомления в мессенджер в дополнение к почте',
      'Отчет по срокам: сколько сигналов доходит до Красного',
      'Разграничение прав администраторов по линиям',
    ],
    { x: g.x(1) + 0.32, y: 2.54, w: g.w - 0.64, size: 12, spacing: 0.26 },
  );

  caption(s, 'Каждое ограничение — осознанное решение с известной ценой, а не недосмотр.', 6.4);
}

/* ============================== 22. Финал ==================================== */
{
  const s = new Slide(IMG('bg-title.png'));
  slides.push(s);

  s.text('ИТОГ', { x: M, y: 1.85, w: 6, h: 0.32, size: 11.5, bold: true, color: C.accent, charSpacing: 2.6 });
  s.text('Система работает\nи готова к эксплуатации', {
    x: M, y: 2.28, w: 8.0, h: 1.7, size: 34, bold: true, lineHeight: 1.1,
  });
  s.text(
    'Обращения фиксируются, сроки контролирует сервер, уведомления уходят реальной почтой, ' +
      'отчетность выгружается в один клик. Интерфейс работает и на компьютере, и на телефоне.',
    { x: M, y: 4.02, w: 7.4, h: 1.1, size: 14.5, color: C.muted, lineHeight: 1.35 },
  );

  const g = grid(3, 0.24);
  [
    { v: 'README', l: 'описание архитектуры и решений' },
    { v: '4 минуты', l: 'видео-туториал по всем функциям' },
    { v: 'mail.ru', l: 'рабочая почта, проверена отправкой' },
  ].forEach((f, i) => {
    s.card({ x: g.x(i), y: 5.3, w: g.w, h: 1.3, fill: C.cardSoft });
    s.text(f.v, { x: g.x(i) + 0.3, y: 5.5, w: g.w - 0.6, h: 0.46, size: 19, bold: true, color: C.accent });
    s.text(f.l, { x: g.x(i) + 0.3, y: 6.0, w: g.w - 0.6, h: 0.42, size: 11.5, color: C.muted, lineHeight: 1.25 });
  });
}

export { slides };
