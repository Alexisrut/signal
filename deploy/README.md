# Выкатка на signal.vis.ru

Порядок действий на чистом Ubuntu-сервере. Всё, что здесь есть, выполняется
один раз; повторная выкатка новой версии — это только раздел «Обновление».

Исходные данные: сервер `195.133.238.10`, ssh на порту `2626`, пользователь
`visuser`, wildcard-сертификат `*.vis.ru`, домен третьего уровня `signal.vis.ru`.

---

## 0. До первого захода на сервер

**DNS.** В зоне `vis.ru` должна появиться A-запись:

    signal.vis.ru.  A  195.133.238.10

Пока запись не разошлась, сертификат и nginx настроить можно, а проверить —
нет. Проверка: `dig +short signal.vis.ru` должен вернуть адрес сервера.

**Пароль от ssh.** Пароль, выданный вместе с сервером, стоит сменить и перейти
на ключ (шаг 8). Пароль, который побывал в переписке или в чате, считается
скомпрометированным.

---

## 1. Заход и базовая подготовка

    ssh -p 2626 visuser@195.133.238.10

Длинные шаги (обновление пакетов, установка зависимостей) стоит выполнять
в `tmux`: при обрыве соединения оболочка получает SIGHUP и убивает команду
вместе с собой, а tmux держит сессию на сервере.

    sudo apt install -y tmux
    tmux new -s deploy          # отсоединиться: Ctrl+B, затем D
                                # вернуться: tmux attach -t deploy

Чтобы канал не рвался по бездействию, на своей машине допишите в ~/.ssh/config:

    Host 195.133.238.10
        ServerAliveInterval 60
        ServerAliveCountMax 5

    sudo apt update && sudo apt upgrade -y
    sudo apt install -y nginx git curl sqlite3

Если выпадет окно «Daemons using outdated libraries» — это `needrestart`
спрашивает, какие службы перезапустить после обновления библиотек. Галочки
уже расставлены верно, достаточно `Tab` → `<Ok>`. Чтобы он не спрашивал на
каждой установке, переведите его в автоматический режим:

    sudo sed -i "s/#\$nrconf{restart} = 'i';/\$nrconf{restart} = 'a';/" /etc/needrestart/needrestart.conf

После обновления ядра сервер стоит перезагрузить: `sudo reboot`.

## 2. Node.js 22 LTS

В репозиториях Ubuntu лежит устаревшая версия. Ставим из NodeSource:

    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
    node -v    # должно быть v22.x

Нативная сборка не нужна: SQLite подключен как WebAssembly-модуль
(`node-sqlite3-wasm`), поэтому ни `build-essential`, ни `python3` не требуются.

## 3. Код и зависимости

Репозиторий предполагается в `/home/visuser/signal-monitor`. `git clone` кладет
его в каталог `signal` — по имени репозитория, — поэтому имя задается явно.
При другом имени поправьте `WorkingDirectory` в `deploy/signal-monitor.service`,
иначе служба не стартует.

    cd /home/visuser
    git clone https://github.com/Alexisrut/signal.git signal-monitor
    cd signal-monitor
    npm ci --omit=dev; echo "код возврата: $?"

Установка обязана завершиться с кодом 0 и без ошибок в выводе. Оборванная
установка оставляет неполное дерево: пакеты верхнего уровня встают, а их
зависимости нет, и приложение падает на `Cannot find module`. Проверка:

    npm ls --omit=dev --depth=0

Четыре строки — busboy, exceljs, node-sqlite3-wasm, nodemailer — без пометок
`UNMET DEPENDENCY` и `extraneous`. Считать каталоги в node_modules бесполезно:
осиротевшие пакеты от неудачной установки занимают место недостающих, и число
сходится при сломанном дереве. `extraneous` в выводе `npm ls` как раз означает
«пакет лежит, но ни одна цепочка зависимостей до него не доходит» — значит,
его родитель не установился.

Если реестр npm с сервера недоступен, дерево можно собрать на рабочей машине
строго по тому же lock-файлу и перенести файлом — нативных сборок в нем нет,
оно одинаково на macOS и Linux:

    npm ci --omit=dev && tar -czf node_modules.tar.gz node_modules   # локально
    scp -P 2626 node_modules.tar.gz visuser@<сервер>:/home/visuser/signal-monitor/
    tar -xzf node_modules.tar.gz && rm node_modules.tar.gz           # на сервере

npm запускать без `sudo`. Смешанный запуск оставляет часть дерева во владении
root, и следующая установка от `visuser` переписать его уже не может —
лечится только `sudo rm -rf node_modules` и повторным `npm ci` без sudo.

## 4. Каталог данных

База, вложения и служебные файлы выносятся за пределы репозитория — иначе
`git pull` и `git checkout` работают рядом с живыми данными.

    sudo mkdir -p /var/lib/signal-monitor
    sudo chown visuser:visuser /var/lib/signal-monitor
    sudo chmod 750 /var/lib/signal-monitor

## 5. Файл настроек

    cp .env.example .env
    chmod 600 .env
    nano .env

Боевые значения:

    APP_URL=https://signal.vis.ru
    PORT=5175
    HOST=127.0.0.1
    TRUST_PROXY=true
    DATA_DIR=/var/lib/signal-monitor

    DEFAULT_ADMIN_LOGIN=admin
    DEFAULT_ADMIN_EMAIL=<рабочая почта администратора>
    DEFAULT_ADMIN_PASSWORD=<длинный пароль, придуманный сейчас>

    SMTP_HOST=smtp.mail.ru
    SMTP_PORT=465
    SMTP_SECURE=true
    SMTP_USER=vis_group_auto@mail.ru
    SMTP_PASS=<пароль для внешних приложений>
    MAIL_FROM=Мониторинг сигналов <vis_group_auto@mail.ru>

Почему именно так:

- `APP_URL` начинается с `https://` — от этого зависят флаг `Secure` у сессионной
  куки и заголовок HSTS. С `http://` кука уйдет по открытому каналу.
- `HOST=127.0.0.1` — приложение слушает только петлю, снаружи оно доступно
  исключительно через nginx с TLS.
- `TRUST_PROXY=true` — за прокси адрес клиента приходит в `X-Forwarded-For`.
  Без этого все посетители считаются одним адресом, и десять чужих неудачных
  входов заблокируют вход всем. Включать только при закрытом снаружи порте
  5175, иначе адрес подделывается заголовком.
- `DEFAULT_ADMIN_PASSWORD` читается один раз, на пустой базе. Без него будет
  заведен демо-доступ `admin` / `admin123`, опубликованный в README.

Проверка вручную, до службы:

    node server/index.js

В выводе должно быть `→ https://signal.vis.ru`, `Слушает: 127.0.0.1:5175`,
`Почта: реальная отправка через SMTP` и строка о созданном администраторе
без предупреждения о пароле по умолчанию. Останавливаем по `Ctrl+C`.

## 6. Служба systemd

    sudo cp deploy/signal-monitor.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now signal-monitor
    systemctl status signal-monitor
    journalctl -u signal-monitor -n 50 --no-pager

Проверка, что приложение отвечает локально:

    curl -si http://127.0.0.1:5175/api/whoami | head -20

## 7. nginx и сертификат

Кладем сертификат (пути в конфиге при необходимости поправить):

    sudo mkdir -p /etc/ssl/vis.ru
    sudo cp fullchain.pem /etc/ssl/vis.ru/fullchain.pem
    sudo cp privkey.pem   /etc/ssl/vis.ru/privkey.pem
    sudo chmod 600 /etc/ssl/vis.ru/privkey.pem
    sudo chmod 644 /etc/ssl/vis.ru/fullchain.pem

`fullchain.pem` — сертификат вместе с промежуточными, в таком порядке.
Если выдали три отдельных файла, склеиваем: сначала сертификат домена, затем
промежуточные. Проверка цепочки:

    openssl x509 -in /etc/ssl/vis.ru/fullchain.pem -noout -subject -dates

Подключаем сайт:

    sudo cp deploy/nginx-signal.vis.ru.conf /etc/nginx/sites-available/signal.vis.ru
    sudo ln -s /etc/nginx/sites-available/signal.vis.ru /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl reload nginx

## 8. Сеть и доступ

**Сначала разрешаем ssh, потом включаем firewall** — иначе выход из сессии
станет последним:

    sudo ufw allow 2626/tcp
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw enable
    sudo ufw status verbose

Порт 5175 в списке быть не должен.

Переход на вход по ключу (с локальной машины):

    ssh-copy-id -p 2626 visuser@195.133.238.10

После проверки входа по ключу — `sudo nano /etc/ssh/sshd_config`:

    PasswordAuthentication no
    PermitRootLogin no

затем `sudo systemctl restart ssh`. Не закрывайте текущую сессию, пока не
убедились из второго окна, что вход по ключу работает.

## 9. Проверка снаружи

    curl -sI http://signal.vis.ru            # 301 на https
    curl -sI https://signal.vis.ru           # 200 + заголовки безопасности

В ответе должны быть `strict-transport-security`, `content-security-policy`,
`x-frame-options: DENY`, `x-content-type-options: nosniff`.

    curl -si https://195.133.238.10:5175/ --max-time 5   # соединение не должно устанавливаться

В браузере: вход под администратором, создание сигнала, загрузка вложения,
письмо на почту, живое обновление в двух вкладках. У куки `sms_session`
в инструменте разработчика должны стоять `Secure`, `HttpOnly`, `SameSite=Lax`.

## 10. Резервные копии

SQLite нельзя копировать простым `cp` на работающей базе — нужен `.backup`:

    sudo -u visuser crontab -e

    0 3 * * * sqlite3 /var/lib/signal-monitor/signal-monitor.db ".backup '/var/lib/signal-monitor/backup-$(date +\%F).db'" && find /var/lib/signal-monitor -name 'backup-*.db' -mtime +14 -delete

Вложения лежат файлами в `/var/lib/signal-monitor/uploads` — их достаточно
забирать обычным `rsync`.

---

## Обновление до новой версии

    cd /home/visuser/signal-monitor
    git pull
    npm ci --omit=dev
    sudo systemctl restart signal-monitor
    journalctl -u signal-monitor -n 30 --no-pager

Миграции схемы применяются при старте автоматически. Данные лежат в
`DATA_DIR` за пределами репозитория, поэтому `git pull` их не трогает.

## Если что-то не работает

| Симптом | Куда смотреть |
|---|---|
| 502 от nginx | `systemctl status signal-monitor`, приложение не поднялось |
| Значок «офлайн» в интерфейсе | поток `/api/events` буферизуется — проверить `proxy_buffering off` |
| Не грузятся файлы, 413 | `client_max_body_size` в конфиге nginx |
| Вход блокируется у всех сразу | не задан `TRUST_PROXY=true` |
| Письма не уходят | `journalctl -u signal-monitor \| grep -i smtp`, пароль внешних приложений |
| Кука без `Secure` | `APP_URL` не начинается с `https://` |
