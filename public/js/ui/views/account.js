/**
 * Раздел «Аккаунт» — личные настройки, одинаковые для всех ролей.
 *
 * Здесь подтверждают почту (по желанию: доступ она не ограничивает),
 * меняют пароль, настраивают почтовые уведомления и выбирают тему.
 */

import { html, formatDateTime } from '../../core/utils.js';
import { ROLE_LABEL, THEMES, categoryLabel } from '/shared/constants.js';
import { validatePasswordChange } from '/shared/validation.js';
import { currentTheme, setTheme } from '../../core/theme.js';
import * as store from '../../data/store.js';
import {
  changePassword,
  currentActor,
  isContractor,
  isStaff,
  isSuperadmin,
  myCategories,
  myNotify,
  resendVerification,
  updateNotify,
} from '../../domain/session.js';
import { radioGroup, toggle } from '../components.js';
import { showToast } from '../chrome.js';

const PASSWORD_FIELDS = [
  { name: 'currentPassword', label: 'Текущий пароль', autocomplete: 'current-password' },
  { name: 'password', label: 'Новый пароль', autocomplete: 'new-password' },
  { name: 'password2', label: 'Повтор нового пароля', autocomplete: 'new-password' },
];

function profileFacts(actor) {
  const facts = [
    ['Роль', ROLE_LABEL[actor.role] ?? 'Пользователь'],
    ['Логин', actor.login],
    ['Email', actor.email || '—'],
    ['В системе с', formatDateTime(actor.createdAt)],
  ];

  if (isContractor(actor) && actor.fullName) facts.splice(1, 0, ['Контактное лицо', actor.fullName]);
  if (isStaff(actor)) {
    const categories = myCategories(actor);
    facts.push(['Категории', categories.length ? categories.map((id) => categoryLabel(id)).join(', ') : 'не выбраны']);
  }

  return html`<dl class="detail__facts">
    ${facts.map((fact) => html`<div><dt>${fact[0]}</dt><dd>${fact[1]}</dd></div>`)}
  </dl>`;
}

/** Что именно приходит на почту — зависит от роли. */
function notifyHint(actor) {
  if (isContractor(actor)) {
    return 'Письмо приходит о каждом действии с вашими сигналами: проверка, возврат на доработку, передача в работу, комментарии, закрытие.';
  }
  const base = 'Письмо приходит о каждом действии с сигналами, по которым вы автор или ответственный.';
  if (!isSuperadmin(actor)) return base;
  return store.getState().meta?.mailCopySuperadmin
    ? `${base} На период тестирования вам приходит копия всех писем по всем сигналам.`
    : `${base} Плюс письма входного контроля: новые и доработанные сигналы.`;
}

export const accountView = {
  // Экран состоит из форм: автоперерисовка стерла бы наполовину введенный пароль.
  live: false,

  render() {
    const actor = currentActor();
    const notify = myNotify(actor);
    const theme = currentTheme();

    const passwordFields = PASSWORD_FIELDS.map(
      (field) => html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        <input class="field__control" name="${field.name}" type="password" autocomplete="${field.autocomplete}"
          placeholder="••••••" />
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`,
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Аккаунт</h1>
            <p class="page__lead">${actor.displayName}</p>
          </div>
        </header>

        <div class="split">
          <div class="panel">
            <h2 class="panel__title">Профиль</h2>
            ${[profileFacts(actor)]}

            <div class="account__row">
              <div>
                <span class="account__label">Электронная почта</span>
                ${[
                  actor.isEmailVerified
                    ? html`<span class="pill pill--ok">подтверждена</span>`
                    : html`<span class="pill pill--warn">не подтверждена</span>`,
                ]}
              </div>
              ${[
                actor.isEmailVerified
                  ? ''
                  : html`<button class="btn btn--secondary btn--sm" data-action="verify">Подтвердить почту</button>`,
              ]}
            </div>
          </div>

          <div class="panel">
            <h2 class="panel__title">Смена пароля</h2>
            <form class="form" id="password-form" novalidate>
              ${passwordFields}
              <div class="form__hint form__hint--error" data-role="summary" hidden></div>
              <button class="btn btn--primary" type="submit">Сохранить новый пароль</button>
            </form>
          </div>
        </div>

        <div class="panel">
          <h2 class="panel__title">Уведомления на почту</h2>
          <form class="form" id="notify-form" novalidate>
            ${[
              toggle({
                name: 'notify-enabled',
                label: 'Присылать письма на почту',
                hint: notifyHint(actor),
                checked: notify.enabled,
              }),
            ]}
            <p class="field__hint">
              Все письма по одному сигналу приходят с одной темой — «Сигнал №… Суть проблемы» — и с одного
              адреса, поэтому почта собирает их в одну цепочку от создания до закрытия.
            </p>

            <button class="btn btn--primary" type="submit">Сохранить настройки</button>
          </form>
        </div>

        <div class="panel">
          <h2 class="panel__title">Тема оформления</h2>
          <p class="field__hint">Выбор сохраняется в этом браузере и действует на всех страницах.</p>
          <form class="form" id="theme-form">
            ${[radioGroup({ name: 'theme', options: THEMES, value: theme })]}
          </form>
        </div>
      </section>
    `;
  },

  mount(root, ctx) {
    bindVerify(root);
    bindPasswordForm(root, ctx);
    bindNotifyForm(root);
    bindThemeForm(root);
  },
};

function bindVerify(root) {
  root.querySelector('[data-action="verify"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      await resendVerification();
      showToast('Письмо со ссылкой подтверждения отправлено', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function bindPasswordForm(root, ctx) {
  const form = root.querySelector('#password-form');
  const summary = form.querySelector('[data-role="summary"]');
  const controls = new Map(PASSWORD_FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

  function setInvalid(name, message) {
    form.querySelector(`[data-field="${name}"]`).classList.toggle('is-invalid', Boolean(message));
    form.querySelector(`[data-error-for="${name}"]`).textContent = message ?? '';
  }

  controls.forEach((control, name) => {
    control.addEventListener('input', () => {
      setInvalid(name, null);
      summary.hidden = true;
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
    const { valid, errors } = validatePasswordChange(values);
    PASSWORD_FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

    if (!valid) {
      summary.hidden = false;
      summary.textContent = 'Заполните подсвеченные поля — пароль не изменен.';
      controls.get(PASSWORD_FIELDS.find((field) => errors[field.name]).name).focus();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      await changePassword(values);
      showToast('Пароль изменен — остальные сессии завершены', 'success');
      ctx.refresh();
    } catch (error) {
      button.disabled = false;
      summary.hidden = false;
      summary.textContent = error.message;
      if (error.errors) {
        for (const [name, message] of Object.entries(error.errors)) {
          if (controls.has(name)) setInvalid(name, message);
        }
      }
    }
  });
}

/**
 * Уведомления — один общий тумблер. Выбора отдельных событий нет: письма
 * по сигналу складываются в почте в одну цепочку, и выборочная подписка
 * рвала бы ее посередине.
 */
function bindNotifyForm(root) {
  const form = root.querySelector('#notify-form');
  const master = form.querySelector('[name="notify-enabled"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      await updateNotify({ enabled: master.checked });
      showToast('Настройки уведомлений сохранены', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function bindThemeForm(root) {
  root.querySelectorAll('#theme-form [name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setTheme(input.value);
      showToast(`Тема переключена: ${input.value === 'light' ? 'светлая' : 'темная'}`);
    });
  });
}
