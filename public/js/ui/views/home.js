/** Точка входа: краткое описание системы и переход в свой раздел. */

import { html } from '../../core/utils.js';
import { STATUS_ORDER, STATUS_META, CATEGORIES, ESCALATION_MS } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';
import { currentActor, isAuthenticated, isContractor, isSuperadmin, isVerifiedAdmin } from '../../domain/session.js';
import { listMine, listUndistributed } from '../../domain/signals.js';

export const homeView = {
  live: true,

  render() {
    const actor = currentActor();
    const mine = listMine();
    const activeMine = mine.filter((signal) => isActive(signal.status)).length;

    const statusCards = STATUS_ORDER.map(
      (status) => html`<div class="status-card status-card--${status}">
        <span class="status-card__dot"></span>
        <div>
          <strong>${STATUS_META[status].label}</strong>
          <p>${STATUS_META[status].hint}</p>
        </div>
      </div>`,
    );

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
    } else if (isVerifiedAdmin(actor)) {
      const waiting = (listUndistributed() ?? []).length;
      actions = html`
        <a class="btn btn--primary btn--lg" href="#/admin">Открыть дашборд</a>
        ${[
          isSuperadmin(actor)
            ? html`<a class="btn btn--secondary btn--lg" href="#/admin/distribution"
                >Распределение${waiting ? ` (${waiting})` : ''}</a
              >`
            : '',
        ]}
      `;
    } else {
      actions = html`<a class="btn btn--primary btn--lg" href="#/admin/verify">Подтвердить почту</a>`;
    }

    return html`
      <section class="hero">
        <p class="hero__eyebrow">Единое окно обращений</p>
        <h1 class="hero__title">Сообщите о проблеме на объекте</h1>
        <p class="hero__lead">
          Сигнал сразу получает статус «Новая проблема» и попадает главному администратору
          на распределение по категориям. Если проблема не решена в течение
          ${Math.round(ESCALATION_MS / 3600000)} часов, система автоматически повышает сигнал
          до критичного и рассылает уведомления.
        </p>

        <div class="hero__actions">${[actions]}</div>

        ${[
          isContractor(actor) && activeMine
            ? html`<div class="hero__meta"><span class="hero__pill">В работе: ${activeMine}</span></div>`
            : '',
        ]}
      </section>

      <section class="panel">
        <h2 class="panel__title">Жизненный цикл сигнала</h2>
        <div class="status-cards">${statusCards}</div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Категории распределения</h2>
        <div class="status-cards">${categoryCards}</div>
      </section>
    `;
  },
};
