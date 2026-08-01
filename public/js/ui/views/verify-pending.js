/**
 * Экран-заглушка для администратора с неподтвержденной почтой.
 * Пока почта не подтверждена, все маршруты панели управления ведут сюда.
 */

import { html } from '../../core/utils.js';
import { EMAIL_TOKEN_TTL_MS } from '/shared/constants.js';
import * as store from '../../data/store.js';
import { currentActor, resendVerification } from '../../domain/session.js';
import { showToast } from '../chrome.js';

export const verifyPendingView = {
  live: true,

  render() {
    const actor = currentActor();
    const devInbox = store.getState().meta?.mailMode === 'dev-inbox';

    return html`
      <section class="auth auth--wide">
        <h1 class="auth__title">Подтвердите адрес электронной почты</h1>
        <p class="auth__lead">
          Доступ к панели управления откроется после перехода по ссылке из письма, отправленного на
          <b>${actor.email}</b>. Ссылка действует ${Math.round(EMAIL_TOKEN_TTL_MS / 3600000)} ч.
        </p>

        <ol class="steps">
          <li>Откройте письмо «Подтверждение почты».</li>
          <li>Нажмите кнопку «Подтвердить почту».</li>
          <li>Система откроет дашборд — повторный вход не потребуется.</li>
        </ol>

        ${[
          devInbox
            ? html`<p class="form__hint">
                SMTP не настроен, поэтому письмо не ушло наружу, а лежит в
                <a class="link" href="/dev/mailbox" target="_blank" rel="noopener">dev-инбоксе</a>.
              </p>`
            : '',
        ]}

        <div class="page__head-actions">
          <button class="btn btn--primary" data-action="resend">Отправить письмо повторно</button>
          <a class="btn btn--ghost" href="#/">На главную</a>
        </div>
      </section>
    `;
  },

  mount(root) {
    root.querySelector('[data-action="resend"]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;

      try {
        const { delivery } = await resendVerification();
        showToast(
          delivery.mode === 'dev-inbox' ? 'Письмо создано заново — смотрите dev-инбокс' : 'Письмо отправлено повторно',
          'success',
        );
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  },
};
