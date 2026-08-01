/** Загрузка (multipart/form-data) и отдача файлов. */

import Busboy from 'busboy';

import { sendJson, badRequest, contentDisposition } from '../http.js';
import { storeFile, openFileStream } from '../domain/files.js';
import { MAX_FILE_SIZE } from '../../shared/constants.js';

const MAX_FILES_PER_REQUEST = 10;

/** Разбор multipart-запроса в память с жестким лимитом на размер каждого файла. */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      reject(badRequest('Ожидается multipart/form-data'));
      return;
    }

    const busboy = Busboy({
      headers: req.headers,
      // Без явной кодировки busboy читает имена файлов как latin1 и ломает кириллицу.
      defParamCharset: 'utf8',
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_REQUEST },
    });

    const files = [];
    let failed = null;

    busboy.on('file', (_field, stream, info) => {
      const chunks = [];
      let truncated = false;

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
        failed ??= badRequest(`Файл «${info.filename}» превышает лимит размера`);
      });
      stream.on('end', () => {
        if (!truncated) {
          files.push({ filename: info.filename, mime: info.mimeType, buffer: Buffer.concat(chunks) });
        }
      });
    });

    busboy.on('filesLimit', () => {
      failed ??= badRequest(`За один раз можно загрузить не более ${MAX_FILES_PER_REQUEST} файлов`);
    });

    busboy.on('error', reject);
    busboy.on('close', () => (failed ? reject(failed) : resolve(files)));

    req.pipe(busboy);
  });
}

export async function uploadFiles(req, res, { actor }) {
  const parsed = await parseMultipart(req);
  if (!parsed.length) throw badRequest('Файлы не переданы');

  const files = parsed.map((file) => storeFile(file, actor));
  sendJson(res, 201, { files });
}

export function downloadFile(req, res, { params }) {
  const { row, stream } = openFileStream(params.id);

  res.writeHead(200, {
    'Content-Type': row.mime,
    'Content-Length': row.size,
    'Content-Disposition': contentDisposition(row.filename),
    'Cache-Control': 'private, max-age=600',
  });
  stream.pipe(res);
}
