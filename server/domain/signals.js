/**
 * Сервис сигналов. Здесь и только здесь принимаются решения об изменении данных:
 * правила берутся из общего конечного автомата, письма инициируются его событиями,
 * а изоляция подрядчиков обеспечивается выборками по author_id.
 */

import { sql } from '../db.js';
import { uid } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { ensureContractorRecord, findUser } from '../identity.js';
import { attachFiles, listAttachments, listAttachmentsFor, ENTITY } from './files.js';
import { notifySignalEvent } from '../mail/notifier.js';

import { LINE, LINES, ROLE, STATUS, SYSTEM_ACTOR, keyToLine } from '../../shared/constants.js';
import { canTransition, isEscalationDue, notificationEventFor } from '../../shared/state-machine.js';
import { validateSignalInput } from '../../shared/validation.js';

const VALID_LINES = new Set([...LINES.map((line) => line.id), LINE.NONE]);

function toSignal(row, history = [], attachments = []) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorRole: row.author_role,
    line: row.line ?? LINE.NONE,
    contractorName: row.contractor_name,
    sector: row.sector,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history,
    attachments,
  };
}

function toHistoryEntry(row) {
  return {
    at: row.at,
    from: row.status_from,
    to: row.status_to,
    byId: row.by_id,
    byName: row.by_name,
    byRole: row.by_role,
    note: row.note ?? undefined,
  };
}

function historyFor(signalIds) {
  if (!signalIds.length) return new Map();

  const placeholders = signalIds.map(() => '?').join(', ');
  const rows = sql.all(
    `SELECT * FROM signal_history WHERE signal_id IN (${placeholders}) ORDER BY at, id`,
    signalIds,
  );

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.signal_id) ?? [];
    list.push(toHistoryEntry(row));
    grouped.set(row.signal_id, list);
  }
  return grouped;
}

function hydrate(rows) {
  const ids = rows.map((row) => row.id);
  const history = historyFor(ids);
  const attachments = listAttachmentsFor(ENTITY.SIGNAL, ids);
  return rows.map((row) => toSignal(row, history.get(row.id) ?? [], attachments.get(row.id) ?? []));
}

function insertHistory(signalId, { from, to, actor, at = Date.now(), note = null }) {
  sql.run(
    `INSERT INTO signal_history (signal_id, at, status_from, status_to, by_id, by_name, by_role, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [signalId, at, from, to, actor.id, actor.displayName, actor.role, note],
  );
}

/* ---------------------------------- выборки ---------------------------------- */

export function listAll() {
  return hydrate(sql.all(`SELECT * FROM signals ORDER BY updated_at DESC`));
}

/** Изолированная выборка подрядчика: только собственные сигналы. */
export function listByAuthor(authorId) {
  return hydrate(sql.all(`SELECT * FROM signals WHERE author_id = ? ORDER BY updated_at DESC`, [authorId]));
}

export function getRaw(id) {
  return sql.get(`SELECT * FROM signals WHERE id = ?`, [id]);
}

export function getById(id) {
  const row = getRaw(id);
  if (!row) return null;
  return toSignal(row, historyFor([id]).get(id) ?? [], listAttachments(ENTITY.SIGNAL, id));
}

/** Доступ с учетом роли: подрядчик видит только свой сигнал. */
export function getForActor(id, actor) {
  const signal = getById(id);
  if (!signal) return null;
  if (actor.role === ROLE.ADMIN) return signal;
  return signal.authorId === actor.id ? signal : null;
}

/** Сигналы для дашборда с фильтрами — SQL, а не фильтрация в памяти. */
export function queryForExport({ line = 'all', status = 'all' } = {}) {
  const where = [];
  const params = [];

  if (line !== 'all') {
    if (line === 'none') where.push(`line IS NULL`);
    else {
      where.push(`line = ?`);
      params.push(line);
    }
  }

  if (status !== 'all') {
    if (status === 'active') where.push(`status IN ('${STATUS.YELLOW}', '${STATUS.RED}')`);
    else {
      where.push(`status = ?`);
      params.push(status);
    }
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return sql.all(`SELECT * FROM signals ${clause} ORDER BY created_at DESC`, params);
}

/* --------------------------------- мутации ----------------------------------- */

export function createSignal(input, actor) {
  const { valid, errors } = validateSignalInput(input);
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const line = VALID_LINES.has(keyToLine(input.line)) ? keyToLine(input.line) : LINE.NONE;
  const now = Date.now();
  const id = uid('sig');

  sql.transaction(() => {
    if (actor.role === ROLE.CONTRACTOR) ensureContractorRecord(actor);

    sql.run(
      `INSERT INTO signals (id, author_id, author_role, line, contractor_name, sector, description,
                            status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        actor.id,
        actor.role,
        line,
        String(input.contractorName).trim(),
        String(input.sector).trim(),
        String(input.description).trim(),
        STATUS.YELLOW,
        now,
        now,
      ],
    );

    insertHistory(id, { from: null, to: STATUS.YELLOW, actor, at: now, note: 'Сигнал создан' });
    attachFiles(ENTITY.SIGNAL, id, input.fileIds ?? []);
  });

  const signal = getById(id);
  publish('signal', { id, status: signal.status });

  // Триггер рассылки определяет конечный автомат, а не вызывающий код.
  notifySignalEvent(notificationEventFor(null, STATUS.YELLOW), signal, actor);

  return signal;
}

export function changeStatus(signalId, to, actor, note = null) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');

  // Подрядчик не должен даже знать о существовании чужого сигнала.
  if (actor.role !== ROLE.ADMIN && actor.role !== ROLE.SYSTEM && before.authorId !== actor.id) {
    throw notFound('Сигнал не найден');
  }

  const verdict = canTransition(before, to, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const now = Date.now();
  sql.transaction(() => {
    sql.run(`UPDATE signals SET status = ?, updated_at = ? WHERE id = ?`, [to, now, signalId]);
    insertHistory(signalId, { from: before.status, to, actor, at: now, note });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: to });

  notifySignalEvent(notificationEventFor(before.status, to), signal, actor);

  return signal;
}

/** Системная эскалация Желтый → Красный (вызывается только фоновым процессом). */
export function escalateToRed(signalId) {
  return changeStatus(signalId, STATUS.RED, SYSTEM_ACTOR, 'Автоэскалация: превышен порог 48 часов');
}

/** Все Желтые сигналы, у которых истек порог — выборка для фонового процесса. */
export function findDueForEscalation(now = Date.now()) {
  const rows = sql.all(`SELECT * FROM signals WHERE status = ? ORDER BY created_at`, [STATUS.YELLOW]);
  return hydrate(rows).filter((signal) => isEscalationDue(signal, now));
}

/**
 * ДЕМО-ИНСТРУМЕНТ: сдвигает метки времени сигнала в прошлое, чтобы автоэскалацию
 * можно было наблюдать не дожидаясь двух суток. Статус не меняет — Красный
 * по-прежнему выставляет только фоновый процесс.
 */
export function ageSignal(signalId, ms) {
  const row = getRaw(signalId);
  if (!row) throw notFound('Сигнал не найден');

  sql.transaction(() => {
    sql.run(`UPDATE signals SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?`, [
      ms,
      ms,
      signalId,
    ]);
    sql.run(`UPDATE signal_history SET at = at - ? WHERE signal_id = ?`, [ms, signalId]);
  });

  publish('signal', { id: signalId, aged: true });
  return getById(signalId);
}

/** Отображаемое имя автора — для карточки в админ-панели. */
export function authorLabel(signal) {
  const user = findUser(signal.authorId);
  if (!user) return `Аноним · ${signal.authorId}`;
  return `${user.displayName} · ${user.role === ROLE.ADMIN ? 'администратор' : 'подрядчик'}`;
}
