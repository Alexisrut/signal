/**
 * Учетные записи — раздел главного администратора.
 *
 * Только он заводит учетные записи, выбирает их тип (администратор,
 * руководитель, главный админ), настраивает категории и удаляет ненужные.
 * Подрядчики регистрируются сами и в списке доступны только для просмотра.
 */

import { html, formatDateTime } from '../../core/utils.js';
import { ACCOUNT_TYPES, CATEGORIES, ROLE, ROLE_LABEL, accountType, categoryShort, isCategoryScopedRole } from '/shared/constants.js';
import { validateAdminInput } from '/shared/validation.js';
import { currentActor, listUsers, createAdmin, updateCategories, deleteUser } from '../../domain/session.js';
import { checkbox, radioGroup } from '../components.js';
import { confirmDialog } from '../modal.js';
import { showToast } from '../chrome.js';

const FIELDS = [
  { name: 'displayName', label: 'Отображаемое имя', type: 'text', placeholder: 'Иван Петров', autocomplete: 'name' },
  { name: 'login', label: 'Логин', type: 'text', placeholder: 'ipetrov', autocomplete: 'off' },
  { name: 'email', label: 'Email', type: 'email', placeholder: 'ipetrov@company.ru', autocomplete: 'off' },
  { name: 'password', label: 'Пароль', type: 'password', placeholder: 'минимум 6 символов', autocomplete: 'new-password' },
  { name: 'password2', label: 'Повтор пароля', type: 'password', placeholder: 'повторите пароль', autocomplete: 'new-password' },
];

/** Набор категорий строкой — для колонки таблицы. */
function categorySummary(user) {
  if (user.role === ROLE.SUPERADMIN) return html`<span class="pill pill--ok">все категории</span>`;
  if (!isCategoryScopedRole(user.role)) return html`<span class="pill">—</span>`;
  if (!user.categories?.length) return html`<span class="pill pill--warn">не выбраны</span>`;
  return html`<span class="tags">${user.categories.map((id) => html`<span class="tag tag--${id}">${categoryShort(id)}</span>`)}</span>`;
}

export const adminUsersView = {
  // Экран содержит формы — автоперерисовка по внешним изменениям стерла бы ввод.
  live: false,

  render() {
    const actor = currentActor();
    const users = listUsers();
    const staff = users.filter((user) => user.role !== ROLE.CONTRACTOR);
    const contractors = users.filter((user) => user.role === ROLE.CONTRACTOR);

    // data-label подставляется в псевдоэлемент только в мобильной раскладке,
    // где таблица превращается в карточки; на десктопе атрибут ни на что не влияет.
    const staffRows = staff.map(
      (user) => html`<tr>
        <td data-label="Имя">
          <strong>${user.displayName}</strong>
          ${[user.id === actor.id ? html`<span class="tag tag--self">это вы</span>` : '']}
          <div class="table__sub">${ROLE_LABEL[user.role]}</div>
        </td>
        <td class="mono" data-label="Логин">${user.login}</td>
        <td class="mono" data-label="Email">${user.email}</td>
        <td data-label="Категории">${[categorySummary(user)]}</td>
        <td data-label="Действия">
          <div class="table__actions">
            ${[
              isCategoryScopedRole(user.role)
                ? html`<button class="btn btn--ghost btn--sm" data-edit="${user.id}">Настроить</button>`
                : html`<span class="table__sub">полный доступ</span>`,
            ]}
            ${[
              user.id === actor.id
                ? ''
                : html`<button class="btn btn--danger btn--sm" data-delete="${user.id}"
                    data-name="${user.displayName}">Удалить</button>`,
            ]}
          </div>
        </td>
      </tr>`,
    );

    const contractorRows = contractors.map(
      (user) => html`<tr>
        <td data-label="Компания"><strong>${user.companyName ?? user.login}</strong></td>
        <td data-label="ФИО">${user.fullName ?? '—'}</td>
        <td class="mono" data-label="Email">${user.email}</td>
        <td data-label="Зарегистрирован">${formatDateTime(user.createdAt)}</td>
        <td data-label="Действия">
          <button class="btn btn--danger btn--sm" data-delete="${user.id}"
            data-name="${user.companyName ?? user.login}">Удалить</button>
        </td>
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

    const defaultType = accountType(ROLE.ADMIN);
    const categoryBoxes = CATEGORIES.map((category) =>
      checkbox({ name: 'categories', label: category.label, value: category.id, checked: false }),
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Учетные записи</h1>
          </div>
          <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
        </header>

        <div class="split">
          <div class="panel">
            <h2 class="panel__title">Сотрудники (${staff.length})</h2>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Имя</th><th>Логин</th><th>Email</th><th>Категории</th><th>Действия</th></tr>
                </thead>
                <tbody>${staffRows}</tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <h2 class="panel__title">Новая учетная запись</h2>
            <form class="form" id="admin-form" novalidate>
              <div class="field" data-field="role">
                <span class="field__label">Тип аккаунта<span class="field__req">*</span></span>
                ${[radioGroup({ name: 'role', options: ACCOUNT_TYPES, value: ROLE.ADMIN, columns: true })]}
              </div>

              ${fields}

              <div class="field" data-field="categories">
                <span class="field__label" data-role="categories-label">${defaultType.categoriesLabel}</span>
                <div class="checkboxes">${categoryBoxes}</div>
                <span class="field__hint" data-role="categories-hint">${defaultType.categoriesHint}</span>
              </div>

              <div class="form__hint form__hint--error" data-role="summary" hidden></div>
              <button class="btn btn--primary" type="submit">Создать учетную запись</button>
            </form>
          </div>
        </div>

        <div class="panel">
          <h2 class="panel__title">Подрядчики (${contractors.length})</h2>
          ${[
            contractors.length
              ? html`<div class="table-wrap">
                  <table class="table">
                    <thead>
                      <tr><th>Компания</th><th>ФИО</th><th>Email</th><th>Зарегистрирован</th><th>Действия</th></tr>
                    </thead>
                    <tbody>${contractorRows}</tbody>
                  </table>
                </div>`
              : html`<p class="column__empty">Пока никто не зарегистрировался.</p>`,
          ]}
        </div>
      </section>
    `;
  },

  mount(root, ctx) {
    const form = root.querySelector('#admin-form');
    const summary = form.querySelector('[data-role="summary"]');
    const controls = new Map(FIELDS.map((field) => [field.name, form.querySelector(`[name="${field.name}"]`)]));
    const categoriesField = form.querySelector('[data-field="categories"]');

    function setInvalid(name, message) {
      form.querySelector(`[data-field="${name}"]`).classList.toggle('is-invalid', Boolean(message));
      form.querySelector(`[data-error-for="${name}"]`).textContent = message ?? '';
    }

    const selectedRole = () => form.querySelector('[name="role"]:checked')?.value ?? ROLE.ADMIN;

    const selectedCategories = () =>
      [...form.querySelectorAll('[name="categories"]:checked')].map((input) => input.value);

    /**
     * Тип аккаунта переименовывает блок категорий: у руководителя это
     * «Курируемые категории», у администратора — «Видимые категории сигналов».
     * Главному администратору доступны все, поэтому выбор ему не нужен.
     */
    function applyRole() {
      const type = accountType(selectedRole());
      form.querySelector('[data-role="categories-label"]').textContent = type.categoriesLabel;
      form.querySelector('[data-role="categories-hint"]').textContent = type.categoriesHint;

      const scoped = isCategoryScopedRole(type.id);
      categoriesField.classList.toggle('is-locked', !scoped);
      categoriesField.querySelectorAll('[name="categories"]').forEach((input) => {
        input.disabled = !scoped;
        input.closest('.checkbox')?.classList.toggle('is-disabled', !scoped);
      });
    }

    form.querySelectorAll('[name="role"]').forEach((input) => input.addEventListener('change', applyRole));
    applyRole();

    controls.forEach((control, name) => {
      control.addEventListener('input', () => {
        setInvalid(name, null);
        summary.hidden = true;
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const role = selectedRole();
      const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
      const { valid, errors } = validateAdminInput({ ...values, role });

      FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

      if (!valid) {
        summary.hidden = false;
        summary.textContent = 'Заполните подсвеченные поля — учетная запись не создана.';
        controls.get(FIELDS.find((field) => errors[field.name]).name)?.focus();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        const result = await createAdmin({ ...values, role, categories: selectedCategories() });
        showToast(`${ROLE_LABEL[result.admin.role]} «${result.admin.displayName}» создан`, 'success');
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

    // Правка набора категорий у существующей учетной записи — прямо в строке таблицы.
    root.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => openCategoryEditor(button, ctx));
    });

    root.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'Удаление аккаунта',
          message: `Вы точно хотите удалить аккаунт «${button.dataset.name}»? Действие необратимо.`,
          confirmLabel: 'Удалить аккаунт',
        });
        if (!confirmed) return;

        button.disabled = true;
        try {
          const removed = await deleteUser(button.dataset.delete);
          showToast(`Аккаунт «${removed.displayName}» удален`, 'success');
          ctx.refresh();
        } catch (error) {
          button.disabled = false;
          showToast(error.message, 'error');
        }
      });
    });
  },
};

/** Разворачивает под строкой таблицы набор чекбоксов с категориями. */
function openCategoryEditor(button, ctx) {
  const userId = button.dataset.edit;
  const user = listUsers().find((item) => item.id === userId);
  if (!user) return;

  const row = button.closest('tr');
  const existing = row.nextElementSibling;
  if (existing?.classList.contains('table__editor')) {
    existing.remove();
    return;
  }

  const type = accountType(user.role);
  const editor = document.createElement('tr');
  editor.className = 'table__editor';
  editor.innerHTML = html`<td colspan="5">
    <div class="editor">
      <span class="editor__label">${type.categoriesLabel} · «${user.displayName}»</span>
      <div class="checkboxes">
        ${CATEGORIES.map((category) =>
          checkbox({
            name: `cat-${userId}`,
            label: category.label,
            value: category.id,
            checked: (user.categories ?? []).includes(category.id),
          }),
        )}
      </div>
      <div class="editor__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-role="cancel">Отмена</button>
        <button class="btn btn--primary btn--sm" type="button" data-role="save">Сохранить</button>
      </div>
    </div>
  </td>`;

  row.after(editor);

  editor.querySelector('[data-role="cancel"]').addEventListener('click', () => editor.remove());
  editor.querySelector('[data-role="save"]').addEventListener('click', async (event) => {
    const save = event.currentTarget;
    save.disabled = true;

    const categories = [...editor.querySelectorAll(`[name="cat-${userId}"]:checked`)].map((input) => input.value);

    try {
      await updateCategories(userId, categories);
      showToast(`Доступ обновлен: категорий — ${categories.length}`, 'success');
      ctx.refresh();
    } catch (error) {
      save.disabled = false;
      showToast(error.message, 'error');
    }
  });
}
