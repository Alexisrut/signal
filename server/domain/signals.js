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
  STATUS_META,
  SYSTEM_ACTOR,
  categoryLabel,
  isCategoryScopedRole,
  isSuperadminRole,
} from '../../shared/constants.js';
import {
  canAssign,
  canAssignOthers,
  canCurate,
  canDistribute,
  canEdit,
  canRelease,
  canReopen,
  canTransition,
  isAssignedTo,
  isEscalationDue,
  isTerminal,
  notificationEventFor,
  reopenTargetStatus,
  resolutionMs,
} from '../../shared/state-machine.js';
import { validateSignalInput } from '../../shared/validation.js';

/** Заметка к распределению: обрезаем и приводим к null, чтобы не хранить пустую строку. */
const MAX_NOTE_LENGTH = 1000;

function cleanNote(value) {
  const text = String(value ?? '').trim().slice(0, MAX_NOTE_LENGTH);
  return text || null;
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
    authorId: row.author_id,
    authorRole: row.author_role,
    category: row.category ?? null,
    contractorName: row.contractor_name,
    sector: row.sector,
    description: row.description,
    status: row.status,
    assignees,
    assignmentNote: row.assignment_note ?? null,
    distributedAt: row.distributed_at ?? null,
    closedAt: row.closed_at ?? null,
    // Время, проведенное в закрытом состоянии: вычитается из времени решения.
    pausedMs: row.paused_ms ?? 0,
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

/**
 * Задачи, за которые человек отвечает лично, — содержимое вкладки «Мои сигналы»
 * у руководителя и администратора. Закрытые задачи из нее не исчезают:
 * решенное остается в личном списке как история работы.
 */
export function listAssignedTo(userId) {
  return hydrate(
    sql.all(
      `SELECT s.* FROM signals s
         JOIN assignments a ON a.entity_id = s.id AND a.entity_type = ?
        WHERE a.user_id = ?
        ORDER BY s.updated_at DESC`,
      [ASSIGNABLE.SIGNAL, userId],
    ),
  );
}

/** Нераспределенные сигналы — содержимое раздела «Распределение». */
export function listUndistributed() {
  return hydrate(sql.all(`SELECT * FROM signals WHERE category IS NULL ORDER BY created_at`));
}

/**
 * Что сотрудник видит на дашборде: только распределенные сигналы.
 * Главный администратор видит все категории, администратор и руководитель —
 * закрепленные за ними; нераспределенные живут отдельно, в «Распределении».
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

/** Доступ с учетом роли: подрядчик видит свой, сотрудник — разрешенные категории. */
export function getForActor(id, actor) {
  const signal = getById(id);
  if (!signal) return null;

  if (actor.role === ROLE.SUPERADMIN) return signal;
  if (isCategoryScopedRole(actor.role)) {
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

  // Администратор и руководитель выгружают только то, что им видно.
  if (isCategoryScopedRole(actor?.role)) {
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

  sql.transaction(() => {
    sql.run(
      `INSERT INTO signals (id, author_id, author_role, category, contractor_name, sector, description,
                            status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        actor.id,
        actor.role,
        contractorName,
        String(input.sector).trim(),
        String(input.description).trim(),
        STATUS.YELLOW,
        now,
        now,
      ],
    );

    // Вкладка «Мои сигналы» у автора теперь есть навсегда.
    sql.run(`UPDATE users SET has_own_signals = 1 WHERE id = ?`, [actor.id]);

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

/**
 * Назначить категорию: раздел «Распределение» главного администратора.
 *
 * Вместе с категорией можно сразу выдать задачу нескольким руководителям
 * (в том числе курирующим другие категории) и приложить заметку — ее увидят
 * все ответственные за сигнал.
 */
export function distribute(signalId, category, actor, { assignees: people = [], note = null } = {}) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');

  const verdict = canDistribute(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);
  if (!CATEGORY_IDS.includes(category)) throw badRequest('Неизвестная категория');

  const categoryChanged = before.category !== category;
  const now = Date.now();

  if (categoryChanged) {
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
  }

  // Назначение исполнителей и заметка — самостоятельная операция: она
  // применима и при повторном распределении в ту же категорию.
  if (people.length || cleanNote(note)) return assignPeople(signalId, people, actor, note);

  return getById(signalId);
}

/**
 * Выдать задачу кураторам и приложить заметку.
 *
 * Куратором может стать только руководитель, за которым закреплена категория
 * сигнала. Проверка живет здесь, а не только в окне выбора: список на клиенте
 * подсказывает, а решает сервер.
 */
export function assignPeople(signalId, userIds, actor, note = null) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');
  assertVisible(before, actor);

  const verdict = canAssignOthers(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  // Повторное сохранение той же заметки не считается изменением: окно назначения
  // подставляет текущий текст, и без этой проверки каждое открытие плодило бы
  // одинаковые записи в истории.
  const raw = cleanNote(note);
  const text = raw && raw !== before.assignmentNote ? raw : null;

  const requested = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))];
  const people = requested.map((id) => findUser(id)).filter(Boolean);

  const rejected = people.filter((person) => !canCurate(person, before.category));
  if (rejected.length) {
    throw badRequest(
      `Куратором может быть только руководитель с категорией «${categoryLabel(before.category)}»: ` +
        rejected.map((person) => person.displayName).join(', '),
    );
  }
  if (requested.length && !people.length) throw badRequest('Ни один из выбранных руководителей не найден');
  if (!people.length && !text) return before;

  const now = Date.now();
  const added = [];

  sql.transaction(() => {
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
        note: `Задача назначена: ${added.map((person) => person.displayName).join(', ')}`,
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

    sql.run(`UPDATE signals SET updated_at = ? WHERE id = ?`, [now, signalId]);
  });

  publish('signal', { id: signalId, assigned: added.length });
  return getById(signalId);
}


/**
 * Видит ли пользователь конкретный сигнал. Обычный администратор ограничен
 * своими категориями, и это проверяется на каждой мутации, а не только в выборках:
 * иначе чужой сигнал остался бы доступен по прямому запросу с известным ID.
 */
function assertVisible(signal, actor) {
  if (actor.role === ROLE.SUPERADMIN || actor.role === ROLE.SYSTEM) return;

  if (isCategoryScopedRole(actor.role)) {
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
    // Момент закрытия фиксируется явно: время решения нельзя выводить
    // из updated_at, потому что закрытую карточку еще правят и комментируют.
    sql.run(`UPDATE signals SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?`, [
      to,
      isTerminal(to) ? now : null,
      now,
      signalId,
    ]);
    insertHistory(signalId, { kind: HISTORY_KIND.STATUS, from: before.status, to, actor, at: now, note });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: to });

  notifySignalEvent(notificationEventFor(before.status, to), signal, actor);

  return signal;
}

/**
 * ВОЗОБНОВЛЕНИЕ. Закрытый сигнал возвращается в ту активную фазу, из которой
 * его закрыли, а время простоя уходит в `paused_ms` — значит, счетчик времени
 * решения продолжается с того же места, а не стартует заново.
 */
export function reopenSignal(signalId, actor, note = null) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');
  assertVisible(before, actor);

  const verdict = canReopen(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

  const to = reopenTargetStatus(before);
  const now = Date.now();
  const pause = Math.max(0, now - (before.closedAt ?? now));
  const text = cleanNote(note);

  sql.transaction(() => {
    sql.run(`UPDATE signals SET status = ?, closed_at = NULL, paused_ms = paused_ms + ?, updated_at = ? WHERE id = ?`, [
      to,
      pause,
      now,
      signalId,
    ]);

    insertHistory(signalId, {
      kind: HISTORY_KIND.REOPEN,
      from: before.status,
      to,
      actor,
      at: now,
      note: text ?? `Сигнал возобновлен: «${STATUS_META[before.status].short}» → «${STATUS_META[to].short}»`,
      details: { pausedMs: pause },
    });
  });

  const signal = getById(signalId);
  publish('signal', { id: signalId, status: to, reopened: true });

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

/** Редактирование карточки с записью изменившихся полей в историю. */
export function updateSignal(signalId, input, actor) {
  const before = getById(signalId);
  if (!before) throw notFound('Сигнал не найден');
  assertVisible(before, actor);

  const verdict = canEdit(before, actor);
  if (!verdict.allowed) throw forbidden(verdict.reason);

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

  if (!changes.length && !noteChanged) return before;

  const now = Date.now();
  sql.transaction(() => {
    sql.run(`UPDATE signals SET contractor_name = ?, sector = ?, description = ?, updated_at = ? WHERE id = ?`, [
      next.contractorName,
      next.sector,
      next.description,
      now,
      signalId,
    ]);

    if (changes.length) {
      insertHistory(signalId, {
        kind: HISTORY_KIND.EDIT,
        from: before.status,
        to: before.status,
        actor,
        at: now,
        note: `Отредактировано: ${changes.map((change) => change.label.toLowerCase()).join(', ')}`,
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
  });

  publish('signal', { id: signalId, edited: true });
  return getById(signalId);
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

/** Отображаемое имя автора — для карточки в панели администратора. */
export function authorLabel(signal) {
  const user = findUser(signal.authorId);
  if (!user) return `Удаленный пользователь · ${signal.authorId}`;
  if (user.role === ROLE.CONTRACTOR) return `${user.companyName} · ${user.fullName}`;
  return `${user.displayName} · администратор`;
}
