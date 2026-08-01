/** Файловая подсистема: запись о файле, привязка к сущности, выборка вложений. */

import fs from 'node:fs';
import path from 'node:path';

import { sql } from '../db.js';
import { uid } from '../crypto.js';
import { UPLOADS_DIR } from '../config.js';
import { badRequest, notFound } from '../http.js';
import { MAX_FILE_SIZE, extensionOf, isAllowedFilename, mimeForFilename } from '../../shared/constants.js';

export const ENTITY = { SIGNAL: 'signal', TASK: 'task' };

function toFile(row) {
  return row
    ? {
        id: row.id,
        filename: row.filename,
        mime: row.mime,
        size: row.size,
        url: row.url,
        createdAt: row.created_at,
      }
    : null;
}

/**
 * Сохраняет буфер на диск и заводит запись в таблице files.
 * Серверная валидация дублирует клиентскую — клиенту доверять нельзя.
 */
export function storeFile({ filename, buffer, mime }, actor) {
  const safeName = path.basename(String(filename ?? '')).slice(0, 180);

  if (!safeName) throw badRequest('Не указано имя файла');
  if (!isAllowedFilename(safeName)) throw badRequest(`Недопустимый тип файла: ${safeName}`);
  if (buffer.length === 0) throw badRequest(`Файл «${safeName}» пустой`);
  if (buffer.length > MAX_FILE_SIZE) throw badRequest(`Файл «${safeName}» превышает лимит размера`);

  const id = uid('file');
  const storagePath = path.join(UPLOADS_DIR, `${id}.${extensionOf(safeName)}`);
  fs.writeFileSync(storagePath, buffer);

  const record = {
    id,
    filename: safeName,
    // MIME из расширения: заголовок из multipart подделывается тривиально.
    mime: mimeForFilename(safeName) || mime || 'application/octet-stream',
    size: buffer.length,
    url: `/files/${id}`,
    storagePath,
    uploadedBy: actor?.id ?? null,
    createdAt: Date.now(),
  };

  sql.run(
    `INSERT INTO files (id, filename, mime, size, url, storage_path, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.filename,
      record.mime,
      record.size,
      record.url,
      record.storagePath,
      record.uploadedBy,
      record.createdAt,
    ],
  );

  return toFile({ ...record, created_at: record.createdAt });
}

export function getFileRow(id) {
  return sql.get(`SELECT * FROM files WHERE id = ?`, [id]);
}

export function openFileStream(id) {
  const row = getFileRow(id);
  if (!row) throw notFound('Файл не найден');
  if (!fs.existsSync(row.storage_path)) throw notFound('Файл отсутствует в хранилище');
  return { row, stream: fs.createReadStream(row.storage_path) };
}

/** Привязывает ранее загруженные файлы к сигналу или задаче. */
export function attachFiles(entityType, entityId, fileIds = []) {
  const unique = [...new Set(fileIds.filter(Boolean))].slice(0, 20);

  unique.forEach((fileId, index) => {
    const exists = sql.get(`SELECT id FROM files WHERE id = ?`, [fileId]);
    if (!exists) throw badRequest('Один из прикрепленных файлов не найден');

    sql.run(
      `INSERT OR IGNORE INTO attachments (entity_type, entity_id, file_id, position)
       VALUES (?, ?, ?, ?)`,
      [entityType, entityId, fileId, index],
    );
  });

  return unique.length;
}

export function listAttachments(entityType, entityId) {
  return sql
    .all(
      `SELECT f.* FROM attachments a
         JOIN files f ON f.id = a.file_id
        WHERE a.entity_type = ? AND a.entity_id = ?
        ORDER BY a.position, f.created_at`,
      [entityType, entityId],
    )
    .map(toFile);
}

/** Пакетная выборка вложений для списка сущностей — без запроса на каждую карточку. */
export function listAttachmentsFor(entityType, entityIds) {
  if (!entityIds.length) return new Map();

  const placeholders = entityIds.map(() => '?').join(', ');
  const rows = sql.all(
    `SELECT a.entity_id, f.* FROM attachments a
       JOIN files f ON f.id = a.file_id
      WHERE a.entity_type = ? AND a.entity_id IN (${placeholders})
      ORDER BY a.position, f.created_at`,
    [entityType, ...entityIds],
  );

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.entity_id) ?? [];
    list.push(toFile(row));
    grouped.set(row.entity_id, list);
  }
  return grouped;
}
