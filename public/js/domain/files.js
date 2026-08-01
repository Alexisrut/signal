/**
 * Клиентская часть файловой подсистемы: валидация до отправки и асинхронная загрузка.
 * Те же правила продублированы на сервере — клиенту доверять нельзя.
 */

import { api } from '../data/api.js';
import { MAX_FILE_SIZE, ALLOWED_EXTENSIONS, isAllowedFilename, formatBytes } from '/shared/constants.js';

export const acceptAttribute = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const limitsHint = `Допустимые форматы: ${ALLOWED_EXTENSIONS.join(', ')}. Максимум ${formatBytes(MAX_FILE_SIZE)} на файл.`;

/**
 * Делит выбранные файлы на принятые и отклоненные с причиной отказа.
 * @returns {{accepted: File[], rejected: {name: string, reason: string}[]}}
 */
export function validateFiles(fileList) {
  const accepted = [];
  const rejected = [];

  for (const file of Array.from(fileList ?? [])) {
    if (!isAllowedFilename(file.name)) {
      rejected.push({ name: file.name, reason: 'недопустимый формат' });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      rejected.push({ name: file.name, reason: `больше ${formatBytes(MAX_FILE_SIZE)}` });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'пустой файл' });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** Загружает файлы на сервер и возвращает записи с идентификаторами и URL. */
export async function upload(files) {
  if (!files.length) return [];
  return api.uploadFiles(files);
}
