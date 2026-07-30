/**
 * Минимальный статический сервер без зависимостей.
 *
 * Приложение нужно открывать по http://localhost, а не через file://:
 * события `storage` между вкладками и Web Crypto (хеширование паролей)
 * работают только в нормальном secure-origin.
 *
 *   node server.js            → http://localhost:5173
 *   PORT=8080 node server.js  → http://localhost:8080
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5175;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);

  // Защита от выхода за пределы каталога приложения.
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    send(res, 200, data, { 'Content-Type': type });
  });
});

server.listen(PORT, () => {
  console.log(`Система мониторинга сигналов: http://localhost:${PORT}`);
});
