/**
 * Администрирование: список учетных записей и создание новых администраторов.
 * После создания система сама отправляет письмо со ссылкой подтверждения —
 * до перехода по ней доступ к панели у новой учетной записи заблокирован.
 */

import { html, formatDateTime } from '../../core/utils.js';
import { validateAdminInput } from '/shared/validation.js';
import { currentActor, listAdmins, createAdmin } from '../../domain/session.js';
import * as store from '../../data/store.js';
import { showToast } from '../chrome.js';

const FIELDS = [
  { name: 'displayName', label: 'Отображаемое имя', type: 'text', placeholder: 'Иван Петров', autocomplete: 'name' },
  { name: 'login', label: 'Логин', type: 'text', placeholder: 'ipetrov', autocomplete: 'off' },
  { name: 'email', label: 'Email', type: 'email', placeholder: 'ipetrov@company.ru', autocomplete: 'off' },
  { name: 'password', label: 'Пароль', type: 'password', placeholder: 'минимум 6 символов', autocomplete: 'new-password' },
  { name: 'password2', label: 'Повтор пароля', type: 'password', placeholder: 'повторите пароль', autocomplete: 'new-password' },
];

export const adminUsersView = {
  // Экран содержит форму — автоперерисовка по внешним изменениям стерла бы ввод.
  live: false,

  render() {
    const actor = currentActor();
    const admins = listAdmins();
    const mailMode = store.getState().meta?.mailMode;

    const rows = admins.map(
      // data-label подставляется в псевдоэлемент только в мобильной раскладке,
      // где таблица превращается в карточки; на десктопе атрибут ни на что не влияет.
      (admin) => html`<tr>
        <td data-label="Имя">
          <strong>${admin.displayName}</strong>
          ${[admin.id === actor.id ? html`<span class="tag tag--self">это вы</span>` : '']}
        </td>
        <td class="mono" data-label="Логин">${admin.login}</td>
        <td class="mono" data-label="Email">${admin.email}</td>
        <td data-label="Почта">
          ${[
            admin.isEmailVerified
              ? html`<span class="pill pill--ok">подтвержден</span>`
              : html`<span class="pill pill--warn">ожидает подтверждения</span>`,
          ]}
        </td>
        <td data-label="Создан">${formatDateTime(admin.createdAt)}</td>
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
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Имя</th><th>Логин</th><th>Email</th><th>Почта</th><th>Создан</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <h2 class="panel__title">Новый администратор</h2>
            <form class="form" id="admin-form" novalidate>
              ${fields}
              <p class="form__note">
                На указанный адрес уйдет письмо со ссылкой подтверждения (действует 24 ч).
                ${[
                  mailMode === 'dev-inbox'
                    ? html` SMTP не настроен, поэтому письмо попадет в
                        <a class="link" href="/dev/mailbox" target="_blank" rel="noopener">dev-инбокс</a>.`
                    : ' Письмо отправляется по SMTP.',
                ]}
              </p>
              <div class="form__hint form__hint--error" data-role="summary" hidden></div>
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
    const controls = new Map(FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));

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
      const { valid, errors } = validateAdminInput(values);

      FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

      if (!valid) {
        summary.hidden = false;
        summary.textContent = 'Заполните подсвеченные поля — учетная запись не создана.';
        controls.get(FIELDS.find((field) => errors[field.name]).name).focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const result = await createAdmin(values);
        const where = result.delivery.mode === 'dev-inbox' ? 'в dev-инбокс' : 'на указанный email';
        showToast(`Администратор «${result.admin.displayName}» создан, письмо отправлено ${where}`, 'success');
        ctx.refresh();
      } catch (error) {
        button.disabled = false;
        summary.hidden = false;
        summary.textContent = error.message;
        if (error.errors) {
          for (const [name, message] of Object.entries(error.errors)) setInvalid(name, message);
        }
      }
    });
  },
};
