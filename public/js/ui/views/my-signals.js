/**
 * Раздел «Мои сигналы» — личный список, разный по смыслу для двух ролей.
 *
 * У подрядчика это его собственные обращения: сервер отдает в mySignals только
 * сигналы, где он автор. У руководителя и администратора — задачи, за которые
 * он лично отвечает, и сигналы, которые он подал сам.
 *
 * Подрядчику внутренняя кухня не показывается: ни «не распределен», ни
 * «не принят», ни внутренние записи ленты — только его проблема, ее движение
 * и переписка по ней.
 */

import { html, formatDateTime, truncate } from '../../core/utils.js';
import { STATUS, STATUS_META, STATUS_ORDER, SIGNAL_ACTION, categoryLabel } from '/shared/constants.js';
import { can, canComment, canEdit, isInWork } from '/shared/state-machine.js';
import { currentActor, isContractor } from '../../domain/session.js';
import { listMine, findMine, countByStatus, unreadCount, lastAction, reportFiles } from '../../domain/signals.js';
import {
  statusBadge,
  numberTag,
  categoryTag,
  historyList,
  emptyState,
  escalationHint,
  ageLabel,
  attachmentsList,
  attachmentsBadge,
  assigneeChip,
  reportCard,
  resolutionTimer,
  unreadBadge,
} from '../components.js';
import { commentOnSignal, confirmResolution, resolveSignal, returnForRework } from '../signal-actions.js';

/**
 * Сводка подрядчика: сколько обращений он подал за все время и сколько
 * из них решено. Считается только по его собственным сигналам — других
 * в mySignals у подрядчика не бывает по построению.
 */
function contractorStats(signals) {
  const resolved = signals.filter((signal) => signal.status === STATUS.GREEN).length;
  const active = signals.filter((signal) => !STATUS_META[signal.status].terminal).length;

  return html`<div class="stats stats--contractor">
    <div class="stat stat--total">
      <span class="stat__value">${signals.length}</span>
      <span class="stat__label">Всего сигналов за все время</span>
    </div>
    <div class="stat stat--green">
      <span class="stat__value">${resolved}</span>
      <span class="stat__label">Решенных сигналов</span>
    </div>
    <div class="stat stat--yellow">
      <span class="stat__value">${active}</span>
      <span class="stat__label">Сейчас в работе</span>
    </div>
  </div>`;
}

function bindActions(root, find) {
  root.querySelectorAll('[data-resolve]').forEach((button) => {
    button.addEventListener('click', () => resolveSignal(find(button.dataset.resolve), button));
  });
  root.querySelectorAll('[data-comment]').forEach((button) => {
    button.addEventListener('click', () => commentOnSignal(find(button.dataset.comment), button));
  });
  root.querySelectorAll('[data-confirm]').forEach((button) => {
    button.addEventListener('click', () => confirmResolution(find(button.dataset.confirm), button));
  });
  root.querySelectorAll('[data-return]').forEach((button) => {
    button.addEventListener('click', () => returnForRework(find(button.dataset.return), button));
  });
}

/** Плашка над описанием: на каком этапе сигнал и что от подрядчика нужно сейчас. */
function stageCallout(signal, actor) {
  if (signal.status === STATUS.INTAKE) {
    return html`<div class="callout callout--intake">
      <span class="callout__title">Сигнал на входном контроле</span>
      <span class="callout__text">
        Главный администратор проверяет, достаточно ли данных, чтобы передать сигнал в работу. О результате
        придет письмо.
      </span>
    </div>`;
  }

  if (signal.status === STATUS.REWORK) {
    const returned = lastAction(signal, SIGNAL_ACTION.INTAKE_RETURN);
    const mayFix = can(SIGNAL_ACTION.RESUBMIT, signal, actor).allowed;
    return html`<div class="callout callout--rework">
      <span class="callout__title">Сигнал возвращен на доработку</span>
      <span class="callout__text">
        Данных недостаточно, чтобы передать сигнал в работу. Дополните его по комментарию — уточните описание,
        приложите документы или фотографии — и отправьте на повторную проверку.
      </span>
      ${[
        returned
          ? html`<span class="callout__meta">${formatDateTime(returned.at)} · ${returned.byName}</span>
              <div class="callout__quote">${returned.note}</div>`
          : '',
      ]}
      ${[
        mayFix
          ? html`<div class="callout__actions">
              <a class="btn btn--primary" href="#/my/${signal.id}/edit">Доработать и отправить на проверку</a>
            </div>`
          : '',
      ]}
    </div>`;
  }

  if (signal.status === STATUS.CONFIRM) {
    const confirms = can(SIGNAL_ACTION.CONFIRM, signal, actor).allowed;
    return html`<div class="callout callout--confirm">
      <span class="callout__title">Проверьте результат</span>
      <span class="callout__text">
        Ответственный отработал сигнал и направил вам отчет. Если проблема устранена — подтвердите выполнение,
        и сигнал закроется. Если нет или информации недостаточно — верните сигнал на доработку с комментарием.
      </span>
      ${[reportCard(signal, reportFiles(signal))]}
      ${[
        confirms
          ? html`<div class="callout__actions">
              <button class="btn btn--success" data-confirm="${signal.id}">Подтвердить выполнение</button>
              <button class="btn btn--secondary" data-return="${signal.id}">Вернуть на доработку</button>
            </div>`
          : '',
      ]}
    </div>`;
  }

  if (signal.status === STATUS.RETURNED) {
    const returned = lastAction(signal, SIGNAL_ACTION.RETURN);
    return html`<div class="callout callout--returned">
      <span class="callout__title">Сигнал возвращен ответственному на доработку</span>
      <span class="callout__text">
        Ответственный доработает решение и повторно направит вам результат на подтверждение.
      </span>
      ${[
        returned
          ? html`<span class="callout__meta">${formatDateTime(returned.at)} · ${returned.byName}</span>
              <div class="callout__quote">${returned.note}</div>`
          : '',
      ]}
    </div>`;
  }

  if (isInWork(signal.status) && signal.assignees.length) {
    return html`<div class="callout">
      <span class="callout__title">Сигнал в работе</span>
      <span class="callout__text">Ответственные: ${signal.assignees.map((person) => person.name).join(', ')}.</span>
    </div>`;
  }

  return '';
}

/* --------------------------------- Список ------------------------------------ */

export const mySignalsView = {
  live: true,

  render() {
    const actor = currentActor();
    const mine = isContractor(actor);
    const signals = listMine();
    const counters = countByStatus(signals);
    const now = Date.now();

    const empty = mine
      ? emptyState(
          'Пока ни одного сигнала',
          'Здесь появится история ваших обращений и их текущие статусы.',
          html`<a class="btn btn--primary" href="#/new">Задать проблему</a>`,
        )
      : emptyState(
          'На вас пока не назначено ни одной задачи',
          'Сигнал появится здесь, как только администратор назначит вас ответственным.',
          html`<a class="btn btn--secondary" href="#/admin">К карте сигналов</a>`,
        );

    if (!signals.length) {
      return html`
        <section class="page">
          <header class="page__head"><h1 class="page__title">Мои сигналы</h1></header>
          ${[mine ? contractorStats(signals) : '']}
          ${[empty]}
        </section>
      `;
    }

    const rows = signals.map((signal) => {
      const canResolve = mine && can(SIGNAL_ACTION.RESOLVE, signal, actor).allowed;
      const needsFix = mine && signal.status === STATUS.REWORK;
      // Результат ждет проверки автора — это главное действие в строке.
      const needsCheck = can(SIGNAL_ACTION.CONFIRM, signal, actor).allowed;
      // Подрядчик ведет карточку в своем разделе, сотрудник — в рабочей.
      const href = mine ? `#/my/${signal.id}` : `#/admin/signal/${signal.id}`;

      return html`<article class="row row--${signal.status}">
        <div class="row__main">
          <div class="row__head">
            ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
            ${[categoryTag(signal.category, { hideUndistributed: mine })]}
            ${[assigneeChip(signal, { hideFree: mine || !signal.category })]} ${[attachmentsBadge(signal.attachments)]}
            <span class="row__age">Возраст: ${ageLabel(signal, now)}</span>
            ${[mine ? '' : unreadBadge(unreadCount(signal.id))]}
          </div>
          <h3 class="row__title">${signal.contractorName} · ${signal.sector}</h3>
          ${[resolutionTimer(signal, { now })]}
          <p class="row__desc">${truncate(signal.description, 180)}</p>
          <div class="row__foot">
            <span>Создан ${formatDateTime(signal.createdAt)}</span>
            <span>Обновлен ${formatDateTime(signal.updatedAt)}</span>
            ${[escalationHint(signal, now)]}
          </div>
        </div>
        <div class="row__actions">
          ${[needsFix ? html`<a class="btn btn--primary btn--sm" href="#/my/${signal.id}/edit">Доработать</a>` : '']}
          ${[needsCheck ? html`<a class="btn btn--primary btn--sm" href="${href}">Проверить результат</a>` : '']}
          <a class="btn btn--ghost btn--sm" href="${href}">Подробнее</a>
          ${[
            mine && !needsFix && canEdit(signal, actor).allowed
              ? html`<a class="btn btn--ghost btn--sm" href="#/my/${signal.id}/edit">Изменить</a>`
              : '',
          ]}
          ${[
            canResolve
              ? html`<button class="btn btn--success btn--sm" data-resolve="${signal.id}">Проблема решена</button>`
              : '',
          ]}
        </div>
      </article>`;
    });

    const chips = STATUS_ORDER.filter((status) => counters[status] > 0).map(
      (status) =>
        html`<span class="chip chip--static chip--${status}">${STATUS_META[status].label}: ${counters[status]}</span>`,
    );

    return html`
      <section class="page">
        <header class="page__head">
          <div>
            <h1 class="page__title">Мои сигналы</h1>
            <p class="page__lead">
              ${mine
                ? 'Вы видите только собственные сигналы.'
                : 'Задачи, за которые вы отвечаете, и сигналы, которые вы подали.'}
            </p>
          </div>
          ${[mine ? html`<a class="btn btn--primary" href="#/new">Задать проблему</a>` : '']}
        </header>
        ${[mine ? contractorStats(signals) : '']}
        <div class="chips">${chips}</div>
        <div class="rows">${rows}</div>
      </section>
    `;
  },

  mount(root) {
    bindActions(root, findMine);
  },
};

/* --------------------------------- Карточка ---------------------------------- */

export const mySignalView = {
  live: true,

  render(ctx) {
    const actor = currentActor();
    const signal = findMine(ctx.params.id);
    const mine = isContractor(actor);

    if (!signal) {
      return html`
        <section class="page">
          ${[
            emptyState(
              'Сигнал не найден',
              'Возможно, он принадлежит другому подрядчику или был удален.',
              html`<a class="btn btn--secondary" href="#/my">Вернуться к моим сигналам</a>`,
            ),
          ]}
        </section>
      `;
    }

    const canResolve = can(SIGNAL_ACTION.RESOLVE, signal, actor).allowed;
    const comments = canComment(signal, actor).allowed;
    const now = Date.now();
    const assignees = signal.assignees.map((person) => person.name).join(', ');
    const needsFix = signal.status === STATUS.REWORK;

    return html`
      <section class="page">
        <div class="page__crumbs">
          <a class="link link--back" href="#/my">← Мои сигналы</a>
          ${[
            canEdit(signal, actor).allowed
              ? html`<a class="btn btn--secondary btn--sm" href="#/my/${signal.id}/edit">
                  ${needsFix ? 'Доработать' : 'Редактировать'}
                </a>`
              : '',
          ]}
        </div>

        <article class="detail detail--${signal.status}">
          <header class="detail__head">
            <div class="detail__badges">
              ${[numberTag(signal)]} ${[statusBadge(signal.status, { withHint: true })]}
              ${[categoryTag(signal.category, { hideUndistributed: mine })]}
              ${[assigneeChip(signal, { compact: false, hideFree: mine })]}
            </div>
            <h1 class="detail__title">${signal.contractorName}</h1>
            <p class="detail__subtitle">Сектор: ${signal.sector}</p>
          </header>

          ${[stageCallout(signal, actor)]}

          <dl class="detail__facts">
            <div><dt>Номер</dt><dd>${signal.number ? `№${signal.number}` : '—'}</dd></div>
            ${[
              // Пустые «не принят» и «не распределен» подрядчику не показываем.
              assignees ? html`<div><dt>Ответственные</dt><dd>${assignees}</dd></div>` : '',
            ]}
            ${[
              signal.category
                ? html`<div><dt>Категория</dt><dd>${categoryLabel(signal.category)}</dd></div>`
                : '',
            ]}
            <div><dt>Создан</dt><dd>${formatDateTime(signal.createdAt)}</dd></div>
            <div><dt>Обновлен</dt><dd>${formatDateTime(signal.updatedAt)}</dd></div>
            <div><dt>Возраст</dt><dd>${ageLabel(signal, now)}</dd></div>
          </dl>

          <div class="detail__timer">${[resolutionTimer(signal, { now, size: 'lg' })]}</div>

          <div class="detail__section">
            <h2>Описание</h2>
            <p class="detail__text">${signal.description}</p>
          </div>

          ${[
            signal.attachments.length
              ? html`<div class="detail__section">
                  <h2>Вложения (${signal.attachments.length})</h2>
                  ${[attachmentsList(signal.attachments)]}
                </div>`
              : '',
          ]}

          ${[
            signal.status === STATUS.YELLOW || signal.status === STATUS.RETURNED
              ? html`<div class="detail__escalation">${[escalationHint(signal, now)]}</div>`
              : '',
          ]}

          ${[
            // На проверке отчет уже показан в плашке над описанием.
            signal.report && signal.status !== STATUS.CONFIRM
              ? html`<div class="detail__section">
                  <h2>Отчет о выполнении</h2>
                  ${[reportCard(signal, reportFiles(signal), { titled: false })]}
                </div>`
              : '',
          ]}

          <div class="detail__actions">
            ${[
              canResolve
                ? html`<button class="btn btn--success" data-resolve="${signal.id}">Проблема решена — закрыть сигнал</button>`
                : '',
            ]}
            ${[
              comments
                ? html`<button class="btn btn--secondary" data-comment="${signal.id}">Написать комментарий</button>`
                : '',
            ]}
            ${[
              !canResolve && STATUS_META[signal.status].terminal
                ? html`<span class="detail__note">Сигнал закрыт.</span>`
                : '',
            ]}
          </div>

          <div class="detail__section">
            <h2>История и переписка</h2>
            ${[historyList(signal.history)]}
          </div>
        </article>
      </section>
    `;
  },

  mount(root) {
    bindActions(root, findMine);
  },
};
