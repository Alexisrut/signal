/** Точка входа: «Задать проблему» + вход в панель управления. */

import { html } from '../../core/utils.js';
import { STATUS_ORDER, STATUS_META, ESCALATION_MS } from '../../core/constants.js';
import { currentActor, isAdmin } from '../../domain/auth.js';
import { listByAuthor } from '../../domain/signals.js';
import { isActive } from '../../domain/state-machine.js';

export const homeView = {
  live: true,

  render() {
    const actor = currentActor();
    const admin = isAdmin(actor);
    const mine = listByAuthor(actor.id);
    const activeMine = mine.filter((s) => isActive(s.status)).length;

    const statusCards = STATUS_ORDER.map(
      (status) => html`<div class="status-card status-card--${status}">
        <span class="status-card__dot"></span>
        <div>
          <strong>${STATUS_META[status].label}</strong>
          <p>${STATUS_META[status].hint}</p>
        </div>
      </div>`,
    );

    return html`
      <section class="hero">
        <p class="hero__eyebrow">Единое окно обращений</p>
        <h1 class="hero__title">Сообщите о проблеме на объекте</h1>
        <p class="hero__lead">
          Сигнал сразу попадает к администраторам и получает статус «Новая проблема».
          Если он не решен в течение ${Math.round(ESCALATION_MS / 3600000)} часов, система
          автоматически повышает его до критичного.
        </p>

        <div class="hero__actions">
          <a class="btn btn--primary btn--lg" href="#/new">Задать проблему</a>
          ${[
            admin
              ? html`<a class="btn btn--secondary btn--lg" href="#/admin">Открыть дашборд</a>`
              : html`<a class="btn btn--secondary btn--lg" href="#/admin/login">Зайти в админ аккаунт</a>`,
          ]}
        </div>

        <div class="hero__meta">
          <a class="link" href="#/my">Мои сигналы${mine.length ? ` (${mine.length})` : ''}</a>
          ${[
            activeMine
              ? html`<span class="hero__pill">В работе: ${activeMine}</span>`
              : '',
          ]}
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Жизненный цикл сигнала</h2>
        <div class="status-cards">${statusCards}</div>
      </section>
    `;
  },
};
