/**
 * Транспорт почты.
 *
 * Если в окружении задан SMTP_HOST — письма уходят по-настоящему через SMTP.
 * Если нет — включается dev-инбокс: письмо всё равно собирается настоящим
 * MIME-сообщением, но вместо отправки сохраняется в `data/mailbox/*.eml`
 * и доступно для просмотра по /dev/mailbox. Переключение — одна переменная
 * окружения, код отправки при этом не меняется.
 */

import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

import { MAILBOX_DIR, SMTP, SMTP_CONFIGURED } from '../config.js';
import { sql } from '../db.js';
import { uid } from '../crypto.js';

const transport = SMTP_CONFIGURED
  ? nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.secure,
      auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

export const deliveryMode = SMTP_CONFIGURED ? 'smtp' : 'dev-inbox';

function safeSlug(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
}

/**
 * @param {{to: string, subject: string, html: string, text: string, kind: string, entityId?: string}} message
 * @returns {Promise<{ok: boolean, id: string, deliveredBy: string, filePath?: string, error?: string}>}
 */
export async function sendMail(message) {
  const id = uid('mail');
  const createdAt = Date.now();

  const record = {
    id,
    to: message.to,
    subject: message.subject,
    kind: message.kind,
    entityId: message.entityId ?? null,
    deliveredBy: deliveryMode,
    filePath: null,
    error: null,
  };

  try {
    const info = await transport.sendMail({
      from: SMTP.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (!SMTP_CONFIGURED) {
      const file = path.join(MAILBOX_DIR, `${createdAt}-${safeSlug(message.to)}-${id}.eml`);
      fs.writeFileSync(file, info.message);
      record.filePath = file;
    }
  } catch (error) {
    record.error = error?.message ?? String(error);
    console.error(`[mail] не удалось отправить письмо на ${message.to}: ${record.error}`);
  }

  sql.run(
    `INSERT INTO mail_log (id, to_email, subject, kind, entity_id, delivered_by, file_path, error, html, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.to,
      record.subject,
      record.kind,
      record.entityId,
      record.deliveredBy,
      record.filePath,
      record.error,
      message.html,
      createdAt,
    ],
  );

  return { ok: !record.error, ...record };
}

export function listMailLog(limit = 50) {
  return sql.all(
    `SELECT id, to_email, subject, kind, entity_id, delivered_by, error, created_at
       FROM mail_log ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export function getMail(id) {
  return sql.get(`SELECT * FROM mail_log WHERE id = ?`, [id]);
}
