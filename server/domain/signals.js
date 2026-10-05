/**
 * Сервис сигналов. Здесь и только здесь принимаются решения об изменении данных:
 * правила берутся из общего конечного автомата, письма уходят по каждому действию.
 *
 * Путь сигнала: подрядчик создает его → главный администратор проверяет на
 * входном контроле и либо распределяет ответственному, либо возвращает
 * подрядчику на доработку → ответственный отрабатывает → сигнал закрывается.
 *
 * Каждое действие — запись в ленте событий и письмо участникам. Все письма
 * одного сигнала уходят с одной темой и складываются в почте в цепочку.
 */

import { sql } from '../db.js';
import { uid } from '../crypto.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { publish } from '../events.js';
import { findUser } from '../identity.js';
import { attachFiles, listAttachments, listAttachmentsFor, listEventAttachmentsForSignals, ENTITY } from './files.js';
import { ASSIGNABLE, add as addAssignee, assignmentClause, listFor, listOne, remove as removeAssignee } from './assignments.js';
import { notifySignal } from '../mail/notifier.js';

import {
  ASSIGNMENT,
  CATEGORY_IDS,
  HISTORY_KIND,
  PUBLIC_HISTORY_KINDS,
  ROLE,
  SIGNAL_ACTION,
  SIGNAL_FIELD_LABELS,
  STATUS,
  STATUS_META,
  SYSTEM_ACTOR,
  categoryLabel,
  deriveSignalTopic,
  isCategoryScopedRole,
  isStaffRole,
  isSuperadminRole,
} from '../../shared/constants.js';
import {
  WORKFLOW,
  can,
  canAssign,
  canAssignOthers,
  canComment,
  canReport,
  canCurate,
  canDistribute,
  canEdit,
  canRelease,
  canReopen,
  isActive,
  isAssignedTo,
  isEscalationDue,
  isPaused,
  isTerminal,
  reopenTargetStatus,
  requiresComment,
  requiresReport,
  resolutionMs,
  submitActionFor,
} from '../../shared/state-machine.js';
import { validateComment, validateReport, validateSignalInput } from '../../shared/validation.js';

/** Заметка к распределению: обрезаем и приводим к null, чтобы не хранить пустую строку. */
const MAX_NOTE_LENGTH = 1000;

function cleanNote(value) {
  const text = String(value ?? '').trim().slice(0, MAX_NOTE_LENGTH);
  return text || null;
}

/** Комментарий к действию: проверка общей валидацией и приведение к null. */
function cleanComment(value, { required = false } = {}) {
  const error = validateComment(value, { required });
  if (error) throw badRequest(error);
  return String(value ?? '').trim() || null;
}

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
    number: row.number ?? null,
    topic: row.topic ?? null,
    authorId: row.author_id,
    authorRole: row.author_role,
    category: row.category ?? null,
    contractorName: row.contractor_name,
    sector: row.sector,
    description: row.description,
    status: row.status,
    statusAt: row.status_at ?? null,
    assignees,
    assignmentNote: row.assignment_note ?? null,
    report: row.report ?? null,
    reportAt: row.report_at ?? null,
    reportBy: row.report_by ?? null,
    distributedAt: row.distributed_at ?? null,
    closedAt: row.closed_at ?? null,
    // Время, когда часы сигнала стояли: вычитается из времени решения.
    pausedMs: row.paused_ms ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history,
    attachments,
  };
}

function toHistoryEntry(row, files = []) {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind ?? HISTORY_KIND.STATUS,
    from: row.status_from,
    to: row.status_to,
    byId: row.by_id,
    byName: row.by_name,
    byRole: row.by_role,
    note: row.note ?? undefined,
    details: row.details ? safeParse(row.details) : undefined,
    files,
  };
}

function historyFor(signalIds) {
  if (!signalIds.length) return new Map();

  const placeholders = signalIds.map(() => '?').join(', ');
  const rows = sql.all(`SELECT * FROM signal_history WHERE signal_id IN (${placeholders}) ORDER BY at, id`, signalIds);
  const files = listEventAttachmentsForSignals(signalIds);

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.signal_id) ?? [];
    list.push(toHistoryEntry(row, files.get(String(row.id)) ?? []));
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

/**
 * Запись в ленту событий. Файлы, приложенные к действию, привязываются
 * к самой записи — так в ленте видно, к какому шагу их приложили.
 * @returns {number} идентификатор записи
 */
function insertHistory(signalId, { kind, from, to, actor, at = Date.now(), note = null, details = null, fileIds = [] }) {
  const result = sql.run(
    `INSERT INTO signal_history (signal_id, at, kind, status_from, status_to, by_id, by_name, by_role, note, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [signalId, at, kind, from, to, actor.id, actor.displayName, actor.role, note, details ? JSON.stringify(details) : null],
  );
  const id = Number(result.lastInsertRowid);
  if (fileIds.length) attachFiles(ENTITY.EVENT, String(id), fileIds, actor);
  return id;
}

/**
 * Смена статуса в строке сигнала. Единственное место, где ведется учет пауз:
 * если сигнал выходит из статуса со стоящими часами (доработка у подрядчика,
 * закрытие), проведенное в нем время добавляется к паузе.
 */
function applyStatus(signalId, before, to, now) {
  const pause = isPaused(before.status) ? Math.max(0, now - (before.statusAt ?? before.closedAt ?? now)) : 0;
  sql.run(
    `UPDATE signals SET status = ?, status_at = ?, paused_ms = paused_ms + ?, closed_at = ?, updated_at = ? WHERE id = ?`,
    // Момент закрытия фиксируется явно: время решения нельзя выводить
    // из updated_at, потому что закрытую карточку еще правят и комментируют.
    [to, now, pause, isTerminal(to) ? now : null, now, signalId],
  );
}

/** Файлы действия: уникальные идентификаторы, без пустых значений. */
const fileIdsOf = (input) => [...new Set((Array.isArray(input?.fileIds) ? input.fileIds : []).filter(Boolean))];

/** Записи файлов действия — для письма. */
const filesOf = (signal, eventId) => signal.history.find((entry) => entry.id === eventId)?.files ?? [];

/* ---------------------------------- выборки ---------------------------------- */

export function listAll() {
  return hydrate(sql.all(`SELECT * FROM signals ORDER BY updated_at DESC`));
}

/** Изолированная выборка подрядчика: только собственные сигналы. */
export function listByAuthor(authorId) {
  return hydrate(sql.all(`SELECT * FROM signals WHERE author_id = ? ORDER BY updated_at DESC`, [authorId]));
}

/**
 * Личный список сотрудника — вкладка «Мои сигналы»: задачи, за которые он
 * отвечает, и сигналы, которые он подал сам (по ним он — подтверждающая
 * сторона). Закрытые задачи из списка не исчезают: решенное остается как
 * история работы.
 */
export function listMine(userId) {
  return hydrate(
    sql.all(
      `SELECT s.* FROM signals s
        WHERE s.author_id = ?
           OR EXISTS (SELECT 1 FROM assignments a
                       WHERE a.entity_type = ? AND a.entity_id = s.id AND a.user_id = ?)
        ORDER BY s.updated_at DESC`,
      [userId, ASSIGNABLE.SIGNAL, userId],
    ),
  );
}

/**
 * Нераспределенные сигналы — содержимое раздела «Входной контроль»:
 * ждущие проверки, вернувшиеся к подрядчику и закрытые без распределения.
 */
export function listUndistributed() {
  return hydrate(sql.all(`SELECT * FROM signals WHERE category IS NULL ORDER BY created_at`));
}

/**
 * Что сотрудник видит на дашборде: только распределенные сигналы.
 * Главный администратор видит все категории, администратор и руководитель —
 * закрепленные за ними; нераспределенные живут отдельно, во «Входном контроле».
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

/**
 * Статистика решения задач по всей платформе — не по видимым актору категориям:
 * раскрывающаяся строка на дашборде обещает именно общую картину.
 * Время решения берется из конечного автомата, поэтому паузы уже учтены.
 */
export function resolutionStats() {
  // Истории и вложения здесь не нужны: время решения считается по меткам
  // времени самой строки, поэтому обходимся без гидратации.
  const rows = sql.all(`SELECT * FROM signals WHERE status = ?`, [STATUS.GREEN]);

  const totals = new Map(CATEGORY_IDS.map((id) => [id, { resolved: 0, totalMs: 0 }]));
  let resolved = 0;
  let totalMs = 0;

  for (const row of rows) {
    const ms = resolutionMs(toSignal(row));
    resolved += 1;
    totalMs += ms;

    const bucket = totals.get(row.category);
    if (!bucket) continue; // нераспределенный решенный сигнал в разрезе категорий не участвует
    bucket.resolved += 1;
    bucket.totalMs += ms;
  }

  return {
    overall: { resolved, avgMs: resolved ? Math.round(totalMs / resolved) : null },
    byCategory: CATEGORY_IDS.map((id) => {
      const bucket = totals.get(id);
      return {
        id,
        resolved: bucket.resolved,
        avgMs: bucket.resolved ? Math.round(bucket.totalMs / bucket.resolved) : null,
      };
    }),
  };
}

export function getRaw(id) {
  return sql.get(`SELECT * FROM signals WHERE id = ?`, [id]);
}

export function getById(id) {
  const row = getRaw(id);
  if (!row) return null;
  return toSignal(row, historyFor([id]).get(id) ?? [], listAttachments(ENTITY.SIGNAL, id), listOne(ASSIGNABLE.SIGNAL, id));
}

/**
 * Видит ли пользователь сигнал. Главный администратор — все; автор — свой;
 * ответственный — назначенный на него, даже вне закрепленных категорий
 * (иначе работать по нему он бы не смог); администратор и руководитель —
 * сигналы своих категорий. Нераспределенные видит только главный администратор.
 */
function isVisible(signal, actor) {
  if (!signal || !actor) return false;
  if (actor.role === ROLE.SUPERADMIN || actor.role === ROLE.SYSTEM) return true;
  if (signal.authorId === actor.id) return true;
  if (isStaffRole(actor.role) && isAssignedTo(signal, actor.id)) return true;
  if (isCategoryScopedRole(actor.role)) {
    return Boolean(signal.category) && (actor.categories ?? []).includes(signal.category);
  }
  return false;
}

/** Доступ с учетом роли: подрядчик видит свой, сотрудник — разрешенные категории. */
export function getForActor(id, actor) {
  const signal = getById(id);
  return isVisible(signal, actor) ? signal : null;
}

/**
 * Проверка видимости на каждой мутации, а не только в выборках: иначе чужой
 * сигнал остался бы доступен по прямому запросу с известным ID. Посторонний
 * получает 404 — по ответу не видно, существует ли сигнал вообще.
 */
function assertVisible(signal, actor) {
  if (!isVisible(signal, actor)) throw notFound('Сигнал не найден');
}

function load(signalId, actor) {
  const signal = getById(signalId);
  if (!signal) throw notFound('Сигнал не найден');
  assertVisible(signal, actor);
  return signal;
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

  // Администратор и руководитель выгружают только то, что им видно.
  if (isCategoryScopedRole(actor?.role)) {
    const allowed = actor.categories ?? [];
    if (!allowed.length) return [];
    where.push(`category IN (${allowed.map(() => '?').join(', ')})`);
    params.push(...allowed);
  }

  if (status !== 'all') {
    const open = Object.keys(STATUS_META).filter((id) => isActive(id));
    const wanted = status === 'active' ? open : STATUS_META[status] ? [status] : [];
    if (!wanted.length) return [];
    where.push(`status IN (${wanted.map(() => '?').join(', ')})`);
    params.push(...wanted);
  }

  const assignmentSql = assignmentClause(ASSIGNABLE.SIGNAL, assignment, 'signals');
  if (assignmentSql) where.push(assignmentSql);

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return sql.all(`SELECT * FROM signals ${clause} ORDER BY created_at DESC`, params);
}

/* --------------------------------- создание ---------------------------------- */

/**
 * Имя, под которым сигнал попадает в систему.
 *
 * Форма его не спрашивает и не может подменить: у подрядчика это название его
 * компании, у сотрудника — его собственное имя. Автора берем из сессии, а не
 * из тела запроса, иначе подписаться чужим именем было бы делом одной правки
 * в консоли браузера.
 */
function authorNameOf(actor) {
  return actor.role === ROLE.CONTRACTOR ? (actor.companyName ?? actor.displayName) : actor.displayName;
}

export function createSignal(input, actor) {
  const contractorName = authorNameOf(actor);
  const { valid, errors } = validateSignalInput({ ...input, contractorName });
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const now = Date.now();
  const id = uid('sig');
  const description = String(input.description).trim();

  sql.transaction(() => {
    // Номер выдается внутри транзакции: два одновременных сигнала не получат один и тот же.
    const { next } = sql.get(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM signals`);

    sql.run(
      `INSERT INTO signals (id, number, topic, author_id, author_role, category, contractor_name, sector, description,
                            status, status_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        next,
        deriveSignalTopic(description),
        actor.id,
        actor.role,
        contractorName,
        String(input.sector).trim(),
        description,
        STATUS.INTAKE,
        now,
        now,
        now,
      ],
    );

    // Вкладка «Мои сигналы» у автора теперь есть навсегда.
    sql.run(`UPDATE users SET has_own_signals = 1 WHERE id = ?`, [actor.id]);

    insertHistory(id, {
      kind: HISTORY_KIND.CREATE,
      from: null,
      to: STATUS.INTAKE,
      actor,
      at: now,
      details: { action: SIGNAL_ACTION.CREATE },
    });

    attachFiles(ENTITY.SIGNAL, id, fileIdsOf(input), actor);
  });

  const signal = getById(id);
  publish('signal', { id, status: signal.status });
  notifySignal(SIGNAL_ACTION.CREATE, signal, actor, { files: signal.attachments });
  return signal;
}

/* ------------------------------ входной контроль ------------------------------- */

/**
 * Распределение: раздел «Входной контроль» главного администратора.
 *
 * Для сигнала на входном контроле это его приемка: категория, ответственные
 * (хотя бы один — без них сигнал повис бы ничьим) и, по желанию, заметка им.
 * Сигнал уходит в работу — Желтый статус, и по нему начинает идти срок.
 *
 * Для сигнала, уже находящегося в работе, это смена категории и, если
 * выбраны, добавление ответственных.
 */
export function distribute(signalId, category, actor, { assignees: people = [], note = null } = {}) {
  const before = load(signalId, actor);

  const verdict = canDistribute(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);
  if (!CATEGORY_IDS.includes(category)) throw badRequest('Неизвестная категория');

  if (before.status !== STATUS.INTAKE) return recategorize(before, category, actor, { people, note });

  const accept = can(SIGNAL_ACTION.DISTRIBUTE, before, actor);
  if (!accept.allowed) throw forbidden(accept.reason);

  const requested = [...new Set((Array.isArray(people) ? people : []).map(String))];
  if (!requested.length) throw badRequest('Выберите хотя бы одного ответственного — сигнал уходит в работу к нему');

  const now = Date.now();
  let added = [];

  sql.transaction(() => {
    sql.run(`UPDATE signals SET category = ?, distributed_at = COALESCE(distributed_at, ?) WHERE id = ?`, [
      category,
      now,
      signalId,
    ]);
    applyStatus(signalId, before, STATUS.YELLOW, now);

    insertHistory(signalId, {
      kind: HISTORY_KIND.STATUS,
      from: before.status,
      to: STATUS.YELLOW,
      actor,
      at: now,
      note: `Распределен в категорию «${categoryLabel(category)}»`,
      details: { action: SIGNAL_ACTION.DISTRIBUTE, category: categoryLabel(category) },
    });

    // Ответственные назначаются в той же транзакции: сигнал не должен
    // оказаться в работе без исполнителя, если назначение не пройдет проверку.
    added = addPeople(getById(signalId), requested, actor, note, now);
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: signal.status, category });
  notifySignal(SIGNAL_ACTION.DISTRIBUTE, signal, actor, { assigned: added });
  return signal;
}

/**
 * Смена категории у сигнала в работе и, если выбраны, добавление ответственных.
 *
 * Категория и назначение пишутся одной транзакцией: если кандидат не подходит
 * к новой категории, не меняется ничего — иначе сигнал уехал бы в другую
 * категорию с сообщением об ошибке на экране. Сама смена категории —
 * внутреннее дело сотрудников, письмо уходит только о новых ответственных.
 */
function recategorize(before, category, actor, { people, note }) {
  const signalId = before.id;
  const requested = [...new Set((Array.isArray(people) ? people : []).map(String))];
  const categoryChanged = before.category !== category;
  if (!categoryChanged && !requested.length && !cleanNote(note)) return before;

  const now = Date.now();
  let added = [];

  sql.transaction(() => {
    if (categoryChanged) {
      sql.run(`UPDATE signals SET category = ?, distributed_at = COALESCE(distributed_at, ?), updated_at = ? WHERE id = ?`, [
        category,
        now,
        now,
        signalId,
      ]);

      insertHistory(signalId, {
        kind: HISTORY_KIND.CATEGORY,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: `Категория изменена: ${categoryLabel(before.category)} → ${categoryLabel(category)}`,
        details: { from: categoryLabel(before.category), to: categoryLabel(category) },
      });
    }

    // Кандидаты проверяются уже по новой категории.
    if (requested.length || cleanNote(note)) added = addPeople(getById(signalId), requested, actor, note, now);
  });

  publish('signal', { id: signalId, category, assigned: added.length });

  const signal = getById(signalId);
  if (added.length) notifySignal(SIGNAL_ACTION.ASSIGN, signal, actor, { assigned: added });
  return signal;
}

/**
 * Проверить кандидатов и добавить их ответственными; заметку — записать.
 * Вызывается внутри транзакции.
 * @returns {Array<object>} кого добавили этим действием
 */
function addPeople(before, requested, actor, note, now) {
  const signalId = before.id;

  // Повторное сохранение той же заметки не считается изменением: окно назначения
  // подставляет текущий текст, и без этой проверки каждое открытие плодило бы
  // одинаковые записи в истории.
  const raw = cleanNote(note);
  const text = raw && raw !== before.assignmentNote ? raw : null;

  const people = requested.map((id) => findUser(id)).filter(Boolean);
  const rejected = people.filter((person) => !canCurate(person, before.category));

  // Две разные причины отказа — и две разные подсказки, что делать дальше.
  const outsiders = rejected.filter((person) => !isStaffRole(person.role));
  if (outsiders.length) {
    throw badRequest(
      `Ответственным может быть только сотрудник: ${outsiders.map((person) => person.displayName).join(', ')}`,
    );
  }
  if (rejected.length) {
    throw badRequest(
      `Руководителя можно назначить только на сигнал закрепленной за ним категории ` +
        `(сейчас «${categoryLabel(before.category)}»): ` +
        rejected.map((person) => person.displayName).join(', '),
    );
  }
  if (requested.length && !people.length) throw badRequest('Ни один из выбранных сотрудников не найден');

  const added = [];
  for (const person of people) {
    if (!addAssignee(ASSIGNABLE.SIGNAL, signalId, person, now)) continue;
    added.push(person);
    // Вкладка «Мои сигналы» у куратора теперь есть навсегда.
    sql.run(`UPDATE users SET has_own_signals = 1 WHERE id = ?`, [person.id]);
  }

  if (added.length) {
    insertHistory(signalId, {
      kind: HISTORY_KIND.ASSIGN,
      from: before.status,
      to: before.status,
      actor,
      at: now,
      note: `Ответственные: ${added.map((person) => person.displayName).join(', ')}`,
      details: { assigned: added.map((person) => ({ id: person.id, name: person.displayName })) },
    });
  }

  if (text) {
    sql.run(`UPDATE signals SET assignment_note = ? WHERE id = ?`, [text, signalId]);
    insertHistory(signalId, {
      kind: HISTORY_KIND.NOTE,
      from: before.status,
      to: before.status,
      actor,
      at: now,
      note: text,
    });
  }

  if (added.length || text) sql.run(`UPDATE signals SET updated_at = ? WHERE id = ?`, [now, signalId]);
  return added;
}

/**
 * Выдать задачу ответственным и приложить заметку.
 *
 * Куратором может стать только сотрудник, которому подходит категория
 * сигнала. Проверка живет здесь, а не только в окне выбора: список на
 * клиенте подсказывает, а решает сервер.
 */
export function assignPeople(signalId, userIds, actor, note = null) {
  const before = load(signalId, actor);

  const verdict = canAssignOthers(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const requested = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))];
  if (!requested.length && !cleanNote(note)) return before;

  let added = [];
  sql.transaction(() => {
    added = addPeople(before, requested, actor, note, Date.now());
  });

  publish('signal', { id: signalId, assigned: added.length });

  const after = getById(signalId);
  // Письмо уходит, только когда кого-то добавили: правка одной заметки —
  // внутреннее дело сотрудников, подрядчику о ней знать незачем.
  if (added.length) notifySignal(SIGNAL_ACTION.ASSIGN, after, actor, { assigned: added });
  return after;
}

/* --------------------------------- действия ---------------------------------- */

/**
 * Действие конечного автомата: возврат на доработку, эскалация, закрытие,
 * отклонение. Комментарий и файлы ложатся в ту же запись ленты, что и смена
 * статуса, и уходят в письме участникам.
 */
export function performAction(signalId, action, actor, { comment = null, fileIds = [] } = {}) {
  const before = load(signalId, actor);
  if (requiresReport(action)) throw badRequest('Результат направляется на подтверждение вместе с отчетом');

  const verdict = can(action, before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const text = cleanComment(comment, { required: requiresComment(action) });
  const to = WORKFLOW[action].to;
  const now = Date.now();
  let eventId = null;

  sql.transaction(() => {
    applyStatus(signalId, before, to, now);
    eventId = insertHistory(signalId, {
      kind: HISTORY_KIND.STATUS,
      from: before.status,
      to,
      actor,
      at: now,
      note: text,
      details: { action },
      fileIds: fileIdsOf({ fileIds }),
    });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: to });
  notifySignal(action, signal, actor, { comment: text, files: filesOf(signal, eventId), from: before.status });
  return signal;
}

/**
 * ВОЗОБНОВЛЕНИЕ. Закрытый сигнал возвращается в ту рабочую фазу, в которой
 * был до закрытия, а время простоя уходит в паузу — значит, счетчик времени
 * решения продолжается с того же места, а не стартует заново.
 */
export function reopenSignal(signalId, actor, note = null) {
  const before = load(signalId, actor);

  const verdict = canReopen(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const to = reopenTargetStatus(before);
  const now = Date.now();
  const pause = Math.max(0, now - (before.statusAt ?? before.closedAt ?? now));
  const text = cleanComment(note);

  sql.transaction(() => {
    applyStatus(signalId, before, to, now);
    insertHistory(signalId, {
      kind: HISTORY_KIND.REOPEN,
      from: before.status,
      to,
      actor,
      at: now,
      note: text ?? `Сигнал возобновлен: «${STATUS_META[before.status].label}» → «${STATUS_META[to].label}»`,
      details: { action: SIGNAL_ACTION.REOPEN, pausedMs: pause },
    });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: to, reopened: true });
  notifySignal(SIGNAL_ACTION.REOPEN, signal, actor, { comment: text });
  return signal;
}

/**
 * ОТЧЕТ О ВЫПОЛНЕНИИ. Ответственный описывает, что сделано и какое решение
 * принято, прикладывает документы. С `submit: true` сигнал вместе с отчетом
 * уходит автору на подтверждение; без него отчет просто сохраняется, и его
 * можно дополнять до отправки.
 *
 * После возврата подрядчиком отчет нужно именно дополнить: повторно отправить
 * тот же текст без новых файлов нельзя — подрядчик уже сказал, что этого мало.
 */
export function saveReport(signalId, actor, { text, fileIds = [], submit = false } = {}) {
  const before = load(signalId, actor);

  const action = submit ? submitActionFor(before) : SIGNAL_ACTION.REPORT;
  const verdict = submit ? can(action, before, actor) : canReport(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const report = String(text ?? '').trim();
  const error = validateReport(report);
  if (error) throw badRequest(error);

  const files = fileIdsOf({ fileIds });
  const unchanged = report === before.report && !files.length;
  if (unchanged && action === SIGNAL_ACTION.RESUBMIT_WORK) {
    throw badRequest('Дополните отчет: опишите, что доработано после возврата, или приложите документы');
  }
  if (unchanged && action === SIGNAL_ACTION.REPORT) return before;

  const to = submit ? WORKFLOW[action].to : before.status;
  const now = Date.now();
  let eventId = null;

  sql.transaction(() => {
    sql.run(`UPDATE signals SET report = ?, report_at = ?, report_by = ?, updated_at = ? WHERE id = ?`, [
      report,
      now,
      actor.displayName,
      now,
      signalId,
    ]);
    if (submit) applyStatus(signalId, before, to, now);

    eventId = insertHistory(signalId, {
      kind: submit ? HISTORY_KIND.STATUS : HISTORY_KIND.REPORT,
      from: before.status,
      to,
      actor,
      at: now,
      note: report,
      details: { action },
      fileIds: files,
    });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: signal.status, report: true });
  notifySignal(action, signal, actor, { comment: report, files: filesOf(signal, eventId) });
  return signal;
}

/** Системная эскалация в Красный (вызывается только фоновым процессом). */
export function escalateToRed(signalId) {
  const signal = getRaw(signalId);
  return performAction(signalId, SIGNAL_ACTION.ESCALATE, SYSTEM_ACTOR, {
    comment:
      signal?.status === STATUS.RETURNED
        ? 'Автоэскалация: после возврата на доработку прошло 48 часов'
        : 'Автоэскалация: в работе дольше 48 часов',
  });
}

/** Сигналы, у которых истек срок отработки, — выборка для фонового процесса. */
export function findDueForEscalation(now = Date.now()) {
  const rows = sql.all(`SELECT * FROM signals WHERE status IN (?, ?) ORDER BY created_at`, [
    STATUS.YELLOW,
    STATUS.RETURNED,
  ]);
  return hydrate(rows).filter((signal) => isEscalationDue(signal, now));
}

/** Комментарий в переписке по сигналу: автор и сотрудники, файлы по желанию. */
export function addComment(signalId, actor, { text, fileIds = [] } = {}) {
  const before = load(signalId, actor);

  const verdict = canComment(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const comment = cleanComment(text, { required: true });
  const now = Date.now();
  let eventId = null;

  sql.transaction(() => {
    eventId = insertHistory(signalId, {
      kind: HISTORY_KIND.COMMENT,
      from: before.status,
      to: before.status,
      actor,
      at: now,
      note: comment,
      details: { action: SIGNAL_ACTION.COMMENT },
      fileIds: fileIdsOf({ fileIds }),
    });
    sql.run(`UPDATE signals SET updated_at = ? WHERE id = ?`, [now, signalId]);
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, comment: true });
  notifySignal(SIGNAL_ACTION.COMMENT, signal, actor, { comment, files: filesOf(signal, eventId) });
  return signal;
}

/* ------------------------- принятие в работу и правки ------------------------- */

export function setAssignee(signalId, actor, assign, userId = actor.id) {
  const before = load(signalId, actor);

  // Повторное принятие — не отказ в правах, а бессмысленный запрос.
  if (assign && isAssignedTo(before, actor.id)) throw badRequest('Вы уже в работе по этому сигналу');

  const verdict = assign ? canAssign(before, actor) : canRelease(before, actor, userId);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const now = Date.now();
  sql.transaction(() => {
    if (assign) {
      if (!addAssignee(ASSIGNABLE.SIGNAL, signalId, actor, now)) return;
      sql.run(`UPDATE users SET has_own_signals = 1 WHERE id = ?`, [actor.id]);
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

/**
 * Редактирование карточки с записью изменившихся полей в историю.
 *
 * Сюда же приходит доработка сигнала подрядчиком после возврата с входного
 * контроля (`resubmit: true`): правки, новые файлы и пояснение уходят одним
 * действием, сигнал возвращается на проверку, и участникам приходит одно
 * письмо, а не три.
 */
export function updateSignal(signalId, input, actor) {
  const before = load(signalId, actor);

  const verdict = canEdit(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const resubmit = input.resubmit === true;
  if (resubmit) {
    const allowed = can(SIGNAL_ACTION.RESUBMIT, before, actor);
    if (!allowed.allowed) throw forbidden(allowed.reason);
  }

  // Подрядчик автора не переписывает: имя закреплено за его учетной записью
  // при создании и правкой карточки не меняется.
  const contractorName =
    actor.role === ROLE.CONTRACTOR ? before.contractorName : String(input.contractorName ?? '').trim();

  const { valid, errors } = validateSignalInput({ ...input, contractorName });
  if (!valid) {
    const error = badRequest('Форма заполнена не полностью');
    error.errors = errors;
    throw error;
  }

  const next = {
    contractorName,
    sector: String(input.sector).trim(),
    description: String(input.description).trim(),
  };

  const changes = Object.keys(SIGNAL_FIELD_LABELS)
    .filter((field) => next[field] !== before[field])
    .map((field) => ({ field, label: SIGNAL_FIELD_LABELS[field], from: before[field], to: next[field] }));

  /*
   * Заметку к распределению правит только главный администратор, и только
   * она из полей карточки уезжает в историю отдельной записью: заметка —
   * сообщение кураторам, а не поле формы, и «кто и когда его переписал»
   * должно читаться в ленте само по себе, а не прятаться в diff правки.
   */
  const noteRequested = isSuperadminRole(actor.role) && input.assignmentNote !== undefined;
  const nextNote = noteRequested ? cleanNote(input.assignmentNote) : before.assignmentNote;
  const noteChanged = noteRequested && nextNote !== before.assignmentNote;

  const fileIds = fileIdsOf(input);
  const comment = cleanComment(input.comment);

  if (resubmit && !changes.length && !fileIds.length && !comment) {
    throw badRequest('Дополните сигнал: измените описание, приложите файлы или напишите, что сделано');
  }
  if (!resubmit && !changes.length && !noteChanged && !fileIds.length && !comment) return before;

  const now = Date.now();

  sql.transaction(() => {
    sql.run(`UPDATE signals SET contractor_name = ?, sector = ?, description = ?, updated_at = ? WHERE id = ?`, [
      next.contractorName,
      next.sector,
      next.description,
      now,
      signalId,
    ]);

    // Новые файлы ложатся к вложениям самого сигнала: это дополнение
    // к исходным данным, а не приложение к отдельной реплике.
    if (fileIds.length) attachFiles(ENTITY.SIGNAL, signalId, fileIds, actor);

    if (changes.length || fileIds.length) {
      const parts = [];
      if (changes.length) parts.push(`изменено: ${changes.map((change) => change.label.toLowerCase()).join(', ')}`);
      if (fileIds.length) parts.push(`добавлено вложений: ${fileIds.length}`);
      insertHistory(signalId, {
        kind: HISTORY_KIND.EDIT,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: `Сигнал дополнен — ${parts.join('; ')}`,
        details: { changes },
      });
    }

    if (noteChanged) {
      sql.run(`UPDATE signals SET assignment_note = ? WHERE id = ?`, [nextNote, signalId]);
      insertHistory(signalId, {
        kind: HISTORY_KIND.NOTE,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: nextNote ?? 'Заметка к распределению удалена',
        details: { from: before.assignmentNote, to: nextNote, edited: true },
      });
    }

    if (resubmit) {
      applyStatus(signalId, before, STATUS.INTAKE, now);
      insertHistory(signalId, {
        kind: HISTORY_KIND.STATUS,
        from: before.status,
        to: STATUS.INTAKE,
        actor,
        at: now,
        note: comment ?? 'Сигнал дополнен и направлен на повторную проверку',
        details: { action: SIGNAL_ACTION.RESUBMIT },
      });
    } else if (comment) {
      insertHistory(signalId, {
        kind: HISTORY_KIND.COMMENT,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: comment,
        details: { action: SIGNAL_ACTION.COMMENT },
      });
    }
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, edited: true });

  // Правка одной заметки кураторам — внутреннее дело сотрудников, без письма.
  const visibleChange = resubmit || changes.length || fileIds.length || comment;
  if (visibleChange) {
    const added = new Set(fileIds);
    notifySignal(resubmit ? SIGNAL_ACTION.RESUBMIT : SIGNAL_ACTION.UPDATE, signal, actor, {
      comment,
      changes,
      files: signal.attachments.filter((file) => added.has(file.id)),
    });
  }

  return signal;
}

/**
 * Сектор из последнего сигнала этого автора — для подстановки в форму
 * создания. Люди подают проблемы по одному и тому же объекту подряд,
 * и перепечатывать «Блок Б, 3 этаж» каждый раз незачем.
 */
export function lastSectorOf(authorId) {
  const row = sql.get(`SELECT sector FROM signals WHERE author_id = ? ORDER BY created_at DESC LIMIT 1`, [authorId]);
  return row?.sector ?? null;
}

/* ------------------------- индикатор новых изменений -------------------------- */

/**
 * Запомнить, что пользователь открывал карточку. Индикатор на карточке
 * сравнивает эту метку с лентой истории, поэтому «сбросить кружок» —
 * это ровно одна запись сюда.
 */
export function markSeen(signalId, userId, at = Date.now()) {
  if (!getRaw(signalId)) throw notFound('Сигнал не найден');
  sql.run(
    `INSERT INTO signal_views (user_id, signal_id, seen_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, signal_id) DO UPDATE SET seen_at = excluded.seen_at`,
    [userId, signalId, at],
  );
  return { signalId, seenAt: at };
}

/**
 * Число изменений по каждому сигналу с момента последнего открытия карточки
 * этим пользователем. Собственные действия не считаются: показывать человеку
 * непрочитанным то, что он сам только что сделал, бессмысленно.
 *
 * @returns {Record<string, number>} только сигналы с ненулевым счетчиком
 */
export function unreadFor(userId, signalIds) {
  if (!signalIds.length) return {};

  const placeholders = signalIds.map(() => '?').join(', ');
  const rows = sql.all(
    `SELECT h.signal_id AS id, COUNT(*) AS n
       FROM signal_history h
       LEFT JOIN signal_views v ON v.signal_id = h.signal_id AND v.user_id = ?
      WHERE h.signal_id IN (${placeholders})
        AND h.by_id <> ?
        AND h.at > COALESCE(v.seen_at, 0)
      GROUP BY h.signal_id`,
    [userId, ...signalIds, userId],
  );

  return Object.fromEntries(rows.filter((row) => row.n > 0).map((row) => [row.id, row.n]));
}

/**
 * Карточка в том виде, в каком ее можно отдать подрядчику.
 *
 * Интерфейс и так прячет внутреннюю кухню, но прятать в разметке мало:
 * ответ API открывается в любой вкладке разработчика. Поэтому заметка
 * кураторам и внутренние записи ленты срезаются здесь, на сервере.
 *
 * Имена сотрудников в публичных записях остаются: подрядчик ведет с ними
 * переписку по сигналу и получает письма о каждом их действии.
 */
const CONTRACTOR_HISTORY_KINDS = new Set(PUBLIC_HISTORY_KINDS);

export function forContractor(signal) {
  if (!signal) return signal;
  return {
    ...signal,
    assignmentNote: null,
    history: (signal.history ?? [])
      .filter((entry) => CONTRACTOR_HISTORY_KINDS.has(entry.kind))
      .map((entry) => ({
        at: entry.at,
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        byName: entry.byName,
        byRole: entry.byRole,
        note: entry.note,
        details: entry.details ? { action: entry.details.action, changes: entry.details.changes } : undefined,
        files: entry.files,
      })),
  };
}

/**
 * Сигнал, к записи ленты которого приложен файл, — если сама запись видна
 * этому пользователю. Нужно для проверки права на скачивание вложения.
 */
export function signalOfEvent(eventId, actor) {
  const row = sql.get(`SELECT signal_id, kind FROM signal_history WHERE id = ?`, [Number(eventId)]);
  if (!row) return null;
  if (actor?.role === ROLE.CONTRACTOR && !CONTRACTOR_HISTORY_KINDS.has(row.kind)) return null;
  return row.signal_id;
}

/** Отображаемое имя автора — для карточки в панели администратора. */
export function authorLabel(signal) {
  const user = findUser(signal.authorId);
  if (!user) return `Удаленный пользователь · ${signal.authorId}`;
  if (user.role === ROLE.CONTRACTOR) return `${user.companyName} · ${user.fullName}`;
  return `${user.displayName} · администратор`;
}
