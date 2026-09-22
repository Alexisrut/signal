#!/usr/bin/env bash
#
# Выкатка новой версии на боевой сервер. Запускается НА СЕРВЕРЕ.
#
#   ./deploy/deploy.sh              обычная выкатка
#   ./deploy/deploy.sh --dry-run    показать, что приедет, и выйти
#   ./deploy/deploy.sh --rollback   вернуться на предыдущую версию
#
# Скрипт намеренно отказывается работать при ручных правках в рабочем каталоге:
# «git pull» поверх них либо потеряет их молча, либо встанет конфликтом посреди
# выкатки. Правки должны приходить только через git.

set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE=signal-monitor
PREV_FILE=".deploy-previous"
DRY=0
ROLLBACK=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный параметр: $arg" >&2; exit 1 ;;
  esac
done

say()  { echo; echo "── $* ────────────────────────────────"; }
fail() { echo; echo "ОШИБКА: $*" >&2; exit 1; }

# --- Откат --------------------------------------------------------------------
if [ "$ROLLBACK" = 1 ]; then
  [ -f "$PREV_FILE" ] || fail "нет записи о предыдущей версии ($PREV_FILE)."
  PREV="$(cat "$PREV_FILE")"
  say "Откат на $PREV"
  git checkout -q "$PREV"
  sudo systemctl restart "$SERVICE"
  sleep 3
  systemctl is-active --quiet "$SERVICE" && echo "Откат выполнен, служба работает." \
    || fail "служба не поднялась даже после отката — смотрите journalctl -u $SERVICE -n 50"
  exit 0
fi

# --- Проверка чистоты ---------------------------------------------------------
say "Проверка рабочего каталога"
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY"
  echo
  fail "в рабочем каталоге есть правки, сделанные мимо git.
       Перенесите их в репозиторий, либо отбросьте: git checkout -- <файл>
       Выкатка поверх них потеряла бы изменения."
fi
echo "чисто"

# --- Что приедет --------------------------------------------------------------
say "Что нового на GitHub"
git fetch -q origin || fail "не удалось связаться с GitHub."
CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse origin/main)"

if [ "$CURRENT" = "$TARGET" ]; then
  echo "уже на последней версии ($(git log -1 --format=%h\ %s))"
  exit 0
fi

git log --oneline "$CURRENT..$TARGET"
echo
git diff --stat "$CURRENT..$TARGET"

[ "$DRY" = 1 ] && { echo; echo "(--dry-run: ничего не меняю)"; exit 0; }

# --- Предупреждения до изменений ----------------------------------------------
if ! git diff --quiet "$CURRENT..$TARGET" -- package-lock.json; then
  echo
  echo "ВНИМАНИЕ: изменился package-lock.json — состав зависимостей другой."
  echo "          Реестр npm с этого сервера недоступен, поэтому после выкатки"
  echo "          дерево node_modules нужно перенести файлом (deploy/README.md, шаг 3)."
fi

if ! git diff --quiet "$CURRENT..$TARGET" -- deploy/nginx-signal.vis.ru.conf; then
  echo
  echo "ВНИМАНИЕ: изменился конфиг nginx. После выкатки примените его вручную:"
  echo "          sudo cp deploy/nginx-signal.vis.ru.conf /etc/nginx/sites-available/signal.vis.ru"
  echo "          sudo nginx -t && sudo systemctl reload nginx"
fi

# --- Выкатка ------------------------------------------------------------------
echo "$CURRENT" > "$PREV_FILE"

say "Обновление кода"
git merge --ff-only origin/main || fail "быстрая перемотка невозможна — история разошлась."
git log -1 --format='теперь на %h %s'

# --- Руководства ---------------------------------------------------------------
# Каталог guides/ в репозитории — источник правды для /var/www/guides.
# Синхронизируем до перезапуска, чтобы один запрос пароля sudo покрыл оба шага.
if [ -d guides ]; then
  if ! diff -rq guides /var/www/guides >/dev/null 2>&1; then
    say "Обновление руководств"
    sudo mkdir -p /var/www/guides
    sudo cp guides/*.html /var/www/guides/
    sudo chown root:root /var/www/guides/*.html
    sudo chmod 644 /var/www/guides/*.html
    ls /var/www/guides
  fi
fi

say "Перезапуск службы"
sudo systemctl restart "$SERVICE"
sleep 3

# --- Проверка -----------------------------------------------------------------
say "Проверка"
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "Служба не поднялась. Последние строки журнала:"
  journalctl -u "$SERVICE" -n 20 --no-pager
  fail "выкатка неудачна. Откат: ./deploy/deploy.sh --rollback"
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5175/api/whoami || echo 000)"
if [ "$CODE" != "200" ]; then
  echo "Приложение отвечает $CODE вместо 200. Журнал:"
  journalctl -u "$SERVICE" -n 20 --no-pager
  fail "выкатка неудачна. Откат: ./deploy/deploy.sh --rollback"
fi

journalctl -u "$SERVICE" -n 12 --no-pager | grep -E "Система|Слушает|Почта|ВНИМАНИЕ" || true
echo
echo "Готово. Приложение отвечает 200."
echo "Если что-то пойдёт не так: ./deploy/deploy.sh --rollback"
