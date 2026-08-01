/** Конфигурация сервера. Все секреты берутся только из окружения. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const MAILBOX_DIR = path.join(DATA_DIR, 'mailbox');
export const DB_PATH = path.join(DATA_DIR, 'signal-monitor.db');

export const PORT = Number(process.env.PORT) || 5175;

/** Базовый URL приложения — подставляется в ссылки внутри писем. */
export const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

/**
 * SMTP берется из окружения. Если хост не задан — работает dev-инбокс:
 * письма складываются на диск в формате .eml и открываются в браузере.
 */
export const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || 'Мониторинг сигналов <no-reply@signal.local>',
};

export const SMTP_CONFIGURED = Boolean(SMTP.host);

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
