/** Утилиты HTTP-слоя: тело запроса, куки, JSON-ответы, отдача статики. */

import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}

export function forbidden(message) {
  return new HttpError(403, message);
}

export function notFound(message = 'Не найдено') {
  return new HttpError(404, message);
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

export function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

const MAX_JSON_BODY = 1024 * 1024;

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        reject(badRequest('Тело запроса слишком большое'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(badRequest('Некорректный JSON'));
      }
    });

    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

export function appendCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);

  const existing = res.getHeader('Set-Cookie');
  const cookie = parts.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : [cookie]);
}

export function clearCookie(res, name) {
  appendCookie(res, name, '', { maxAge: 0 });
}

/** Отдача статического файла с защитой от выхода за пределы каталога. */
export function serveStatic(res, rootDir, relativePath) {
  const filePath = path.resolve(rootDir, relativePath);
  if (!filePath.startsWith(path.resolve(rootDir))) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/** Имя файла для Content-Disposition: ASCII-фолбэк + RFC 5987 для кириллицы. */
export function contentDisposition(filename) {
  const fallback = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
