/**
 * Сервис сигналов. Здесь и только здесь принимаются решения об изменении данных:
 * правила берутся из общего конечного автомата, письма инициируются его событиями.
 *
 * Категорию подрядчик не выбирает — сигнал создается нераспределенным и попадает
 * в раздел «Распределение», доступный только главному администратору.
 */

import { sql } from '../db.js';
import { uid } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { findUser } from '../identity.js';
import { attachFiles, listAttachments, listAttachmentsFor, ENTITY } from './files.js';
import { ASSIGNABLE, add as addAssignee, assignmentClause, listFor, listOne, remove as removeAssignee } from './assignments.js';
import { notifySignalEvent } from '../mail/notifier.js';

import {
  ASSIGNMENT,
  CATEGORY_IDS,
  HISTORY_KIND,
  ROLE,
  SIGNAL_FIELD_LABELS,
  STATUS,
  SYSTEM_ACTOR,
  categoryLabel,
} from '../../shared/constants.js';
import {
  canAssign,
  canDistribute,
  canEdit,
  canRelease,
  canTransition,
  isAssignedTo,
  isEscalationDue,
  notificationEventFor,
} from '../../shared/state-machine.js';
import { validateSignalInput } from '../../shared/validation.js';

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function toSignal(row, history = [], attachments = [], assignees = []) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorRole: row.author_role,
    category: row.category ?? null,
    contractorName: row.contractor_name,
    sector: row.sector,
    description: row.description,
    status: row.status,
    assignees,
    distributedAt: row.distributed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history,
    attachments,
  };
}

function toHistoryEntry(row) {
  return {
    at: row.at,
    kind: row.kind ?? HISTORY_KIND.STATUS,
    from: row.status_from,
    to: row.status_to,
    byId: row.by_id,
    byName: row.by_name,
    byRole: row.by_role,
    note: row.note ?? undefined,
    details: row.details ? safeParse(row.details) : undefined,
  };
}

function historyFor(signalIds) {
  if (!signalIds.length) return new Map();

  const placeholders = signalIds.map(() => '?').join(', ');
  const rows = sql.all(`SELECT * FROM signal_history WHERE signal_id IN (${placeholders}) ORDER BY at, id`, signalIds);

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
  const assignees = listFor(ASSIGNABLE.SIGNAL, ids);
  return rows.map((row) =>
    toSignal(row, history.get(row.id) ?? [], attachments.get(row.id) ?? [], assignees.get(row.id) ?? []),
  );
}

function insertHistory(signalId, { kind, from, to, actor, at = Date.now(), note = null, details = null }) {
  sql.run(
    `INSERT INTO signal_history (signal_id, at, kind, status_from, status_to, by_id, by_name, by_role, note, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [signalId, at, kind, from, to, actor.id, actor.displayName, actor.role, note, details ? JSON.stringify(details) : null],
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

/** Нераспределенные сигналы — содержимое раздела «Распределение». */
export function listUndistributed() {
  return hydrate(sql.all(`SELECT * FROM signals WHERE category IS NULL ORDER BY created_at`));
}

/**
 * Что администратор видит на дашборде: только распределенные сигналы.
 * Главный видит все категории, обычный — разрешенные ему; нераспределенные
 * живут отдельно, в разделе «Распределение».
 */
export function listForAdmin(actor) {
  if (actor.role === ROLE.SUPERADMIN) {
    return hydrate(sql.all(`SELECT * FROM signals WHERE category IS NOT NULL ORDER BY updated_at DESC`));
  }

  const categories = actor.categories ?? [];
  if (!categories.length) return [];

  const placeholders = categories.map(() => '?').join(', ');
  return hydrate(
    sql.all(`SELECT * FROM signals WHERE category IN (${placeholders}) ORDER BY updated_at DESC`, categories),
  );
}

export function getRaw(id) {
  return sql.get(`SELECT * FROM signals WHERE id = ?`, [id]);
}

export function getById(id) {
  const row = getRaw(id);
  if (!row) return null;
  return toSignal(row, historyFor([id]).get(id) ?? [], listAttachments(ENTITY.SIGNAL, id), listOne(ASSIGNABLE.SIGNAL, id));
}

/** Доступ с учетом роли: подрядчик видит свой, администратор — разрешенные категории. */
export function getForActor(id, actor) {
  const signal = getById(id);
  if (!signal) return null;

  if (actor.role === ROLE.SUPERADMIN) return signal;
  if (actor.role === ROLE.ADMIN) {
    return signal.category && (actor.categories ?? []).includes(signal.category) ? signal : null;
  }
  return signal.authorId === actor.id ? signal : null;
}

/** Сигналы для отчета с фильтрами — SQL, а не фильтрация в памяти. */
export function queryForExport({ category = 'all', status = 'all', assignment = ASSIGNMENT.ALL } = {}, actor) {
  const where = [];
  const params = [];

  if (category === 'none') where.push(`category IS NULL`);
  else if (category !== 'all' && CATEGORY_IDS.includes(category)) {
    where.push(`category = ?`);
    params.push(category);
  }

  // Обычный администратор выгружает только то, что ему видно.
  if (actor?.role === ROLE.ADMIN) {
    const allowed = actor.categories ?? [];
    if (!allowed.length) return [];
    where.push(`category IN (${allowed.map(() => '?').join(', ')})`);
    params.push(...allowed);
  }

  if (status !== 'all') {
    if (status === 'active') where.push(`status IN ('${STATUS.YELLOW}', '${STATUS.RED}')`);
    else {
      where.push(`status = ?`);
      params.push(status);
    }
  }

  const assignmentSql = assignmentClause(ASSIGNABLE.SIGNAL, assignment, 'signals');
  if (assignmentSql) where.push(assignmentSql);

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

  const now = Date.now();
  const id = uid('sig');

  sql.transaction(() => {
    sql.run(
      `INSERT INTO signals (id, author_id, author_role, category, contractor_name, sector, description,
                            status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        actor.id,
        actor.role,
        String(input.contractorName).trim(),
        String(input.sector).trim(),
        String(input.description).trim(),
        STATUS.YELLOW,
        now,
        now,
      ],
    );

    insertHistory(id, {
      kind: HISTORY_KIND.CREATE,
      from: null,
      to: STATUS.YELLOW,
      actor,
      at: now,
      note: 'Сигнал создан и ожидает распределения',
    });

    attachFiles(ENTITY.SIGNAL, id, input.fileIds ?? []);
  });

  const signal = getById(id);
  publish('signal', { id, status: signal.status });

  // Триггер рассылки определяет конечный автомат, а не вызывающий код.
  notifySignalEvent(notificationEventFor(null, STATUS.YELLOW), signal, actor);

  return signal;
}

/** Назначить категорию: раздел «Распределение» главного администратора. */
export function distribute(signalId, category, actor) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');

  const verdict = canDistribute(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);
  if (!CATEGORY_IDS.includes(category)) throw badRequest('Неизвестная категория');
  if (before.category === category) return before;

  const now = Date.now();
  sql.transaction(() => {
    sql.run(`UPDATE signals SET category = ?, distributed_at = ?, updated_at = ? WHERE id = ?`, [
      category,
      before.distributedAt ?? now,
      now,
      signalId,
    ]);

    insertHistory(signalId, {
      kind: HISTORY_KIND.CATEGORY,
      from: before.status,
      to: before.status,
      actor,
      at: now,
      note: before.category
        ? `Категория изменена: ${categoryLabel(before.category)} → ${categoryLabel(category)}`
        : `Распределен в категорию «${categoryLabel(category)}»`,
      details: { from: categoryLabel(before.category), to: categoryLabel(category) },
    });
  });

  publish('signal', { id: signalId, category });
  return getById(signalId);
}

/**
 * Видит ли пользователь конкретный сигнал. Обычный администратор ограничен
 * своими категориями, и это проверяется на каждой мутации, а не только в выборках:
 * иначе чужой сигнал остался бы доступен по прямому запросу с известным ID.
 */
function assertVisible(signal, actor) {
  if (actor.role === ROLE.SUPERADMIN || actor.role === ROLE.SYSTEM) return;

  if (actor.role === ROLE.ADMIN) {
    if (!signal.category || !(actor.categories ?? []).includes(signal.category)) {
      throw notFound('Сигнал не найден');
    }
    return;
  }

  if (signal.authorId !== actor.id) throw notFound('Сигнал не найден');
}

export function changeStatus(signalId, to, actor, note = null) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');

  // Ни подрядчик, ни администратор чужой категории не должны даже знать о сигнале.
  assertVisible(before, actor);

  const verdict = canTransition(before, to, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const now = Date.now();
  sql.transaction(() => {
    sql.run(`UPDATE signals SET status = ?, updated_at = ? WHERE id = ?`, [to, now, signalId]);
    insertHistory(signalId, { kind: HISTORY_KIND.STATUS, from: before.status, to, actor, at: now, note });
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
 * можно было наблюдать не дожидаясь двух суток.
 */
export function ageSignal(signalId, ms) {
  const row = getRaw(signalId);
  if (!row) throw notFound('Сигнал не найден');

  sql.transaction(() => {
    sql.run(`UPDATE signals SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?`, [ms, ms, signalId]);
    sql.run(`UPDATE signal_history SET at = at - ? WHERE signal_id = ?`, [ms, signalId]);
  });

  publish('signal', { id: signalId, aged: true });
  return getById(signalId);
}

/* ------------------------- принятие в работу и правки ------------------------- */

export function setAssignee(signalId, actor, assign, userId = actor.id) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');
  assertVisible(before, actor);

  // Повторное принятие — не отказ в правах, а бессмысленный запрос.
  if (assign && isAssignedTo(before, actor.id)) throw badRequest('Вы уже в работе по этому сигналу');

  const verdict = assign ? canAssign(before, actor) : canRelease(before, actor, userId);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const now = Date.now();
  sql.transaction(() => {
    if (assign) {
      if (!addAssignee(ASSIGNABLE.SIGNAL, signalId, actor, now)) return;
      insertHistory(signalId, {
        kind: HISTORY_KIND.ASSIGN,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: 'Принял сигнал в работу',
      });
    } else {
      const removed = removeAssignee(ASSIGNABLE.SIGNAL, signalId, userId);
      if (!removed) return;
      insertHistory(signalId, {
        kind: HISTORY_KIND.RELEASE,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: removed.id === actor.id ? 'Вышел из работы по сигналу' : `Снял исполнителя: ${removed.name}`,
      });
    }

    sql.run(`UPDATE signals SET updated_at = ? WHERE id = ?`, [now, signalId]);
  });

  publish('signal', { id: signalId, assigned: assign });
  return getById(signalId);
}

/** Редактирование карточки с записью изменившихся полей в историю. */
export function updateSignal(signalId, input, actor) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');
  assertVisible(before, actor);

  const verdict = canEdit(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const { valid, errors } = validateSignalInput(input);
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const next = {
    contractorName: String(input.contractorName).trim(),
    sector: String(input.sector).trim(),
    description: String(input.description).trim(),
  };

  const changes = Object.keys(SIGNAL_FIELD_LABELS)
    .filter((field) => next[field] !== before[field])
    .map((field) => ({ field, label: SIGNAL_FIELD_LABELS[field], from: before[field], to: next[field] }));

  if (!changes.length) return before;

  const now = Date.now();
  sql.transaction(() => {
    sql.run(`UPDATE signals SET contractor_name = ?, sector = ?, description = ?, updated_at = ? WHERE id = ?`, [
      next.contractorName,
      next.sector,
      next.description,
      now,
      signalId,
    ]);

    insertHistory(signalId, {
      kind: HISTORY_KIND.EDIT,
      from: before.status,
      to: before.status,
      actor,
      at: now,
      note: `Отредактировано: ${changes.map((change) => change.label.toLowerCase()).join(', ')}`,
      details: { changes },
    });
  });

  publish('signal', { id: signalId, edited: true });
  return getById(signalId);
}

/** Отображаемое имя автора — для карточки в панели администратора. */
export function authorLabel(signal) {
  const user = findUser(signal.authorId);
  if (!user) return `Удаленный пользователь · ${signal.authorId}`;
  if (user.role === ROLE.CONTRACTOR) return `${user.companyName} · ${user.fullName}`;
  return `${user.displayName} · администратор`;
}
