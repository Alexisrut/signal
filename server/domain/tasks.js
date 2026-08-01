/**
 * Модуль «Задачи» — независимый раздел.
 *
 * Сознательно НЕ подключен ни к таймерам эскалации, ни к подсистеме уведомлений:
 * задачи не стареют и не рассылают писем. Единственное, что их роднит с сигналами, —
 * визуальная структура дашборда.
 */

import { sql } from '../db.js';
import { uid } from '../crypto.js';
import { badRequest, notFound } from '../http.js';
import { publish } from '../events.js';
import { findUser } from '../identity.js';
import { attachFiles, listAttachments, listAttachmentsFor, ENTITY } from './files.js';

import { TASK_STATUS, TASK_STATUS_ORDER } from '../../shared/constants.js';
import { validateTaskInput } from '../../shared/validation.js';

function toTask(row, attachments = []) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: findUser(row.author_id)?.displayName ?? 'Неизвестный автор',
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
  };
}

export function listAll() {
  const rows = sql.all(`SELECT * FROM tasks ORDER BY updated_at DESC`);
  const attachments = listAttachmentsFor(ENTITY.TASK, rows.map((row) => row.id));
  return rows.map((row) => toTask(row, attachments.get(row.id) ?? []));
}

export function getById(id) {
  const row = sql.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  return row ? toTask(row, listAttachments(ENTITY.TASK, id)) : null;
}

export function queryForExport({ status = 'all' } = {}) {
  if (status === 'all' || !TASK_STATUS_ORDER.includes(status)) {
    return sql.all(`SELECT * FROM tasks ORDER BY created_at DESC`);
  }
  return sql.all(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC`, [status]);
}

export function createTask(input, actor) {
  const { valid, errors } = validateTaskInput(input);
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const now = Date.now();
  const id = uid('task');

  sql.transaction(() => {
    sql.run(
      `INSERT INTO tasks (id, author_id, title, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, actor.id, String(input.title).trim(), String(input.description).trim(), TASK_STATUS.OPEN, now, now],
    );
    attachFiles(ENTITY.TASK, id, input.fileIds ?? []);
  });

  publish('task', { id });
  return getById(id);
}

/** Статус задачи меняется свободно в обе стороны: терминальных состояний здесь нет. */
export function changeStatus(taskId, status, _actor) {
  if (!TASK_STATUS_ORDER.includes(status)) throw badRequest('Неизвестный статус задачи');

  const existing = sql.get(`SELECT id, status FROM tasks WHERE id = ?`, [taskId]);
  if (!existing) throw notFound('Задача не найдена');
  if (existing.status === status) return getById(taskId);

  sql.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, [status, Date.now(), taskId]);
  publish('task', { id: taskId, status });
  return getById(taskId);
}
