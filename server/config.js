/**
 * Конфигурация сервера. Все секреты берутся только из окружения:
 * ни один пароль не хранится в коде и не попадает в репозиторий.
 *
 * Значения подхватываются из файла `.env` в корне проекта (он в .gitignore),
 * а переменные, заданные в самом окружении, имеют приоритет над файлом —
 * так продакшен-настройки и секреты Codespaces перекрывают локальные.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');

/** Минимальный разбор .env — без зависимостей и без перезаписи окружения. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    const quoted = value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    if (key && process.env[key] === undefined) process.env[key] = value;
  }

  return true;
}

export const ENV_FILE_LOADED = loadEnvFile(path.join(ROOT_DIR, '.env'));

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const MAILBOX_DIR = path.join(DATA_DIR, 'mailbox');
export const DB_PATH = path.join(DATA_DIR, 'signal-monitor.db');

export const PORT = Number(process.env.PORT) || 5175;

/**
 * Интерфейс, на котором слушает сервер.
 *
 * По умолчанию — только петля: наружу приложение смотрит через nginx, и порт
 * 5175 не должен быть доступен из интернета в обход TLS. Если сервер живет
 * в контейнере и обращаться к нему нужно снаружи — HOST=0.0.0.0.
 */
export const HOST = process.env.HOST || '127.0.0.1';

/** Базовый URL приложения — подставляется в ссылки внутри писем. */
export const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

/** Работает ли приложение по HTTPS — отсюда берутся флаг Secure и HSTS. */
export const IS_HTTPS = APP_URL.startsWith('https://');

/**
 * Доверять ли заголовку X-Forwarded-For при определении адреса клиента.
 *
 * Включать ТОЛЬКО когда перед приложением стоит обратный прокси и порт
 * приложения закрыт снаружи: иначе любой сможет подделать свой адрес
 * и обойти ограничение частоты запросов.
 */
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const smtpUser = process.env.SMTP_USER || '';

/**
 * SMTP берется из окружения. Если хост не задан — работает dev-инбокс:
 * письма складываются на диск в формате .eml и открываются в браузере.
 *
 * Для mail.ru: host `smtp.mail.ru`, port 465, secure `true`, пароль —
 * «для внешних приложений» из настроек ящика, а не основной пароль.
 */
export const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 465,
  // Порт 465 — SSL с первого байта, 587 — STARTTLS. Признак выводится из порта,
  // если явно не задан, иначе легко получить «непонятно почему не коннектится».
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (Number(process.env.SMTP_PORT) || 465) === 465,
  user: smtpUser,
  pass: process.env.SMTP_PASS || '',
  // mail.ru отклоняет письмо, если адрес в From не совпадает с авторизованным
  // ящиком, поэтому по умолчанию подставляем именно его.
  from: process.env.MAIL_FROM || (smtpUser ? `Мониторинг сигналов <${smtpUser}>` : 'Мониторинг сигналов <no-reply@signal.local>'),
};

export const SMTP_CONFIGURED = Boolean(SMTP.host);

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
