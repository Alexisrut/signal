/**
 * SQL-хранилище (SQLite). Схема, первичный посев и тонкий адаптер над драйвером.
 *
 * Драйвер — node-sqlite3-wasm: настоящий SQLite, скомпилированный в WebAssembly,
 * без нативной сборки. Весь код работает через адаптер `sql` с позиционными
 * параметрами `?`, поэтому замена драйвера (better-sqlite3, node:sqlite) —
 * это правка одного этого файла.
 */

import fs from 'node:fs';
import sqlite from 'node-sqlite3-wasm';

import { DATA_DIR, UPLOADS_DIR, MAILBOX_DIR, DB_PATH } from './config.js';
import { DEFAULT_ADMIN, DEFAULT_ADMIN_SETTINGS, ROLE } from '../shared/constants.js';
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
    password_salt     TEXT,
    password_hash     TEXT,
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    settings          TEXT,
    created_at        INTEGER NOT NULL,
    created_by        TEXT
  );

  CREATE TABLE IF NOT EXISTS signals (
    id              TEXT PRIMARY KEY,
    author_id       TEXT NOT NULL,
    author_role     TEXT NOT NULL,
    line            TEXT,
    contractor_name TEXT NOT NULL,
    sector          TEXT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_author  ON signals(author_id);
  CREATE INDEX IF NOT EXISTS idx_signals_status  ON signals(status);
  CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at DESC);

  CREATE TABLE IF NOT EXISTS signal_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    at          INTEGER NOT NULL,
    status_from TEXT,
    status_to   TEXT NOT NULL,
    by_id       TEXT NOT NULL,
    by_name     TEXT NOT NULL,
    by_role     TEXT NOT NULL,
    note        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_history_signal ON signal_history(signal_id, at);

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    author_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

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

/** Первичный посев: администратор по умолчанию, если в системе нет ни одного. */
export function seedDefaultAdmin() {
  const { n } = sql.get(`SELECT COUNT(*) AS n FROM users WHERE role = ?`, [ROLE.ADMIN]);
  if (n > 0) return null;

  const salt = randomSalt();
  const admin = {
    id: uid('adm'),
    login: DEFAULT_ADMIN.login,
    email: DEFAULT_ADMIN.email,
    displayName: DEFAULT_ADMIN.displayName,
  };

  sql.run(
    `INSERT INTO users (id, role, display_name, login, email, password_salt, password_hash,
                        is_email_verified, settings, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      admin.id,
      ROLE.ADMIN,
      admin.displayName,
      admin.login,
      admin.email,
      salt,
      hashPassword(DEFAULT_ADMIN.password, salt),
      // Стартовая учетная запись помечена подтвержденной: иначе демо-стенд нельзя
      // открыть без настроенного SMTP. Все создаваемые далее администраторы
      // проходят обычную процедуру верификации по ссылке из письма.
      1,
      JSON.stringify(DEFAULT_ADMIN_SETTINGS),
      Date.now(),
      'system',
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
