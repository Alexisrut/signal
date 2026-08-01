/**
 * Профиль администратора: панель конфигурации уведомлений и модуля задач.
 *
 * Логика поведения компонентов:
 *   главный тумблер «Отправка уведомлений» управляет доступностью всей зависимой
 *   группы (линии + три триггера); тумблер «Дашборд задач» независим.
 */

import { html, formatDateTime } from '../../core/utils.js';
import {
  LINE_COLUMNS,
  LINE,
  NOTIFY_ALL_LINES,
  NOTIFY_LINE_KEYS,
  NOTIFICATION_TRIGGERS,
  NOTIFICATION_EVENT,
} from '/shared/constants.js';
import * as store from '../../data/store.js';
import { currentActor, settings as currentSettings, updateSettings } from '../../domain/session.js';
import { toggle, checkbox } from '../components.js';
import { showToast } from '../chrome.js';

const LINE_OPTIONS = LINE_COLUMNS.map((column) => ({
  key: column.id === LINE.NONE ? 'none' : column.id,
  label: column.label,
}));

const TRIGGERS = [NOTIFICATION_EVENT.CREATE, NOTIFICATION_EVENT.RED, NOTIFICATION_EVENT.RESOLVE];

function selectedLineKeys(settings) {
  return settings.notifyLines === NOTIFY_ALL_LINES ? [...NOTIFY_LINE_KEYS] : settings.notifyLines;
}

export const adminProfileView = {
  // Форма с несохраненным состоянием — автоперерисовку не включаем.
  live: false,

  render() {
    const actor = currentActor();
    const settings = currentSettings(actor);
    const meta = store.getState().meta ?? {};
    const lines = selectedLineKeys(settings);
    const allLines = lines.length === NOTIFY_LINE_KEYS.length;

    const lineCheckboxes = LINE_OPTIONS.map((option) =>
      checkbox({
        name: `line:${option.key}`,
        label: option.label,
        checked: lines.includes(option.key),
        disabled: !settings.notificationsEnabled,
      }),
    );

    const triggerCheckboxes = TRIGGERS.map((event) =>
      checkbox({
        name: NOTIFICATION_TRIGGERS[event].setting,
        label: NOTIFICATION_TRIGGERS[event].label,
        checked: settings[NOTIFICATION_TRIGGERS[event].setting],
        disabled: !settings.notificationsEnabled,
      }),
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Профиль администратора</h1>
            <p class="page__lead">Настройки уведомлений и доступных модулей действуют только на вашу учетную запись.</p>
          </div>
          <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
        </header>

        <div class="split">
          <div class="panel">
            <h2 class="panel__title">Учетная запись</h2>
            <dl class="detail__facts">
              <div><dt>Имя</dt><dd>${actor.displayName}</dd></div>
              <div><dt>Логин</dt><dd class="mono">${actor.login}</dd></div>
              <div><dt>Email</dt><dd class="mono">${actor.email}</dd></div>
              <div>
                <dt>Статус почты</dt>
                <dd>
                  ${[
                    actor.isEmailVerified
                      ? html`<span class="pill pill--ok">подтверждена</span>`
                      : html`<span class="pill pill--warn">не подтверждена</span>`,
                  ]}
                </dd>
              </div>
              <div><dt>Создан</dt><dd>${formatDateTime(actor.createdAt)}</dd></div>
              <div>
                <dt>Доставка писем</dt>
                <dd>
                  ${meta.mailMode === 'dev-inbox' ? 'dev-инбокс (SMTP не настроен)' : 'SMTP'}
                  ${[
                    meta.mailMode === 'dev-inbox'
                      ? html` · <a class="link" href="/dev/mailbox" target="_blank" rel="noopener">открыть</a>`
                      : '',
                  ]}
                </dd>
              </div>
            </dl>
          </div>

          <form class="panel" id="settings-form">
            <h2 class="panel__title">Уведомления и модули</h2>

            ${[
              toggle({
                name: 'notificationsEnabled',
                label: 'Включить отправку уведомлений',
                hint: 'Главный переключатель: при выключении письма не приходят вообще.',
                checked: settings.notificationsEnabled,
              }),
            ]}

            <fieldset class="dependent ${settings.notificationsEnabled ? '' : 'is-locked'}" data-role="dependent">
              <legend class="dependent__legend">Условия рассылки</legend>

              <div class="dependent__block">
                <span class="dependent__title">Линии сигналов</span>
                <div class="checks">
                  ${[
                    checkbox({
                      name: 'lines:all',
                      label: 'Выбрать все',
                      checked: allLines,
                      disabled: !settings.notificationsEnabled,
                    }),
                  ]}
                  <span class="checks__sep"></span>
                  ${lineCheckboxes}
                </div>
              </div>

              <div class="dependent__block">
                <span class="dependent__title">События</span>
                <div class="checks checks--column">${triggerCheckboxes}</div>
              </div>
            </fieldset>

            <hr class="rule" />

            ${[
              toggle({
                name: 'tasksDashboardEnabled',
                label: 'Включить дашборд задач',
                hint: 'Независимый переключатель: скрывает или показывает раздел «Задачи».',
                checked: settings.tasksDashboardEnabled,
              }),
            ]}

            <div class="form__hint" data-role="summary" hidden></div>

            <div class="page__head-actions">
              <button class="btn btn--primary" type="submit">Сохранить настройки</button>
              <button class="btn btn--ghost" type="button" data-action="reset">Отменить изменения</button>
            </div>
          </form>
        </div>
      </section>
    `;
  },

  mount(root, ctx) {
    const form = root.querySelector('#settings-form');
    const dependent = form.querySelector('[data-role="dependent"]');
    const summary = form.querySelector('[data-role="summary"]');

    const master = form.querySelector('[name="notificationsEnabled"]');
    const allBox = form.querySelector('[name="lines:all"]');
    const lineBoxes = LINE_OPTIONS.map((option) => ({
      key: option.key,
      input: form.querySelector(`[name="line:${option.key}"]`),
    }));

    /** Зависимая группа активна только при включенном главном тумблере. */
    function syncDependentState() {
      const enabled = master.checked;
      dependent.classList.toggle('is-locked', !enabled);
      dependent.querySelectorAll('input').forEach((input) => {
        input.disabled = !enabled;
      });
    }

    function syncAllBox() {
      const checkedCount = lineBoxes.filter((box) => box.input.checked).length;
      allBox.checked = checkedCount === lineBoxes.length;
      allBox.indeterminate = checkedCount > 0 && checkedCount < lineBoxes.length;
    }

    master.addEventListener('change', syncDependentState);

    allBox.addEventListener('change', () => {
      lineBoxes.forEach((box) => {
        box.input.checked = allBox.checked;
      });
      allBox.indeterminate = false;
    });

    lineBoxes.forEach((box) => box.input.addEventListener('change', syncAllBox));

    syncDependentState();
    syncAllBox();

    form.querySelector('[data-action="reset"]').addEventListener('click', () => ctx.refresh());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const selected = lineBoxes.filter((box) => box.input.checked).map((box) => box.key);
      const payload = {
        notificationsEnabled: master.checked,
        notifyLines: selected.length === lineBoxes.length ? NOTIFY_ALL_LINES : selected,
        tasksDashboardEnabled: form.querySelector('[name="tasksDashboardEnabled"]').checked,
      };
      for (const event_ of TRIGGERS) {
        const key = NOTIFICATION_TRIGGERS[event_].setting;
        payload[key] = form.querySelector(`[name="${key}"]`).checked;
      }

      if (payload.notificationsEnabled && !selected.length) {
        summary.hidden = false;
        summary.className = 'form__hint form__hint--error';
        summary.textContent = 'Выберите хотя бы одну линию — иначе уведомления приходить не будут.';
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        await updateSettings(payload);
        showToast('Настройки сохранены', 'success');
        ctx.refresh();
      } catch (error) {
        button.disabled = false;
        summary.hidden = false;
        summary.className = 'form__hint form__hint--error';
        summary.textContent = error.message;
      }
    });
  },
};
