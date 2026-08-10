/**
 * Экспорт в Excel: GET-запрос → SQL-выборка → буфер .xlsx → attachment.
 * Клиент перехватывает Blob и инициирует скачивание средствами браузера.
 */

import { forbidden, contentDisposition } from '../http.js';
import { isVerifiedAdmin } from '../identity.js';
import { buildSignalsWorkbook, reportFilename } from '../domain/export.js';

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
    category: url.searchParams.get('category') ?? 'all',
    status: url.searchParams.get('status') ?? 'all',
    assignment: url.searchParams.get('assignment') ?? 'all',
  };

  const { buffer, rows } = await buildSignalsWorkbook(filters, actor);
  console.info(`[export] сигналы: ${rows} строк, фильтры ${JSON.stringify(filters)}`);
  sendWorkbook(res, buffer, reportFilename('signals'), rows);
}
