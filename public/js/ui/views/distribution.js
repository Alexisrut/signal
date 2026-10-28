/**
 * Раздел «Входной контроль» — видит только главный администратор.
 *
 * Сюда попадает каждый новый сигнал. Прежде чем уйти в работу, он проходит
 * проверку: достаточно ли в нем данных, чтобы ответственный мог действовать.
 *
 *   • данных достаточно — выбирается категория, и в открывшемся окне задачу
 *     выдают одному или нескольким ответственным (с заметкой для них);
 *   • данных мало — сигнал возвращается подрядчику с комментарием, что
 *     дополнить. Доработанный сигнал снова приходит сюда же.
 *
 * Сигналы на доработке у подрядчика показаны отдельной группой: действовать
 * по ним пока не нужно, но видеть, что они ждут ответа, полезно.
 *
 * Сюда же приходят заявки новых подрядчиков: зарегистрировавшись, подрядчик
 * не может отправлять сигналы, пока главный администратор не подтвердит его.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { CATEGORIES, SIGNAL_ACTION, STATUS, categoryLabel } from '/shared/constants.js';
import { can, isTerminal } from '/shared/state-machine.js';
import {
  currentActor,
  decideContractor,
  listPendingContractors,
  listRejectedContractors,
} from '../../domain/session.js';
import { listUndistributed, authorLabel, distribute, lastAction } from '../../domain/signals.js';
import {
  statusBadge,
  numberTag,
  emptyState,
  ageLabel,
  attachmentsBadge,
  attachmentsList,
  resolutionTimer,
} from '../components.js';
import { openAssignDialog } from '../assign-dialog.js';
import { rejectSignal, returnToContractor } from '../signal-actions.js';
import { openActionDialog } from '../action-dialog.js';
import { confirmDialog } from '../modal.js';
import { showToast } from '../chrome.js';

const findSignal = (id) => (listUndistributed() ?? []).find((item) => item.id === id);

/** Сигнал на проверке: категории для распределения и возврат на доработку. */
function intakeRow(signal, actor, now) {
  const buttons = CATEGORIES.map(
    (category) => html`<button class="btn btn--secondary btn--sm" data-signal="${signal.id}"
      data-category="${category.id}" title="Распределить в категорию «${category.label}»">
      ${category.label}
    </button>`,
  );

  // Доработанный сигнал приходит с ответом подрядчика — его видно сразу.
  const resubmitted = lastAction(signal, SIGNAL_ACTION.RESUBMIT);

  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">
        ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
        ${[attachmentsBadge(signal.attachments)]}
        <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
      </div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      ${[resolutionTimer(signal, { now })]}
      <p class="row__desc">${truncate(signal.description, 240)}</p>
      ${[signal.attachments.length ? attachmentsList(signal.attachments, { compact: true }) : '']}
      ${[
        resubmitted
          ? html`<div class="callout callout--intake">
              <span class="callout__title">Доработан подрядчиком ${formatDateTime(resubmitted.at)}</span>
              <div class="callout__quote">${resubmitted.note}</div>
            </div>`
          : '',
      ]}
      <div class="row__foot">
        <span>Автор: ${authorLabel(signal.id)}</span>
        <span>Создан ${formatDateTime(signal.createdAt)}</span>
      </div>
      <div class="distribute">
        <span class="distribute__label">Данных достаточно — распределить в категорию:</span>
        <div class="distribute__actions">${buttons}</div>
      </div>
      <div class="intake-actions">
        ${[
          can(SIGNAL_ACTION.INTAKE_RETURN, signal, actor).allowed
            ? html`<button class="btn btn--secondary btn--sm" data-action="return" data-signal="${signal.id}">
                Вернуть подрядчику на доработку
              </button>`
            : '',
        ]}
        ${[
          can(SIGNAL_ACTION.REJECT, signal, actor).allowed
            ? html`<button class="btn btn--muted btn--sm" data-action="reject" data-signal="${signal.id}">
                Отклонить
              </button>`
            : '',
        ]}
      </div>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

/** Сигнал на доработке: что попросили дополнить и когда. */
function reworkRow(signal, now) {
  const returned = lastAction(signal, SIGNAL_ACTION.INTAKE_RETURN);

  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">
        ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
        ${[attachmentsBadge(signal.attachments)]}
        <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
      </div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      <p class="row__desc">${truncate(signal.description, 180)}</p>
      ${[
        returned
          ? html`<div class="callout callout--rework">
              <span class="callout__title">Возвращен ${formatDateTime(returned.at)} · ${returned.byName}</span>
              <div class="callout__quote">${returned.note}</div>
            </div>`
          : '',
      ]}
      <div class="row__foot">
        <span>Автор: ${authorLabel(signal.id)}</span>
        <span>Создан ${formatDateTime(signal.createdAt)}</span>
      </div>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

/** Закрытые без распределения — коротко, для справки. */
function closedRow(signal) {
  return html`<article class="row row--${signal.status}">
    <div class="row__main">
      <div class="row__head">${[numberTag(signal)]} ${[statusBadge(signal.status)]}</div>
      <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
      <p class="row__desc">${truncate(signal.description, 140)}</p>
    </div>
    <div class="row__actions">
      <a class="btn btn--ghost btn--sm" href="#/admin/signal/${signal.id}">Подробнее</a>
    </div>
  </article>`;
}

/** Заявка нового подрядчика: данные компании и решение — подтвердить или отклонить. */
function applicationRow(user) {
  return html`<article class="row row--intake">
    <div class="row__main">
      <div class="row__head">
        <span class="badge badge--intake"><span class="badge__dot"></span>Заявка подрядчика</span>
        ${[
          user.isEmailVerified
            ? html`<span class="pill pill--ok">почта подтверждена</span>`
            : html`<span class="pill pill--warn">почта не подтверждена</span>`,
        ]}
      </div>
      <h3 class="row__title">${user.companyName ?? user.login}</h3>
      <div class="row__foot">
        <span>ФИО: ${user.fullName ?? '—'}</span>
        <span>Email: ${user.email}</span>
        <span>Зарегистрирован ${formatDateTime(user.createdAt)}</span>
      </div>
      <div class="intake-actions">
        <button class="btn btn--success btn--sm" data-approve="${user.id}">Подтвердить подрядчика</button>
        <button class="btn btn--muted btn--sm" data-reject-contractor="${user.id}">Отклонить</button>
      </div>
    </div>
  </article>`;
}

/** Отклоненная заявка — на случай, если отклонили по ошибке. */
function rejectedApplicationRow(user) {
  return html`<article class="row row--gray">
    <div class="row__main">
      <div class="row__head">
        <span class="badge badge--gray"><span class="badge__dot"></span>Заявка отклонена</span>
      </div>
      <h3 class="row__title">${user.companyName ?? user.login}</h3>
      <div class="row__foot">
        <span>ФИО: ${user.fullName ?? '—'}</span>
        <span>Email: ${user.email}</span>
        <span>Отклонена ${formatDateTime(user.approvalAt)}${user.approvalBy ? ` · ${user.approvalBy}` : ''}</span>
      </div>
      ${[user.approvalNote ? html`<div class="callout__quote">${user.approvalNote}</div>` : '']}
    </div>
    <div class="row__actions">
      <button class="btn btn--ghost btn--sm" data-approve="${user.id}">Подтвердить</button>
    </div>
  </article>`;
}

function group(title, rows) {
  if (!rows.length) return '';
  return html`<section class="intake-group">
    <h2 class="intake-group__title">${title} (${rows.length})</h2>
    <div class="rows">${rows}</div>
  </section>`;
}

export const distributionView = {
  live: true,

  render() {
    const actor = currentActor();
    const signals = listUndistributed() ?? [];
    const now = Date.now();

    const awaiting = signals.filter((signal) => signal.status === STATUS.INTAKE);
    const rework = signals.filter((signal) => signal.status === STATUS.REWORK);
    const closed = signals.filter((signal) => isTerminal(signal.status));
    const applications = listPendingContractors();
    const rejectedApplications = listRejectedContractors();

    const head = html`<header class="page__head">
      <div>
        <h1 class="page__title">Входной контроль</h1>
        <p class="page__lead">
          Новый сигнал уходит в работу только после проверки: хватает данных — распределите его
          ответственному, не хватает — верните подрядчику с комментарием, что дополнить. Здесь же
          подтверждаются новые подрядчики: до этого они не могут отправлять сигналы.
        </p>
      </div>
      <a class="btn btn--secondary" href="#/admin">К карте сигналов</a>
    </header>`;

    const rejectedGroup = group('Отклоненные заявки подрядчиков', rejectedApplications.map(rejectedApplicationRow));

    if (!awaiting.length && !rework.length && !applications.length) {
      return html`<section class="page">
        ${[head]}
        ${[
          emptyState(
            'Новых сигналов и заявок нет',
            'Как только подрядчик зарегистрируется, создаст или доработает обращение, оно появится здесь.',
            html`<a class="btn btn--primary" href="#/admin">Открыть дашборд</a>`,
          ),
        ]}
        ${[group('Закрыты без распределения', closed.map(closedRow))]}
        ${[rejectedGroup]}
      </section>`;
    }

    return html`
      <section class="page">
        ${[head]}
        ${[group('Новые подрядчики', applications.map(applicationRow))]}
        ${[group('Ожидают проверки', awaiting.map((signal) => intakeRow(signal, actor, now)))]}
        ${[group('На доработке у подрядчика', rework.map((signal) => reworkRow(signal, now)))]}
        ${[group('Закрыты без распределения', closed.map(closedRow))]}
        ${[rejectedGroup]}
      </section>
    `;
  },

  mount(root) {
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const signalId = button.dataset.signal;
        const category = button.dataset.category;

        // Категория выбрана — дальше решаем, кому именно выдать задачу.
        const picked = await openAssignDialog({
          signal: findSignal(signalId),
          category,
          title: `Распределить в «${categoryLabel(category)}»`,
          confirmLabel: 'Передать в работу',
          requireAssignee: true,
        });
        if (!picked) return;

        const group = button.closest('.distribute__actions');
        group?.querySelectorAll('button').forEach((item) => (item.disabled = true));

        try {
          const updated = await distribute(signalId, category, picked.assignees, picked.note);
          showToast(
            `Сигнал передан в работу: «${categoryLabel(updated.category)}», ответственных — ${updated.assignees.length}`,
            'success',
          );
        } catch (error) {
          group?.querySelectorAll('button').forEach((item) => (item.disabled = false));
          showToast(error.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-action="return"]').forEach((button) => {
      button.addEventListener('click', () => returnToContractor(findSignal(button.dataset.signal), button));
    });

    root.querySelectorAll('[data-action="reject"]').forEach((button) => {
      button.addEventListener('click', () => rejectSignal(findSignal(button.dataset.signal), button));
    });

    root.querySelectorAll('[data-approve]').forEach((button) => {
      button.addEventListener('click', () => approveContractor(button.dataset.approve, button));
    });

    root.querySelectorAll('[data-reject-contractor]').forEach((button) => {
      button.addEventListener('click', () => rejectContractor(button.dataset.rejectContractor, button));
    });
  },
};

const findApplication = (id) => [...listPendingContractors(), ...listRejectedContractors()].find((user) => user.id === id);

/** Подтверждение подрядчика открывает ему отправку сигналов и все разделы. */
async function approveContractor(userId, button) {
  const user = findApplication(userId);
  const confirmed = await confirmDialog({
    title: 'Подтвердить подрядчика',
    message: `Компания «${user?.companyName ?? ''}» получит доступ к системе: сможет отправлять сигналы и пользоваться всеми разделами. Подрядчику придет письмо.`,
    confirmLabel: 'Подтвердить',
    tone: 'primary',
  });
  if (!confirmed) return;

  button.disabled = true;
  try {
    await decideContractor(userId, 'approve');
    showToast(`Подрядчик «${user?.companyName ?? ''}» подтвержден`, 'success');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

/** Отклонение заявки — с обязательной причиной: подрядчик увидит ее и получит письмом. */
async function rejectContractor(userId, button) {
  const user = findApplication(userId);
  const picked = await openActionDialog({
    title: `Отклонить заявку · ${user?.companyName ?? ''}`,
    lead: 'Подрядчик не получит доступа к системе. Причину он увидит при входе и получит письмом.',
    label: 'Причина',
    placeholder: 'Например: компания не участвует в работах на объекте',
    required: true,
    withFiles: false,
    confirmLabel: 'Отклонить заявку',
    tone: 'danger',
  });
  if (!picked) return;

  button.disabled = true;
  try {
    await decideContractor(userId, 'reject', picked.comment);
    showToast('Заявка подрядчика отклонена', 'success');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}
