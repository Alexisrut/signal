/**
 * SQL-хранилище (SQLite). Схема, первичный посев и тонкий адаптер над драйвером.
 *
 * Драйвер — node-sqlite3-wasm: настоящий SQLite, скомпилированный в WebAssembly,
 * без нативной сборки. Весь код работает через адаптер `sql` с позиционными
 * параметрами `?`, поэтому замена драйвера — правка одного этого файла.
 */

import fs from 'node:fs';
import sqlite from 'node-sqlite3-wasm';

import { DATA_DIR, UPLOADS_DIR, MAILBOX_DIR, DB_PATH } from './config.js';
import { DEFAULT_ADMIN, DEFAULT_NOTIFY, ROLE, STATUS } from '../shared/constants.js';
import { hashPassword, randomSalt, uid } from './crypto.js';

const { Database } = sqlite;

for (const dir of [DATA_DIR, UPLOADS_DIR, MAILBOX_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const connection = new Database(DB_PATH);
connection.exec('PRAGMA foreign_keys = ON');

/** Тонкий адаптер: единственная точка соприкосновения приложения с драйвером. */
export const sql = {
  exec: (statements) => connection.exec(statements),
  run: (query, params = []) => connection.run(query, params),
  get: (query, params = []) => connection.get(query, params),
  all: (query, params = []) => connection.all(query, params),

  /** Атомарная транзакция: либо применяются все запросы, либо ни один. */
  transaction(fn) {
    connection.exec('BEGIN');
    try {
      const result = fn();
      connection.exec('COMMIT');
      return result;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  },

  close: () => connection.close(),
};

sql.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    role              TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    login             TEXT UNIQUE,
    email             TEXT UNIQUE,
    company_name      TEXT,
    full_name         TEXT,
    password_salt     TEXT,
    password_hash     TEXT,
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    categories        TEXT,
    notify            TEXT,
    /*
     * Был ли у пользователя хоть один свой сигнал — созданный им или
     * назначенный на него. Флаг «залипающий»: вкладка «Мои сигналы»
     * появляется с первым сигналом и больше не пропадает, даже если
     * человека потом сняли со всех задач.
     */
    has_own_signals   INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    created_by        TEXT
  );

  CREATE TABLE IF NOT EXISTS signals (
    id              TEXT PRIMARY KEY,
    author_id       TEXT NOT NULL,
    author_role     TEXT NOT NULL,
    category        TEXT,
    contractor_name TEXT NOT NULL,
    sector          TEXT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL,
    distributed_at  INTEGER,
    closed_at       INTEGER,
    paused_ms       INTEGER NOT NULL DEFAULT 0,
    assignment_note TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_author   ON signals(author_id);
  CREATE INDEX IF NOT EXISTS idx_signals_status   ON signals(status);
  CREATE INDEX IF NOT EXISTS idx_signals_created  ON signals(created_at DESC);

  CREATE TABLE IF NOT EXISTS signal_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    at          INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'status',
    status_from TEXT,
    status_to   TEXT NOT NULL,
    by_id       TEXT NOT NULL,
    by_name     TEXT NOT NULL,
    by_role     TEXT NOT NULL,
    note        TEXT,
    details     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_history_signal ON signal_history(signal_id, at);

  CREATE TABLE IF NOT EXISTS files (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    mime         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    url          TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    uploaded_by  TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity_type, entity_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS assignments (
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, entity_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_assignments_entity ON assignments(entity_type, entity_id, assigned_at);

  /*
   * Отметки просмотра карточек. Индикатор «сколько изменений с прошлого захода»
   * считается сравнением истории сигнала с этой меткой, поэтому она нужна
   * на пару «пользователь + сигнал», а не на сигнал целиком.
   */
  CREATE TABLE IF NOT EXISTS signal_views (
    user_id   TEXT NOT NULL,
    signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    seen_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, signal_id)
  );

  CREATE INDEX IF NOT EXISTS idx_views_user ON signal_views(user_id);

  CREATE TABLE IF NOT EXISTS email_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mail_log (
    id           TEXT PRIMARY KEY,
    to_email     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    entity_id    TEXT,
    delivered_by TEXT NOT NULL,
    file_path    TEXT,
    error        TEXT,
    html         TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_log(created_at DESC);
`);

/* --------------------------------- миграции ---------------------------------- */

function hasColumn(table, column) {
  return sql.all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function addColumn(table, column, definition) {
  if (hasColumn(table, column)) return false;
  sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.info(`[db] миграция: ${table}.${column}`);
  return true;
}

/**
 * Догоняющие миграции для баз, созданных прошлыми версиями. На чистой базе
 * все проверки просто ничего не делают.
 */
function migrate() {
  for (const [column, definition] of [
    ['company_name', 'TEXT'],
    ['full_name', 'TEXT'],
    ['categories', 'TEXT'],
    ['notify', 'TEXT'],
  ]) {
    addColumn('users', column, definition);
  }

  // Залипающий признак «свои сигналы были»: на старой базе выводим его
  // из уже существующих авторств и назначений.
  if (addColumn('users', 'has_own_signals', 'INTEGER NOT NULL DEFAULT 0')) {
    sql.run(`UPDATE users SET has_own_signals = 1 WHERE id IN (SELECT DISTINCT author_id FROM signals)`);
    sql.run(`UPDATE users SET has_own_signals = 1 WHERE id IN (SELECT DISTINCT user_id FROM assignments)`);
  }

  addColumn('signals', 'distributed_at', 'INTEGER');
  addColumn('signals', 'category', 'TEXT');
  addColumn('signals', 'assignment_note', 'TEXT');

  // Пауза и момент закрытия появились вместе с возобновлением сигналов.
  // На старой базе закрытым сигналам проставляем время последнего изменения:
  // другого следа о моменте закрытия там нет.
  if (addColumn('signals', 'closed_at', 'INTEGER')) {
    sql.run(`UPDATE signals SET closed_at = updated_at WHERE status IN (?, ?) AND closed_at IS NULL`, [
      STATUS.GREEN,
      STATUS.GRAY,
    ]);
  }
  addColumn('signals', 'paused_ms', 'INTEGER NOT NULL DEFAULT 0');

  // Линии превратились в категории: старые значения переносим по смыслу,
  // а сигналы без линии остаются нераспределенными.
  if (hasColumn('signals', 'line')) {
    sql.run(`UPDATE signals SET category = 'supply' WHERE category IS NULL AND line = 'supply'`);
    sql.run(`UPDATE signals SET category = 'design' WHERE category IS NULL AND line = 'design'`);
    sql.run(`UPDATE signals SET category = 'admin_finance' WHERE category IS NULL AND line = 'legal'`);
    sql.run(`UPDATE signals SET distributed_at = updated_at WHERE category IS NOT NULL AND distributed_at IS NULL`);

    try {
      sql.exec(`ALTER TABLE signals DROP COLUMN line`);
    } catch (error) {
      console.warn(`[db] не удалось убрать signals.line: ${error.message}`);
    }
    console.info('[db] миграция: линии сигналов переведены в категории');
  }

  // Роль главного администратора: первым его получает стартовая учетная запись.
  const hasSuper = sql.get(`SELECT id FROM users WHERE role = ?`, [ROLE.SUPERADMIN]);
  if (!hasSuper) {
    const promoted = sql.get(`SELECT id, login FROM users WHERE role = ? ORDER BY created_at LIMIT 1`, [ROLE.ADMIN]);
    if (promoted) {
      sql.run(`UPDATE users SET role = ? WHERE id = ?`, [ROLE.SUPERADMIN, promoted.id]);
      console.info(`[db] миграция: «${promoted.login}» стал главным администратором`);
    }
  }
}

migrate();

// Индекс создается после миграций: на старой базе колонки category еще нет.
sql.exec(`CREATE INDEX IF NOT EXISTS idx_signals_category ON signals(category)`);

/** Первичный посев: главный администратор, если в системе нет ни одного. */
export function seedDefaultAdmin() {
  const { n } = sql.get(`SELECT COUNT(*) AS n FROM users WHERE role IN (?, ?)`, [ROLE.ADMIN, ROLE.SUPERADMIN]);
  if (n > 0) return null;

  const salt = randomSalt();
  const admin = {
    id: uid('adm'),
    login: DEFAULT_ADMIN.login,
    email: process.env.DEFAULT_ADMIN_EMAIL || DEFAULT_ADMIN.email,
    displayName: DEFAULT_ADMIN.displayName,
  };

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, password_salt, password_hash,
                        is_email_verified, categories, notify, has_own_signals, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, 'system')`,
    [
      admin.id,
      ROLE.SUPERADMIN,
      admin.displayName,
      admin.login,
      admin.email,
      salt,
      hashPassword(DEFAULT_ADMIN.password, salt),
      JSON.stringify([]),
      JSON.stringify(DEFAULT_NOTIFY),
      Date.now(),
    ],
  );

  return admin;
}

/** Чистка протухших сессий и токенов — вызывается при старте. */
export function cleanupExpired() {
  const now = Date.now();
  sql.run(`DELETE FROM sessions WHERE expires_at < ?`, [now]);
  sql.run(`DELETE FROM email_tokens WHERE expires_at < ? AND used_at IS NULL`, [now]);
}
