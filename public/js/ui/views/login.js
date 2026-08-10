/**
 * Единая форма входа.
 *
 * Логин подрядчика — название его компании, у администратора — выданный ему логин.
 * Роль определяет сервер, клиент только выбирает, куда вести после входа.
 */

import { html, isBlank } from '../../core/utils.js';
import { DEFAULT_ADMIN, ROLE, isAdminRole } from '/shared/constants.js';
import * as store from '../../data/store.js';
import { login } from '../../domain/session.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

/** Куда вести после успешного входа. */
export function landingFor(user) {
  if (user.role === ROLE.CONTRACTOR) return '/my';
  if (isAdminRole(user.role)) return user.isEmailVerified ? '/admin' : '/admin/verify';
  return '/';
}

export const loginView = {
  live: false,

  render() {
    // Подсказка живет ровно до тех пор, пока цела учетная запись по умолчанию.
    const hasDefault = store.getState().meta?.defaultAdminPresent === true;

    return html`
      <section class="auth">
        <h1 class="auth__title">Вход в систему</h1>
        <p class="auth__lead">
          Подрядчик входит по названию своей компании, администратор — по выданному логину.
        </p>

        <form class="form" id="login-form" novalidate>
          <label class="field" data-field="login">
            <span class="field__label">Логин или название компании<span class="field__req">*</span></span>
            <input class="field__control" name="login" type="text" autocomplete="username"
              placeholder="ООО «СтройМонтаж»" />
            <span class="field__error" data-error-for="login"></span>
          </label>

          <label class="field" data-field="password">
            <span class="field__label">Пароль<span class="field__req">*</span></span>
            <input class="field__control" name="password" type="password" autocomplete="current-password" placeholder="••••••" />
            <span class="field__error" data-error-for="password"></span>
          </label>

          <div class="form__hint form__hint--error" data-role="summary" hidden></div>

          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/register">Зарегистрировать компанию</a>
            <button class="btn btn--primary" type="submit">Войти</button>
          </div>
        </form>

        ${[
          hasDefault
            ? html`<p class="auth__demo">
                Демо-доступ главного администратора: <code>${DEFAULT_ADMIN.login}</code> /
                <code>${DEFAULT_ADMIN.password}</code>
              </p>`
            : '',
        ]}
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#login-form');
    const summary = form.querySelector('[data-role="summary"]');
    const fields = ['login', 'password'];

    function setInvalid(name, message) {
      form.querySelector(`[data-field="${name}"]`).classList.toggle('is-invalid', Boolean(message));
      form.querySelector(`[data-error-for="${name}"]`).textContent = message ?? '';
    }

    fields.forEach((name) => {
      form.querySelector(`[name="${name}"]`).addEventListener('input', () => {
        setInvalid(name, null);
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const userLogin = form.querySelector('[name="login"]').value;
      const password = form.querySelector('[name="password"]').value;

      let hasError = false;
      if (isBlank(userLogin)) {
        setInvalid('login', 'Введите логин или название компании');
        hasError = true;
      }
      if (isBlank(password)) {
        setInvalid('password', 'Введите пароль');
        hasError = true;
      }
      if (hasError) {
        summary.hidden = false;
        summary.textContent = 'Заполните подсвеченные поля.';
        form.querySelector('.is-invalid .field__control')?.focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const user = await login(userLogin, password);
        showToast(`Вы вошли как ${user.displayName}`, 'success');
        navigate(landingFor(user));
      } catch (error) {
        button.disabled = false;
        setInvalid('login', ' ');
        setInvalid('password', ' ');
        summary.hidden = false;
        summary.textContent = error.message;
      }
    });
  },
};
