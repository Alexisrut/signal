/** Администрирование: список учетных записей и создание новых администраторов. */

import { html, formatDateTime, isBlank } from '../../core/utils.js';
import { currentActor, listAdmins, createAdmin } from '../../domain/auth.js';
import { showToast } from '../chrome.js';

const FIELDS = [
  { name: 'displayName', label: 'Отображаемое имя', type: 'text', placeholder: 'Иван Петров', autocomplete: 'name' },
  { name: 'login', label: 'Логин', type: 'text', placeholder: 'ipetrov', autocomplete: 'off' },
  { name: 'password', label: 'Пароль', type: 'password', placeholder: 'минимум 6 символов', autocomplete: 'new-password' },
  { name: 'password2', label: 'Повтор пароля', type: 'password', placeholder: 'повторите пароль', autocomplete: 'new-password' },
];

function validate(values) {
  const errors = {};
  if (isBlank(values.displayName)) errors.displayName = 'Укажите имя администратора';
  if (isBlank(values.login)) errors.login = 'Укажите логин';
  else if (values.login.trim().length < 3) errors.login = 'Минимум 3 символа';
  if (isBlank(values.password)) errors.password = 'Укажите пароль';
  else if (values.password.length < 6) errors.password = 'Минимум 6 символов';
  if (isBlank(values.password2)) errors.password2 = 'Повторите пароль';
  else if (values.password !== values.password2) errors.password2 = 'Пароли не совпадают';
  return { valid: Object.keys(errors).length === 0, errors };
}

export const adminUsersView = {
  // Экран содержит форму — автоперерисовка по внешним изменениям стерла бы ввод.
  live: false,

  render() {
    const actor = currentActor();
    const admins = listAdmins();

    const rows = admins.map(
      (admin) => html`<tr>
        <td>
          <strong>${admin.displayName}</strong>
          ${[admin.id === actor.id ? html`<span class="tag tag--self">это вы</span>` : '']}
        </td>
        <td class="mono">${admin.login}</td>
        <td>${formatDateTime(admin.createdAt)}</td>
      </tr>`,
    );

    const fields = FIELDS.map(
      (field) => html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        <input class="field__control" name="${field.name}" type="${field.type}"
          placeholder="${field.placeholder}" autocomplete="${field.autocomplete}" />
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`,
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Администраторы</h1>
            <p class="page__lead">Учетные записи с полным доступом к карте сигналов.</p>
          </div>
          <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
        </header>

        <div class="split">
          <div class="panel">
            <h2 class="panel__title">Действующие учетные записи (${admins.length})</h2>
            <table class="table">
              <thead>
                <tr><th>Имя</th><th>Логин</th><th>Создан</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <div class="panel">
            <h2 class="panel__title">Новый администратор</h2>
            <form class="form" id="admin-form" novalidate>
              ${fields}
              <div class="form__hint" data-role="summary" hidden></div>
              <button class="btn btn--primary" type="submit">Создать учетную запись</button>
            </form>
          </div>
        </div>
      </section>
    `;
  },

  mount(root, ctx) {
    const form = root.querySelector('#admin-form');
    const summary = form.querySelector('[data-role="summary"]');
    const controls = new Map(FIELDS.map((f) => [f.name, form.querySelector(`[name="${f.name}"]`)]));

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
      const { valid, errors } = validate(values);

      FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

      if (!valid) {
        summary.hidden = false;
        summary.className = 'form__hint form__hint--error';
        summary.textContent = 'Заполните подсвеченные поля — учетная запись не создана.';
        controls.get(FIELDS.find((f) => errors[f.name]).name).focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const result = await createAdmin(values, currentActor());
      button.disabled = false;

      if (!result.ok) {
        summary.hidden = false;
        summary.className = 'form__hint form__hint--error';
        summary.textContent = result.error;
        if (/логин/i.test(result.error)) setInvalid('login', result.error);
        return;
      }

      ctx.refresh();
      showToast(`Администратор «${result.admin.displayName}» создан`, 'success');
    });
  },
};
