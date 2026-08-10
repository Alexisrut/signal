/**
 * Экспорт в Excel.
 *
 * Данные берутся напрямую из SQL с сортировкой ORDER BY created_at DESC
 * (см. queryForExport в сервисах) и с учетом активных фильтров UI.
 * Колонки типизированы: даты уходят как Date с числовым форматом, остальное — как текст/число.
 */

import ExcelJS from 'exceljs';

import * as signalsService from './signals.js';
import { sql } from '../db.js';
import { ENTITY } from './files.js';

import {
  STATUS_META,
  categoryLabel,
} from '../../shared/constants.js';

const DATE_FORMAT = 'dd.mm.yyyy hh:mm';

function attachmentCounts(entityType) {
  const rows = sql.all(
    `SELECT entity_id, COUNT(*) AS n FROM attachments WHERE entity_type = ? GROUP BY entity_id`,
    [entityType],
  );
  return new Map(rows.map((row) => [row.entity_id, row.n]));
}

/** Исполнители одной строкой + момент, когда сущность впервые взяли в работу. */
function assigneeSummary(entityType) {
  const rows = sql.all(
    `SELECT entity_id, GROUP_CONCAT(user_name, ', ') AS names, MIN(assigned_at) AS first_at
       FROM (SELECT * FROM assignments WHERE entity_type = ? ORDER BY assigned_at)
      GROUP BY entity_id`,
    [entityType],
  );
  return new Map(rows.map((row) => [row.entity_id, { names: row.names, firstAt: row.first_at }]));
}

function authorNames() {
  const rows = sql.all(`SELECT id, display_name, role FROM users`);
  return new Map(rows.map((row) => [row.id, `${row.display_name}`]));
}

function styleSheet(sheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

async function toBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Отчет по сигналам с учетом фильтров дашборда и категорий, доступных пользователю. */
export async function buildSignalsWorkbook(filters, actor) {
  const rows = signalsService.queryForExport(filters, actor);
  const counts = attachmentCounts(ENTITY.SIGNAL);
  const assignees = assigneeSummary(ENTITY.SIGNAL);
  const authors = authorNames();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Система мониторинга сигналов';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Сигналы');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 30 },
    { header: 'Категория', key: 'category', width: 26 },
    { header: 'Подрядчик', key: 'contractor', width: 28 },
    { header: 'Сектор', key: 'sector', width: 24 },
    { header: 'Описание', key: 'description', width: 60 },
    { header: 'Статус', key: 'status', width: 22 },
    { header: 'Исполнители', key: 'assignee', width: 30 },
    { header: 'Принят в работу', key: 'assignedAt', width: 20, style: { numFmt: DATE_FORMAT } },
    { header: 'Автор', key: 'author', width: 24 },
    { header: 'Создан', key: 'createdAt', width: 20, style: { numFmt: DATE_FORMAT } },
    { header: 'Обновлен', key: 'updatedAt', width: 20, style: { numFmt: DATE_FORMAT } },
    { header: 'Вложений', key: 'attachments', width: 12 },
  ];

  for (const row of rows) {
    sheet.addRow({
      id: String(row.id),
      category: categoryLabel(row.category),
      contractor: String(row.contractor_name),
      sector: String(row.sector),
      description: String(row.description),
      status: STATUS_META[row.status]?.label ?? String(row.status),
      assignee: assignees.get(row.id)?.names ?? 'не принят',
      assignedAt: assignees.get(row.id) ? new Date(assignees.get(row.id).firstAt) : null,
      author: authors.get(row.author_id) ?? String(row.author_id),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      attachments: counts.get(row.id) ?? 0,
    });
  }

  styleSheet(sheet);
  return { buffer: await toBuffer(workbook), rows: rows.length };
}

/** Человекочитаемое имя файла отчета с датой формирования. */
export function reportFilename(prefix) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;
}
