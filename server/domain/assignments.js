/**
 * Исполнители. Сигнал и задачу могут вести несколько человек одновременно,
 * поэтому связь хранится отдельной таблицей, а не колонкой в сущности.
 *
 * Имя исполнителя сохраняется рядом с идентификатором: карточка должна
 * оставаться читаемой, даже если учетную запись потом переименуют.
 */

import { sql } from '../db.js';
import { ASSIGNMENT } from '../../shared/constants.js';

export const ASSIGNABLE = { SIGNAL: 'signal', TASK: 'task' };

function toAssignee(row) {
  return { id: row.user_id, name: row.user_name, at: row.assigned_at };
}

/** Исполнители одной сущности в порядке принятия в работу. */
export function listOne(entityType, entityId) {
  return sql
    .all(`SELECT * FROM assignments WHERE entity_type = ? AND entity_id = ? ORDER BY assigned_at, user_name`, [
      entityType,
      entityId,
    ])
    .map(toAssignee);
}

/** Пакетная выборка для списков — без запроса на каждую карточку. */
export function listFor(entityType, entityIds) {
  if (!entityIds.length) return new Map();

  const placeholders = entityIds.map(() => '?').join(', ');
  const rows = sql.all(
    `SELECT * FROM assignments
      WHERE entity_type = ? AND entity_id IN (${placeholders})
      ORDER BY assigned_at, user_name`,
    [entityType, ...entityIds],
  );

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.entity_id) ?? [];
    list.push(toAssignee(row));
    grouped.set(row.entity_id, list);
  }
  return grouped;
}

export function isAssigned(entityType, entityId, userId) {
  return Boolean(
    sql.get(`SELECT 1 AS ok FROM assignments WHERE entity_type = ? AND entity_id = ? AND user_id = ?`, [
      entityType,
      entityId,
      userId,
    ]),
  );
}

/** @returns {boolean} было ли добавление (false — этот человек уже в работе) */
export function add(entityType, entityId, user, at = Date.now()) {
  const result = sql.run(
    `INSERT OR IGNORE INTO assignments (entity_type, entity_id, user_id, user_name, assigned_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityType, entityId, user.id, user.displayName ?? user.name ?? user.id, at],
  );
  return Boolean(result?.changes);
}

/** @returns {{id: string, name: string}|null} снятый исполнитель */
export function remove(entityType, entityId, userId) {
  const existing = sql.get(`SELECT * FROM assignments WHERE entity_type = ? AND entity_id = ? AND user_id = ?`, [
    entityType,
    entityId,
    userId,
  ]);
  if (!existing) return null;

  sql.run(`DELETE FROM assignments WHERE entity_type = ? AND entity_id = ? AND user_id = ?`, [
    entityType,
    entityId,
    userId,
  ]);
  return toAssignee(existing);
}

export function removeAll(entityType, entityId) {
  sql.run(`DELETE FROM assignments WHERE entity_type = ? AND entity_id = ?`, [entityType, entityId]);
}

/**
 * Кусок WHERE для фильтра «принятые / непринятые».
 * @returns {string} пустая строка, если фильтр не задан
 */
export function assignmentClause(entityType, assignment, table) {
  const exists = `EXISTS (SELECT 1 FROM assignments a WHERE a.entity_type = '${entityType}' AND a.entity_id = ${table}.id)`;
  if (assignment === ASSIGNMENT.ASSIGNED) return exists;
  if (assignment === ASSIGNMENT.FREE) return `NOT ${exists}`;
  return '';
}
