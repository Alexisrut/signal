/**
 * Регистрация подрядчика: название компании, ФИО, почта и пароль.
 *
 * Название компании одновременно служит логином, поэтому оно должно быть
 * уникальным — проверку выполняет сервер, ошибка подсвечивает поле.
 */

import { html } from '../../core/utils.js';
import { validateContractorInput } from '/shared/validation.js';
import { register } from '../../domain/session.js';
import { navigate } from '../router.js';
import { showToast } from '../chrome.js';

const FIELDS = [
  {
    name: 'companyName',
    label: 'Название компании',
    type: 'text',
    placeholder: 'ООО «СтройМонтаж»',
    autocomplete: 'organization',
    hint: 'Это же название будет вашим логином при входе.',
  },
  { name: 'fullName', label: 'ФИО подрядчика', type: 'text', placeholder: 'Иванов Иван Сергеевич', autocomplete: 'name' },
  { name: 'email', label: 'Электронная почта', type: 'email', placeholder: 'company@mail.ru', autocomplete: 'email' },
  { name: 'password', label: 'Пароль', type: 'password', placeholder: 'минимум 6 символов', autocomplete: 'new-password' },
  {
    name: 'password2',
    label: 'Повтор пароля',
    type: 'password',
    placeholder: 'повторите пароль',
    autocomplete: 'new-password',
  },
];

export const registerView = {
  // Форма: автоперерисовка по внешним событиям стерла бы уже введенные данные.
  live: false,

  render() {
    const fields = FIELDS.map(
      (field) => html`<label class="field" data-field="${field.name}">
        <span class="field__label">${field.label}<span class="field__req">*</span></span>
        <input class="field__control" name="${field.name}" type="${field.type}"
          placeholder="${field.placeholder}" autocomplete="${field.autocomplete}" />
        ${[field.hint ? html`<span class="field__hint">${field.hint}</span>` : '']}
        <span class="field__error" data-error-for="${field.name}"></span>
      </label>`,
    );

    return html`
      <section class="auth auth--wide">
        <h1 class="auth__title">Регистрация подрядчика</h1>
        <p class="auth__lead">
          После регистрации откроется личный кабинет: там создаются сигналы о проблемах на объекте
          и видна история их рассмотрения.
        </p>

        <form class="form" id="register-form" novalidate>
          ${fields}
          <div class="form__hint form__hint--error" data-role="summary" hidden></div>
          <div class="wizard__actions">
            <a class="btn btn--ghost" href="#/login">Уже зарегистрированы</a>
            <button class="btn btn--primary" type="submit">Зарегистрироваться</button>
          </div>
        </form>
      </section>
    `;
  },

  mount(root) {
    const form = root.querySelector('#register-form');
    const summary = form.querySelector('[data-role="summary"]');
    const button = form.querySelector('button[type="submit"]');
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
      // Клиентская проверка идет до сети: неполная форма не уходит на сервер.
      event.preventDefault();

      const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
      const { valid, errors } = validateContractorInput(values);

      FIELDS.forEach((field) => setInvalid(field.name, errors[field.name] ?? null));

      if (!valid) {
        summary.hidden = false;
        summary.textContent = 'Заполните подсвеченные поля — учетная запись не создана.';
        controls.get(FIELDS.find((field) => errors[field.name]).name).focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Создаем учетную запись…';

      try {
        const user = await register(values);
        showToast(`Компания «${user.companyName}» зарегистрирована`, 'success');
        navigate('/my');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Зарегистрироваться';
        summary.hidden = false;
        summary.textContent = error.message;
        if (error.errors) {
          for (const [name, message] of Object.entries(error.errors)) setInvalid(name, message);
          const first = FIELDS.find((field) => error.errors[field.name]);
          if (first) controls.get(first.name).focus();
        }
      }
    });
  },
};
