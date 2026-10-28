/** Точка входа: краткое описание системы и переход в свой раздел. */

import { html, formatDateTime } from '../../core/utils.js';
import { APPROVAL, CATEGORIES, STATUS } from '/shared/constants.js';
import { isActive } from '/shared/state-machine.js';
import {
  currentActor,
  isAuthenticated,
  isAwaitingApproval,
  isContractor,
  isStaff,
  isSuperadmin,
} from '../../domain/session.js';
import { listMine, inputControlCount } from '../../domain/signals.js';

/**
 * Экран подрядчика, чья заявка на регистрацию еще не подтверждена или
 * отклонена. Других разделов у него нет: он ждет решения главного
 * администратора, и экран сам сменится кабинетом, когда заявку подтвердят.
 */
function approvalScreen(actor) {
  const rejected = actor.approval === APPROVAL.REJECTED;
  return html`
    <section class="hero">
      <p class="hero__eyebrow">${actor.companyName ?? actor.displayName}</p>
      <h1 class="hero__title">${rejected ? 'Заявка на регистрацию отклонена' : 'Заявка на регистрацию на проверке'}</h1>
      <div class="callout ${rejected ? 'callout--rejected' : 'callout--intake'} approval-screen">
        ${[
          rejected
            ? html`<span class="callout__text">
                  Главный администратор отклонил заявку${actor.approvalAt ? ` ${formatDateTime(actor.approvalAt)}` : ''}.
                  Если это ошибка, свяжитесь с ним.
                </span>
                ${[actor.approvalNote ? html`<div class="callout__quote">${actor.approvalNote}</div>` : '']}`
            : html`<span class="callout__text">
                Главный администратор проверит данные вашей компании. Как только заявка будет подтверждена,
                придет письмо на ${actor.email}, а здесь откроется личный кабинет: отправка сигналов о
                проблемах на объекте и история их рассмотрения.
              </span>`,
        ]}
      </div>
    </section>
  `;
}

export const homeView = {
  live: true,

  render() {
    const actor = currentActor();
    if (isAwaitingApproval(actor)) return approvalScreen(actor);

    const mine = listMine();
    const activeMine = mine.filter((signal) => isActive(signal.status)).length;
    // Сигналы, по которым ход за подрядчиком: дополнить или проверить результат.
    const awaitingMe = mine.filter((signal) => signal.status === STATUS.REWORK || signal.status === STATUS.CONFIRM).length;

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
      const waiting = inputControlCount();
      // Сотрудник тоже заводит проблемы, и кнопка нужна ему на видном месте:
      // администратор и руководитель сталкиваются с ними на объекте не реже.
      actions = html`
        <a class="btn btn--primary btn--lg" href="#/new">Сообщить о проблеме</a>
        <a class="btn btn--secondary btn--lg" href="#/admin">Открыть дашборд</a>
        ${[
          isSuperadmin(actor)
            ? html`<a class="btn btn--secondary btn--lg" href="#/admin/distribution"
                >Входной контроль${waiting ? ` (${waiting})` : ''}</a
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
            ? html`<div class="hero__meta">
                <span class="hero__pill">В работе: ${activeMine}</span>
                ${[awaitingMe ? html`<a class="hero__pill" href="#/my">Ждут вашего ответа: ${awaitingMe}</a>` : '']}
              </div>`
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
