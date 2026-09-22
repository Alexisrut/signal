#!/usr/bin/env bash
#
# Локальный запуск системы мониторинга сигналов.
#
#   ./run.sh                обычный запуск, письма уходят через SMTP из .env
#   ./run.sh --dev-mail     письма никуда не уходят, складываются в data/mailbox
#   PORT=5180 ./run.sh      другой порт
#
# Останов — Ctrl+C.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5175}"
DEV_MAIL=0

for arg in "$@"; do
  case "$arg" in
    --dev-mail) DEV_MAIL=1 ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный параметр: $arg (см. ./run.sh --help)" >&2; exit 1 ;;
  esac
done

fail() { echo "ОШИБКА: $*" >&2; exit 1; }

# --- Node ---------------------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "node не найден. Установите Node.js 18 или новее."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "нужен Node.js 18+, установлен $(node -v)."

# --- Зависимости --------------------------------------------------------------
# Проверяем не сам каталог, а конкретный пакет: оборванная установка оставляет
# node_modules на месте, но с дырами в дереве.
if [ ! -d node_modules/node-sqlite3-wasm ]; then
  echo "Зависимости не установлены — ставлю (npm ci)..."
  npm ci --omit=dev || fail "установка зависимостей не удалась."
  echo
fi

# --- Настройки ----------------------------------------------------------------
if [ ! -f .env ]; then
  echo "Файла .env нет — создаю из шаблона .env.example."
  echo "Почта работать не будет, пока не заполните SMTP_PASS."
  cp .env.example .env
  chmod 600 .env
  echo
fi

# --- Порт ---------------------------------------------------------------------
# Внятное сообщение вместо стека EADDRINUSE из недр Node.
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ОШИБКА: порт $PORT уже занят:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo >&2
  echo "Остановите процесс либо запустите на другом порту: PORT=5180 ./run.sh" >&2
  exit 1
fi

# --- Почта --------------------------------------------------------------------
# Пустой SMTP_HOST в окружении перекрывает значение из .env: разбор .env не
# трогает переменные, которые уже заданы. Приложение видит пустой хост и
# переключается на dev-инбокс — письма пишутся в data/mailbox как .eml.
if [ "$DEV_MAIL" = 1 ]; then
  export SMTP_HOST=""
  echo "Режим dev-инбокса: письма НЕ отправляются, их можно смотреть на /dev/mailbox"
elif grep -qE '^SMTP_HOST=.+' .env 2>/dev/null; then
  echo "ВНИМАНИЕ: настроен реальный SMTP — письма уйдут живым адресатам."
  echo "          Для локальных опытов запускайте: ./run.sh --dev-mail"
fi

# Баннер и ссылки в письмах берут адрес из APP_URL, про подмену порта он не
# знает. Приводим в соответствие, иначе в выводе будет один порт, а слушать
# сервер будет другой.
if grep -q '^APP_URL=http://localhost:' .env 2>/dev/null; then
  export APP_URL="http://localhost:$PORT"
fi

echo
export PORT
exec node server/index.js
