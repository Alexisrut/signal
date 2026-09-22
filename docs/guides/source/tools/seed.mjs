/**
 * Наполняет чистую базу демо-данными через API и снимает экраны под каждой ролью.
 * Запуск: node /home/claude/tools/seed-and-shoot.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
import path from 'node:path';

const BASE = 'http://127.0.0.1:5175';
const OUT = path.join(HERE, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const USERS = {
  superadmin: { login: 'admin', password: 'admin123' },
  admin: { login: 'petrov', password: 'petrov123', displayName: 'Петров Сергей Иванович', email: 'petrov@vis.ru', role: 'admin', categories: ['design', 'supply'] },
  manager1: { login: 'sidorova', password: 'sidorova123', displayName: 'Сидорова Анна Викторовна', email: 'sidorova@vis.ru', role: 'manager', categories: ['design'] },
  manager2: { login: 'kuznetsov', password: 'kuznetsov123', displayName: 'Кузнецов Дмитрий Олегович', email: 'kuznetsov@vis.ru', role: 'manager', categories: ['supply', 'other'] },
  c1: { companyName: 'ООО «СтройМонтаж»', fullName: 'Иванов Иван Сергеевич', email: 'ivanov@stroymontazh.ru', password: 'stroy123' },
  c2: { companyName: 'АО «ЭнергоСеть»', fullName: 'Смирнова Ольга Петровна', email: 'smirnova@energoset.ru', password: 'energo123' },
};

const browser = await chromium.launch();

async function ctxFor(login, password, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', ...opts });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { login, password } });
  if (!r.ok()) throw new Error(`login ${login}: ${r.status()} ${await r.text()}`);
  return ctx;
}

async function api(ctx, method, url, data) {
  const r = await ctx.request.fetch(`${BASE}${url}`, { method, data });
  const text = await r.text();
  if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}

/* ------------------------------------ посев ------------------------------------ */

const sa = await ctxFor(USERS.superadmin.login, USERS.superadmin.password);

for (const key of ['admin', 'manager1', 'manager2']) {
  const u = USERS[key];
  await api(sa, 'POST', '/api/admins', { ...u, password2: u.password });
  console.log('created', u.login);
}

async function registerContractor(u) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  const r = await ctx.request.post(`${BASE}/api/auth/register`, { data: { ...u, password2: u.password } });
  if (!r.ok()) throw new Error(`register ${u.companyName}: ${r.status()} ${await r.text()}`);
  console.log('registered', u.companyName);
  return ctx;
}

const c1 = await registerContractor(USERS.c1);
const c2 = await registerContractor(USERS.c2);
const adm = await ctxFor(USERS.admin.login, USERS.admin.password);
const m1 = await ctxFor(USERS.manager1.login, USERS.manager1.password);
const m2 = await ctxFor(USERS.manager2.login, USERS.manager2.password);

// Вложения: реальные файлы для формы.
const pdfPath = HERE + '/fixtures/акт-осмотра.pdf';
const pngPath = HERE + '/fixtures/фото-протечки.png';
const xlsxPath = HERE + '/fixtures/спецификация.xlsx';

async function uploadFiles(ctx, files) {
  const multipart = {};
  files.forEach((f, i) => {
    multipart[`file${i}`] = { name: path.basename(f), mimeType: 'application/octet-stream', buffer: fs.readFileSync(f) };
  });
  const r = await ctx.request.post(`${BASE}/api/files`, { multipart });
  if (!r.ok()) throw new Error(`upload: ${r.status()} ${await r.text()}`);
  return (await r.json()).files.map((f) => f.id);
}

async function createSignal(ctx, sector, description, files = []) {
  const fileIds = files.length ? await uploadFiles(ctx, files) : [];
  const res = await api(ctx, 'POST', '/api/signals', { sector, description, fileIds });
  console.log('signal', res.signal.id, sector);
  return res.signal.id;
}

const s1 = await createSignal(c1, 'Блок Б, 3 этаж', 'Отсутствует проектная документация на монтаж вентиляции — бригада не может продолжать работы без утвержденных чертежей.', [pdfPath]);
const s2 = await createSignal(c1, 'Блок А, кровля', 'Задержка поставки кровельных материалов уже на 5 дней, бригада из 8 человек простаивает.');
const s3 = await createSignal(c2, 'Подстанция №2', 'Не согласован акт выполненных работ за август, из-за этого задерживается оплата подрядчику.', [xlsxPath]);
const s4 = await createSignal(c2, 'Блок В, подвал', 'Протечка в помещении щитовой после дождя, вода на полу рядом с оборудованием. Требуется срочный осмотр.', [pngPath]);
const s5 = await createSignal(c1, 'Блок Б, 2 этаж', 'Нет доступа к помещению 214 — дверь заперта, ключи у другого подрядчика, работы по разводке остановлены.');
const s6 = await createSignal(c2, 'Территория, КПП-1', 'Шлагбаум на въезде не работает второй день, техника с материалами не может заехать на объект.');
const s7 = await createSignal(c1, 'Блок А, 1 этаж', 'Расхождение в спецификации на дверные блоки: 12 позиций не совпадают с проектом по размерам.', [xlsxPath, pdfPath]);
const s8 = await createSignal(adm, 'Склад №3', 'Повреждена упаковка партии кабеля ВВГнг при разгрузке, часть бухт со следами влаги.');

const ids = (ctx) => api(ctx, 'GET', '/api/state').then((s) => s.assignables);
const assignables = await ids(sa);
const idOf = (login) => assignables.find((a) => a.displayName === USERS[login].displayName).id;

// Распределение главным администратором
await api(sa, 'POST', `/api/signals/${s1}/category`, { category: 'design', assignees: [idOf('manager1')], note: 'Срочно запросить чертежи у проектного отдела, срок — до конца недели.' });
await api(sa, 'POST', `/api/signals/${s2}/category`, { category: 'supply', assignees: [idOf('manager2')], note: 'Связаться с поставщиком, уточнить дату отгрузки.' });
await api(sa, 'POST', `/api/signals/${s3}/category`, { category: 'admin_finance' });
await api(sa, 'POST', `/api/signals/${s4}/category`, { category: 'other', assignees: [idOf('manager2')] });
await api(sa, 'POST', `/api/signals/${s5}/category`, { category: 'design' });
await api(sa, 'POST', `/api/signals/${s8}/category`, { category: 'supply', assignees: [idOf('manager2')], note: 'Проверить условия хранения на складе.' });
// s6, s7 остаются нераспределенными

// Статусы
await api(sa, 'POST', `/api/signals/${s3}/status`, { status: 'green' });           // решен главным админом
await api(sa, 'POST', `/api/signals/${s4}/status`, { status: 'gray' });            // отклонен
await api(c1, 'POST', `/api/signals/${s5}/status`, { status: 'green' });           // автор сам закрыл
await api(adm, 'POST', `/api/signals/${s8}/status`, { status: 'red' });            // ручная эскалация админом
// Правка карточки администратором
await api(adm, 'PUT', `/api/signals/${s1}`, { contractorName: 'ООО «СтройМонтаж»', sector: 'Блок Б, 3 этаж, помещение 305', description: 'Отсутствует проектная документация на монтаж вентиляции — бригада не может продолжать работы без утвержденных чертежей.' });

fs.writeFileSync(path.join(HERE, 'seed-ids.json'), JSON.stringify({ s1, s2, s3, s4, s5, s6, s7, s8 }, null, 2));
console.log('SEED DONE');
await browser.close();
