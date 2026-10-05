/**
 * Окно действия с сигналом: комментарий плюс файлы.
 *
 * Им пользуются все шаги, где человек пишет текст: возврат на доработку,
 * комментарий в переписке, отклонение, закрытие. Окно живет вне цикла
 * рендера роутера (см. modal.js): карточка под ним перерисовывается по
 * live-событиям и раз в 15 секунд, а наполовину написанный текст от этого
 * теряться не должен.
 */

import { html } from '../core/utils.js';
import { validateComment } from '/shared/validation.js';
import { bindFileField, fileField } from './components.js';
import { openModal } from './modal.js';

/**
 * @param {object} options
 * @param {string} options.title заголовок окна
 * @param {string} [options.lead] пояснение над полем: что произойдет и что написать
 * @param {string} [options.label] подпись поля
 * @param {string} [options.placeholder]
 * @param {boolean} [options.required] обязателен ли комментарий
 * @param {boolean} [options.withFiles] можно ли приложить файлы
 * @param {string} [options.initialText] текст, с которого начать
 * @param {string} [options.confirmLabel]
 * @param {'primary'|'danger'} [options.tone]
 * @param {(text: string) => string|null} [options.validate] своя проверка текста (например, отчета)
 * @param {number} [options.rows] высота поля
 * @returns {Promise<{comment: string, files: File[]}|null>} null — окно закрыли
 */
export function openActionDialog({
  title,
  lead = '',
  label = 'Комментарий',
  placeholder = '',
  required = false,
  withFiles = true,
  initialText = '',
  confirmLabel = 'Отправить',
  tone = 'primary',
  validate = (text) => validateComment(text, { required }),
  rows = 5,
}) {
  let attachments = null;

  const bodyHtml = html`
    ${[lead ? html`<p class="modal__lead">${lead}</p>` : '']}
    <label class="field" data-field="comment">
      <span class="field__label">${label}${[required ? html`<span class="field__req">*</span>` : '']}</span>
      <textarea class="field__control" name="comment" rows="${rows}" placeholder="${placeholder}">${initialText}</textarea>
      <span class="field__error" data-role="comment-error"></span>
    </label>
    ${[withFiles ? fileField({ label: 'Файлы (необязательно)' }) : '']}
  `;

  return openModal({
    title,
    bodyHtml,
    confirmLabel,
    tone,
    mount: (root) => {
      attachments = withFiles ? bindFileField(root) : null;
      const textarea = root.querySelector('[name="comment"]');
      textarea.addEventListener('input', () => {
        root.querySelector('[data-field="comment"]').classList.remove('is-invalid');
        root.querySelector('[data-role="comment-error"]').textContent = '';
      });
      // Поле ввода — главное в окне: курсор сразу в нем, в конце текста —
      // готовый текст (например, отчет) обычно дополняют, а не переписывают.
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    },
    collect: (root) => {
      const comment = root.querySelector('[name="comment"]').value.trim();
      const error = validate(comment);
      if (error) {
        root.querySelector('[data-field="comment"]').classList.add('is-invalid');
        root.querySelector('[data-role="comment-error"]').textContent = error;
        return null;
      }
      return { comment, files: attachments?.getFiles() ?? [] };
    },
  });
}
