/**
 * Таймеры без выходных: пауза с пятницы 18:00 до понедельника 09:00 (МСК).
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STATUS } from '../shared/constants.js';
import {
  addWorkingMs,
  isWorkingTime,
  nextWorkStart,
  workingMs,
  WORK_PER_WEEK,
} from '../shared/work-calendar.js';
import { escalationDueAt, escalationLeftMs, isEscalationDue, resolutionMs } from '../shared/state-machine.js';

const H = 3600_000;
/** Московское время → метка UTC. Ноябрь 2026: 13-е — пятница, 16-е — понедельник. */
const msk = (day, hour, minute = 0) => Date.UTC(2026, 10, day, hour - 3, minute);

test('в неделе 105 рабочих часов', () => {
  assert.equal(WORK_PER_WEEK, 105 * H);
  assert.equal(workingMs(msk(9, 9), msk(16, 9)), 105 * H);
});

test('граница паузы: пт 18:00 и пн 09:00 по Москве', () => {
  assert.equal(isWorkingTime(msk(13, 17, 59)), true);
  assert.equal(isWorkingTime(msk(13, 18)), false);
  assert.equal(isWorkingTime(msk(15, 12)), false);
  assert.equal(isWorkingTime(msk(16, 8, 59)), false);
  assert.equal(isWorkingTime(msk(16, 9)), true);
  // Будние ночи — рабочее время: пауза только на выходные.
  assert.equal(isWorkingTime(msk(11, 3)), true);
  assert.equal(nextWorkStart(msk(14, 12)), msk(16, 9));
  assert.equal(nextWorkStart(msk(12, 12)), msk(12, 12));
});

test('выходные не входят в отрезок', () => {
  // Пт 12:00 → пн 12:00: 6 ч в пятницу + 3 ч в понедельник.
  assert.equal(workingMs(msk(13, 12), msk(16, 12)), 9 * H);
  // Целиком внутри паузы — ноль.
  assert.equal(workingMs(msk(14, 0), msk(15, 23)), 0);
  assert.equal(workingMs(msk(16, 12), msk(13, 12)), 0);
});

test('срок, задевающий выходные, переносится на понедельник', () => {
  // Взят в работу в четверг 12:00: к пт 18:00 набежит 30 ч, остальные 18 ч — с пн 09:00.
  assert.equal(addWorkingMs(msk(12, 12), 48 * H), msk(17, 3));
  // Взят в пятницу вечером, уже в паузе: отсчет с понедельника 09:00.
  assert.equal(addWorkingMs(msk(13, 20), 48 * H), msk(18, 9));
  // Срок, истекающий ровно в пт 18:00, остается пятницей.
  assert.equal(addWorkingMs(msk(11, 18), 48 * H), msk(13, 18));
  // Нулевой срок в паузе — сам момент, а не прошлая пятница.
  assert.equal(addWorkingMs(msk(14, 12), 0), msk(14, 12));
  // Отрицательный срок (уже просрочен) — в прошлом.
  assert.ok(addWorkingMs(msk(12, 12), -H) < msk(12, 12));
});

const yellow = (since) => ({
  status: STATUS.YELLOW,
  createdAt: since - H,
  statusAt: since,
  pausedMs: 0,
  history: [
    { at: since - H, to: STATUS.INTAKE },
    { at: since, to: STATUS.YELLOW },
  ],
});

test('эскалация Желтого не наступает в выходные', () => {
  const signal = yellow(msk(12, 12)); // четверг 12:00
  assert.equal(escalationDueAt(signal, msk(14, 12)), msk(17, 3));
  assert.equal(isEscalationDue(signal, msk(15, 23)), false);
  assert.equal(isEscalationDue(signal, msk(17, 2, 59)), false);
  assert.equal(isEscalationDue(signal, msk(17, 3)), true);
  // В выходные остаток не уменьшается.
  assert.equal(escalationLeftMs(signal, msk(14, 0)), 18 * H);
  assert.equal(escalationLeftMs(signal, msk(15, 23)), 18 * H);
});

test('возвращенный на доработку: 48 ч с момента возврата без выходных', () => {
  const back = msk(13, 10); // пятница 10:00
  const signal = {
    status: STATUS.RETURNED,
    createdAt: msk(9, 10),
    statusAt: back,
    history: [
      { at: msk(9, 10), to: STATUS.INTAKE },
      { at: msk(9, 11), to: STATUS.YELLOW },
      { at: msk(10, 11), to: STATUS.CONFIRM },
      { at: back, to: STATUS.RETURNED },
    ],
  };
  // 8 ч в пятницу + 40 ч с пн 09:00 → ср 01:00.
  assert.equal(escalationDueAt(signal, msk(14, 0)), msk(18, 1));
});

test('время решения не растет в выходные', () => {
  const signal = { ...yellow(msk(13, 12)), createdAt: msk(13, 12) };
  assert.equal(resolutionMs(signal, msk(13, 18)), 6 * H);
  assert.equal(resolutionMs(signal, msk(15, 20)), 6 * H);
  assert.equal(resolutionMs(signal, msk(16, 10)), 7 * H);
});

test('пауза хранится в рабочем времени и вычитается один раз', () => {
  // Создан в пн 09:00, ждал подтверждения с пт 12:00 до пн 12:00 (9 рабочих часов), закрыт в пн 12:00.
  const signal = {
    status: STATUS.GREEN,
    createdAt: msk(9, 9),
    statusAt: msk(16, 12),
    pausedMs: workingMs(msk(13, 12), msk(16, 12)),
  };
  assert.equal(resolutionMs(signal), 105 * H + 3 * H - 9 * H);
});
