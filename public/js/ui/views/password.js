/**
 * Восстановление пароля.
 *
 * Два экрана: запрос ссылки по логину или почте и установка нового пароля
 * по одноразовому токену из письма. Ответ на запрос всегда одинаковый —
 * по нему нельзя узнать, существует ли учетная запись.
 */

import { html, isBlank } from '../../core/utils.js';
import { RESET_TOKEN_TTL_MS } from '/shared/constants.js';
import { validatePasswordReset } from '/shared/validation.js';
import * as store from '../../data/store.js';
import { checkResetToken, requestPasswordReset, resetPassword } from '../../domain/session.js';
import { emptyState } from '../components.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/* ------------------------------ запрос ссылки -------------------------------- */

export const forgotView = {
  live: false,

  render() {
    return html`
      <section class="auth">
        <h1 class="auth__title">Восстановление пароля</h1>
        <p class="auth__lead">
          Укажите логин или адрес почты — вышлем одноразовую ссылку для установки нового пароля.
          Она действует ${Math.round(RESET_TOKEN_TTL_MS / 60000)} мин.
        </p>

        <form class="form" id="forgot-form" novalidate>
          <label class="field" data-field="identifier">
            <span class="field__label">Логин или email<span class="field__req">*</span></span>
            <input class="field__control" name="identifier" type="text" autocomplete="username"
              placeholder="ipetrov или company@mail.ru" />
            <span class="field__error" data-error-for="identifier"></span>
          </label>

          <div class="form__hint" data-role="summary" hidden></div>

          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/login">Вернуться ко входу</a>
            <button class="btn btn--primary" type="submit">Выслать ссылку</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#forgot-form');
    const control = form.querySelector('[name="identifier"]');
    const summary = form.querySelector('[data-role="summary"]');

    const setInvalid = (message) => {
      form.querySelector('[data-field="identifier"]').classList.toggle('is-invalid', Boolean(message));
      form.querySelector('[data-error-for="identifier"]').textContent = message ?? '';
    };

    control.addEventListener('input', () => {
      setInvalid(null);
      summary.hidden = true;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (isBlank(control.value)) {
        setInvalid('Укажите логин или email');
        control.focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const result = await requestPasswordReset(control.value);
        summary.hidden = false;
        summary.classList.remove('form__hint--error');
        summary.textContent =
          result.mailMode === 'dev-inbox'
            ? 'Если такая учетная запись есть, письмо уже в dev-инбоксе (/dev/mailbox).'
            : 'Если такая учетная запись есть, письмо со ссылкой отправлено на ее адрес.';
      } catch (error) {
        button.disabled = false;
        summary.hidden = false;
        summary.classList.add('form__hint--error');
        summary.textContent = error.message;
      }
    });
  },
};

/* ---------------------------- установка пароля -------------------------------- */

const RESET_FIELDS = [
  { name: 'password', label: 'Новый пароль', placeholder: 'минимум 6 символов' },
  { name: 'password2', label: 'Повтор пароля', placeholder: 'повторите пароль' },
];

/**
 * Проверка токена идет асинхронно уже после первого рендера: экран сначала
 * показывает форму, а негодную ссылку заменяет объяснением. Так пользователь
 * не смотрит на пустую страницу, пока идет запрос.
 */
export const resetView = {
  live: false,

  render(ctx) {
    if (!ctx.query.token) {
      return html`<section class="page">
        ${[
          emptyState(
            'Ссылка неполная',
            'Откройте ссылку из письма целиком — в ней есть одноразовый код.',
            html`<a class="btn btn--primary" href="#/forgot">Запросить новую ссылку</a>`,
          ),
        ]}
      </section>`;
    }

    const fields = RESET_FIELDS.map(
      (field) => html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        <input class="field__control" name="${field.name}" type="password" autocomplete="new-password"
          placeholder="${field.placeholder}" />
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`,
    );

    return html`
      <section class="auth" data-role="reset">
        <h1 class="auth__title">Новый пароль</h1>
        <p class="auth__lead" data-role="lead">Проверяем ссылку…</p>

        <form class="form" id="reset-form" novalidate hidden>
          ${fields}
          <div class="form__hint form__hint--error" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/login">Ко входу</a>
            <button class="btn btn--primary" type="submit">Сохранить пароль</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root, ctx) {
    const form = root.querySelector('#reset-form');
    if (!form) return;

    const lead = root.querySelector('[data-role="lead"]');
    const summary = form.querySelector('[data-role="summary"]');
    const controls = new Map(RESET_FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

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

    checkResetToken(ctx.query.token)
      .then((result) => {
        if (!result.ok) {
          lead.textContent = `${result.reason}. Запросите новую ссылку — старая больше не действует.`;
          form.hidden = true;
          lead.insertAdjacentHTML(
            'afterend',
            html`<div class="wizard__actions">
              <a class="btn btn--primary" href="#/forgot">Запросить новую ссылку</a>
            </div>`,
          );
          return;
        }

        lead.textContent = `Учетная запись «${result.login}». Придумайте новый пароль — все открытые сессии завершатся.`;
        form.hidden = false;
        controls.get('password').focus();
      })
      .catch((error) => {
        lead.textContent = error.message;
      });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
      const { valid, errors } = validatePasswordReset(values);
      RESET_FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

      if (!valid) {
        summary.hidden = false;
        summary.textContent = 'Заполните подсвеченные поля — пароль не изменен.';
        controls.get(RESET_FIELDS.find((field) => errors[field.name]).name).focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        await resetPassword({ ...values, token: ctx.query.token });
        // Сессии сброшены вместе с паролем — входить нужно заново.
        await store.refresh();
        showToast('Пароль изменен — войдите с новым паролем', 'success');
        navigate('/login');
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
  },
};
