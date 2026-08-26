/** Точка входа: краткое описание системы и переход в свой раздел. */

import { html } from '../../core/utils.js';
import { CATEGORIES } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';
import { currentActor, isAuthenticated, isContractor, isStaff, isSuperadmin } from '../../domain/session.js';
import { listMine, listUndistributed } from '../../domain/signals.js';

export const homeView = {
  live: true,

  render() {
    const actor = currentActor();
    const mine = listMine();
    const activeMine = mine.filter((signal) => isActive(signal.status)).length;

    const categoryCards = CATEGORIES.map(
      (category) => html`<div class="status-card">
        <span class="status-card__dot status-card__dot--${category.id}"></span>
        <div><strong>${category.label}</strong></div>
      </div>`,
    );

    // Действия зависят от роли: у каждого свой единственный правильный следующий шаг.
    let actions;
    if (!isAuthenticated(actor)) {
      actions = html`
        <a class="btn btn--primary btn--lg" href="#/register">Зарегистрировать компанию</a>
        <a class="btn btn--secondary btn--lg" href="#/login">Войти</a>
      `;
    } else if (isContractor(actor)) {
      actions = html`
        <a class="btn btn--primary btn--lg" href="#/new">Задать проблему</a>
        <a class="btn btn--secondary btn--lg" href="#/my">Мои сигналы${mine.length ? ` (${mine.length})` : ''}</a>
      `;
    } else if (isStaff(actor)) {
      const waiting = (listUndistributed() ?? []).length;
      // Сотрудник тоже заводит проблемы, и кнопка нужна ему на видном месте:
      // администратор и руководитель сталкиваются с ними на объекте не реже.
      actions = html`
        <a class="btn btn--primary btn--lg" href="#/new">Сообщить о проблеме</a>
        <a class="btn btn--secondary btn--lg" href="#/admin">Открыть дашборд</a>
        ${[
          isSuperadmin(actor)
            ? html`<a class="btn btn--secondary btn--lg" href="#/admin/distribution"
                >Распределение${waiting ? ` (${waiting})` : ''}</a
              >`
            : '',
        ]}
      `;
    } else {
      actions = html`<a class="btn btn--primary btn--lg" href="#/account">Открыть аккаунт</a>`;
    }

    return html`
      <section class="hero">
        <p class="hero__eyebrow">Единое окно обращений</p>
        <h1 class="hero__title">Сообщите о проблеме на объекте</h1>

        <div class="hero__actions">${[actions]}</div>

        ${[
          isContractor(actor) && activeMine
            ? html`<div class="hero__meta"><span class="hero__pill">В работе: ${activeMine}</span></div>`
            : '',
        ]}
      </section>

      <section class="panel">
        <h2 class="panel__title">Категории распределения</h2>
        <div class="status-cards">${categoryCards}</div>
      </section>
    `;
  },
};
