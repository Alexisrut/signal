/**
 * Экспорт в Excel: файл формируется сервером, клиент перехватывает Blob
 * и инициирует скачивание средствами браузера.
 */

import { api, ApiError } from '../data/api.js';

/** Имя файла берем из Content-Disposition (RFC 5987), иначе — запасное. */
function filenameFrom(disposition, fallback) {
  if (!disposition) return fallback;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) return decodeURIComponent(utf8[1]);

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

/**
 * @param {'signals'} kind
 * @param {Record<string, string>} params активные фильтры дашборда
 * @returns {Promise<{filename: string, rows: number}>}
 */
export async function downloadReport(kind, params = {}) {
  const response = await fetch(api.exportUrl(kind, params), { credentials: 'same-origin' });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload?.error ?? 'Не удалось сформировать отчет');
  }

  const blob = await response.blob();
  const filename = filenameFrom(response.headers.get('content-disposition'), `${kind}.xlsx`);
  const rows = Number(response.headers.get('x-report-rows')) || 0;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Освобождаем объектный URL после того, как браузер забрал файл.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { filename, rows };
}
