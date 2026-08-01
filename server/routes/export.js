/**
 * Экспорт в Excel: GET-запрос → SQL-выборка → буфер .xlsx → attachment.
 * Клиент перехватывает Blob и инициирует скачивание средствами браузера.
 */

import { forbidden, contentDisposition } from '../http.js';
import { isVerifiedAdmin } from '../identity.js';
import { buildSignalsWorkbook, buildTasksWorkbook, reportFilename } from '../domain/export.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendWorkbook(res, buffer, filename, rows) {
  res.writeHead(200, {
    'Content-Type': XLSX_MIME,
    'Content-Length': buffer.length,
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'no-store',
    'X-Report-Rows': String(rows),
  });
  res.end(buffer);
}

export async function exportSignals(req, res, { actor, url }) {
  if (!isVerifiedAdmin(actor)) throw forbidden('Экспорт доступен только администратору');

  const filters = {
    line: url.searchParams.get('line') ?? 'all',
    status: url.searchParams.get('status') ?? 'all',
  };

  const { buffer, rows } = await buildSignalsWorkbook(filters);
  console.info(`[export] сигналы: ${rows} строк, фильтры ${JSON.stringify(filters)}`);
  sendWorkbook(res, buffer, reportFilename('signals'), rows);
}

export async function exportTasks(req, res, { actor, url }) {
  if (!isVerifiedAdmin(actor)) throw forbidden('Экспорт доступен только администратору');
  if (!actor.settings.tasksDashboardEnabled) throw forbidden('Дашборд задач отключен в настройках профиля');

  const filters = { status: url.searchParams.get('status') ?? 'all' };

  const { buffer, rows } = await buildTasksWorkbook(filters);
  console.info(`[export] задачи: ${rows} строк, фильтры ${JSON.stringify(filters)}`);
  sendWorkbook(res, buffer, reportFilename('tasks'), rows);
}
