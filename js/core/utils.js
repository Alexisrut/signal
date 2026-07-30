/** Мелкие утилиты без зависимостей от предметной области. */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += HEX[b];
  return out;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${randomHex(6)}`;
}

export function randomSalt() {
  return randomHex(16);
}

/**
 * Демонстрационное хеширование пароля (SHA-256 с солью).
 * Требует secure context — приложение отдается с http://localhost, этого достаточно.
 */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => HEX[b]).join('');
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Тег-шаблон: любая подстановка автоматически экранируется. */
export function html(strings, ...values) {
  return strings.reduce((acc, part, i) => {
    if (i === 0) return part;
    const raw = values[i - 1];
    const chunk = Array.isArray(raw) ? raw.join('') : escapeHtml(raw);
    return acc + chunk + part;
  }, '');
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(ts) {
  if (!ts) return '—';
  return dateFormatter.format(new Date(ts)).replace(', ', ' · ');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «2 дн 3 ч», «14 мин», «меньше минуты». */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days} ${plural(days, 'день', 'дня', 'дней')} ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`;
  return 'меньше минуты';
}

export function truncate(text, limit = 160) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function isBlank(value) {
  return String(value ?? '').trim().length === 0;
}
