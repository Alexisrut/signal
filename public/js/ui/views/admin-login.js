/** Вход в панель управления по логину и паролю. */

import { html, isBlank } from '../../core/utils.js';
import { DEFAULT_ADMIN } from '/shared/constants.js';
import * as store from '../../data/store.js';
import { login } from '../../domain/session.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

export const adminLoginView = {
  live: false,

  render() {
    // Подсказка живет ровно до тех пор, пока цела учетная запись по умолчанию.
    // Сам список администраторов анонимному пользователю не отдается.
    const hasDefault = store.getState().meta?.defaultAdminPresent === true;

    return html`
      <section class="auth">
        <h1 class="auth__title">Вход для администратора</h1>
        <p class="auth__lead">Панель управления доступна только по учетным данным.</p>

        <form class="form" id="login-form" novalidate>
          <label class="field" data-field="login">
            <span class="field__label">Логин<span class="field__req">*</span></span>
            <input class="field__control" name="login" type="text" autocomplete="username" placeholder="admin" />
            <span class="field__error" data-error-for="login"></span>
          </label>

          <label class="field" data-field="password">
            <span class="field__label">Пароль<span class="field__req">*</span></span>
            <input class="field__control" name="password" type="password" autocomplete="current-password" placeholder="••••••" />
            <span class="field__error" data-error-for="password"></span>
          </label>

          <div class="form__hint form__hint--error" data-role="summary" hidden></div>

          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/">На главную</a>
            <button class="btn btn--primary" type="submit">Войти</button>
          </div>
        </form>

        ${[
          hasDefault
            ? html`<p class="auth__demo">
                Демо-доступ: <code>${DEFAULT_ADMIN.login}</code> / <code>${DEFAULT_ADMIN.password}</code>
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
        setInvalid('login', 'Введите логин');
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
        const admin = await login(userLogin, password);
        showToast(`Вы вошли как ${admin.displayName}`, 'success');
        // Неподтвержденную почту система не пускает дальше экрана-заглушки.
        navigate(admin.isEmailVerified ? '/admin' : '/admin/verify');
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
