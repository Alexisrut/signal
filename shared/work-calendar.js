/**
 * РАБОЧИЙ КАЛЕНДАРЬ: время таймеров без выходной паузы.
 *
 * Офис не работает с пятницы 18:00 до понедельника 09:00 (WORK_SCHEDULE).
 * Таймеры сигналов на это время останавливаются: срок эскалации и время
 * решения считаются только по «рабочей» части недели. Будние ночи в срок
 * входят — пауза только одна, на выходные.
 *
 * Модуль общий для сервера и браузера, поэтому граница выходных одна
 * для всех и не зависит от часового пояса машины.
 *
 * Устройство. Неделя, отсчитанная от конца паузы (пн 09:00), — это отрезок
 * рабочего времени длиной WORK_PER_WEEK (105 ч), за которым идет пауза.
 * Функция `worked(t)` — сколько рабочего времени набежало от опорной точки
 * до момента t; она неубывающая и стоит на месте внутри паузы. Через нее
 * всё остальное — разность двух значений или обратный поиск момента.
 */

import { WORK_SCHEDULE } from './constants.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Смещение момента от понедельника 00:00 в пределах недели. */
const weekOffset = ({ weekday, hour, minute = 0 }) => ((weekday + 6) % 7) * DAY + hour * HOUR + minute * MINUTE;

const PAUSE_START = weekOffset(WORK_SCHEDULE.pauseStart);
const PAUSE_END = weekOffset(WORK_SCHEDULE.pauseEnd);

/** Рабочего времени в неделе: от конца паузы до ее начала. */
export const WORK_PER_WEEK = (((PAUSE_START - PAUSE_END) % WEEK) + WEEK) % WEEK || WEEK;

/** Опорная точка — конец паузы в UTC. 5 января 1970 года — понедельник. */
const ANCHOR = Date.UTC(1970, 0, 5) + PAUSE_END - WORK_SCHEDULE.utcOffsetMinutes * MINUTE;

/** Рабочее время от опорной точки до момента t. */
function worked(t) {
  const sinceAnchor = t - ANCHOR;
  const weeks = Math.floor(sinceAnchor / WEEK);
  return weeks * WORK_PER_WEEK + Math.min(sinceAnchor - weeks * WEEK, WORK_PER_WEEK);
}

/** Сколько рабочего времени между двумя моментами (0, если отрезок пустой). */
export function workingMs(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return worked(to) - worked(from);
}

/**
 * Момент, когда от `from` наберется `ms` рабочего времени: самый ранний
 * из возможных — если срок истекает ровно в пятницу 18:00, это пятница,
 * а не понедельник. Отрицательный `ms` ведет назад во времени: так срок,
 * уже истекший, остается в прошлом.
 */
export function addWorkingMs(from, ms) {
  const target = worked(from) + ms;
  const weeks = Math.ceil(target / WORK_PER_WEEK) - 1;
  const moment = ANCHOR + weeks * WEEK + (target - weeks * WORK_PER_WEEK);
  return ms >= 0 ? Math.max(from, moment) : moment;
}

/** Идет ли сейчас рабочее время (таймеры тикают). */
export function isWorkingTime(t = Date.now()) {
  const sinceAnchor = t - ANCHOR;
  return sinceAnchor - Math.floor(sinceAnchor / WEEK) * WEEK < WORK_PER_WEEK;
}

/** Когда таймеры снова пойдут: конец текущей паузы либо сам момент, если пауза не идет. */
export function nextWorkStart(t = Date.now()) {
  if (isWorkingTime(t)) return t;
  return ANCHOR + (Math.floor((t - ANCHOR) / WEEK) + 1) * WEEK;
}

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const formatPoint = ({ weekday, hour, minute = 0 }) =>
  `${WEEKDAY_SHORT[weekday]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Подпись паузы для интерфейса: «с пт 18:00 до пн 09:00». */
export function pauseLabel() {
  return `с ${formatPoint(WORK_SCHEDULE.pauseStart)} до ${formatPoint(WORK_SCHEDULE.pauseEnd)}`;
}

/** Когда пауза заканчивается: «пн 09:00». */
export function resumeLabel() {
  return formatPoint(WORK_SCHEDULE.pauseEnd);
}
