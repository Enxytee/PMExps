/**
 * PMExps — UI building blocks
 *
 * Form controls, toasts and a confirm dialog. Each one wires its own
 * accessibility: a field links its label, hint and error to the input, the
 * dialog traps focus and restores it, and toasts announce themselves.
 *
 * Doing this once here is what keeps it from being forgotten on the fifth
 * screen, which is where accessibility usually breaks.
 *
 * @module components/ui
 */

import { el, replaceChildren, announce, trapFocus, setText } from '../utils/dom.js';
import { parseAmountToPaise, paiseToInputString, MoneyError } from '../utils/money.js';

let idCounter = 0;
/** @param {string} prefix @returns {string} */
function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * A labelled field with hint and error wiring.
 *
 * @param {object} options
 * @param {string} options.label
 * @param {HTMLElement} options.control the input/select/textarea
 * @param {string} [options.hint]
 * @param {string} [options.error]
 * @param {boolean} [options.required]
 * @returns {HTMLElement}
 */
export function field({ label, control, hint, error, required = false }) {
  const controlId = control.id || uid('field');
  control.id = controlId;
  if (required) control.setAttribute('required', '');

  const describedBy = [];
  const parts = [];

  if (hint) {
    const hintId = `${controlId}-hint`;
    describedBy.push(hintId);
    parts.push(el('p', { class: 'field__hint', id: hintId }, hint));
  }

  if (error) {
    const errorId = `${controlId}-error`;
    describedBy.push(errorId);
    control.setAttribute('aria-invalid', 'true');
    parts.push(el('p', { class: 'field__error', id: errorId }, error));
  } else {
    control.removeAttribute('aria-invalid');
  }

  if (describedBy.length) {
    control.setAttribute('aria-describedby', describedBy.join(' '));
  }

  return el(
    'div',
    { class: 'field' },
    el(
      'label',
      { class: 'field__label', for: controlId },
      label,
      required && el('span', { class: 'u-text-danger', 'aria-hidden': 'true' }, ' *'),
    ),
    control,
    ...parts,
  );
}

/**
 * @param {object} options
 * @returns {HTMLInputElement}
 */
export function textInput({ value = '', onInput, placeholder, maxlength, type = 'text', autocomplete } = {}) {
  return /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'input',
      type,
      value,
      placeholder,
      maxlength,
      autocomplete,
      onInput: (e) => onInput?.(e.target.value),
    })
  );
}

/**
 * @param {object} options
 * @returns {HTMLTextAreaElement}
 */
export function textArea({ value = '', onInput, placeholder, maxlength } = {}) {
  const node = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      class: 'textarea',
      placeholder,
      maxlength,
      onInput: (e) => onInput?.(e.target.value),
    })
  );
  node.value = value;
  return node;
}

/**
 * @param {object} options
 * @param {Array<{value: string, label: string, disabled?: boolean}>} options.options
 * @returns {HTMLSelectElement}
 */
export function select({ value = '', options = [], onChange, placeholder } = {}) {
  const node = /** @type {HTMLSelectElement} */ (
    el('select', { class: 'select', onChange: (e) => onChange?.(e.target.value) })
  );

  if (placeholder) {
    node.appendChild(
      el('option', { value: '', disabled: true, selected: value === '' }, placeholder),
    );
  }

  for (const option of options) {
    node.appendChild(
      el(
        'option',
        { value: option.value, disabled: option.disabled },
        option.label,
      ),
    );
  }

  node.value = value;
  return node;
}

/**
 * Money input.
 *
 * Text, not `type="number"`: a number input in most browsers lets a scroll
 * wheel silently change an amount, rejects "1,25,000" outright, and offers
 * spinner arrows nobody wants on a currency. Instead this accepts what people
 * actually type and converts once, on the way out.
 *
 * `onValue` receives integer paise, or null while the box is empty, or the
 * string 'invalid' when the text cannot be parsed. Callers decide how to
 * present that; this control just reports.
 *
 * @param {object} options
 * @param {number|null} [options.paise]
 * @param {(paise: number|null|'invalid', raw: string) => void} options.onValue
 * @returns {HTMLInputElement}
 */
export function moneyInput({ paise = null, onValue } = {}) {
  const node = /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'input money tnum',
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0.00',
      value: paise === null ? '' : paiseToInputString(paise),
      onInput: (e) => {
        const raw = e.target.value;
        try {
          onValue?.(parseAmountToPaise(raw), raw);
        } catch (error) {
          onValue?.(error instanceof MoneyError ? 'invalid' : 'invalid', raw);
        }
      },
      // Tidy the display on blur so "1250" becomes "1250.00" and the user can
      // see exactly what will be stored.
      onBlur: (e) => {
        try {
          const parsed = parseAmountToPaise(e.target.value);
          if (parsed !== null) e.target.value = paiseToInputString(parsed);
        } catch {
          /* leave the text as typed so the person can correct it */
        }
      },
    })
  );
  return node;
}

/**
 * Native date input. `YYYY-MM-DD` in and out, which is exactly our
 * `ledgerDate` format, so no conversion is needed anywhere.
 * @param {{ value?: string, onChange?: (value: string) => void, max?: string }} options
 * @returns {HTMLInputElement}
 */
export function dateInput({ value = '', onChange, max } = {}) {
  return /** @type {HTMLInputElement} */ (
    el('input', {
      class: 'input',
      type: 'date',
      value,
      max,
      onChange: (e) => onChange?.(e.target.value),
    })
  );
}

/**
 * Segmented control — used for the income/expense switch, where a dropdown
 * would hide the most important choice on the form behind a tap.
 * @param {object} options
 * @param {Array<{value: string, label: string}>} options.options
 * @param {string} options.value
 * @param {(value: string) => void} options.onChange
 * @param {string} options.label accessible group name
 * @returns {HTMLElement}
 */
export function segmented({ options, value, onChange, label }) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });

  for (const option of options) {
    const isSelected = option.value === value;
    group.appendChild(
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(isSelected),
          class: `segmented__option${isSelected ? ' is-selected' : ''}`,
          dataset: { value: option.value },
          onClick: () => onChange(option.value),
        },
        option.label,
      ),
    );
  }

  return group;
}

/* -------------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------------- */

function toastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = el('div', { id: 'toast-region', class: 'toast-region' });
    document.body.appendChild(region);
  }
  return region;
}

/**
 * @param {string} message
 * @param {{ tone?: 'success'|'danger'|'info'|'warning', duration?: number }} [options]
 */
export function toast(message, { tone = 'success', duration = 4000 } = {}) {
  const node = el('div', { class: `toast toast--${tone}`, role: 'status' }, message);
  toastRegion().appendChild(node);

  // The live region announcement is separate from the visual toast, because
  // a toast that disappears after four seconds is useless to someone who
  // cannot see it appear.
  announce(message, tone === 'danger' ? 'assertive' : 'polite');

  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 200);
  }, duration);
}

/* -------------------------------------------------------------------------
   Confirm dialog
   ------------------------------------------------------------------------- */

/**
 * A modal confirmation. Resolves true when confirmed.
 *
 * Destructive actions get an explicit label ("Remove draft"), never a bare
 * "OK", so the button itself says what will happen.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.destructive]
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}) {
  return new Promise((resolve) => {
    const titleId = uid('dialog-title');
    const messageId = uid('dialog-message');

    /** @param {boolean} result */
    function close(result) {
      release();
      backdrop.remove();
      document.body.classList.remove('is-scroll-locked');
      resolve(result);
    }

    const dialog = el(
      'div',
      {
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': messageId,
      },
      el('h2', { id: titleId, class: 'u-text-lg' }, title),
      el('p', { id: messageId, class: 'u-text-secondary u-text-sm' }, message),
      el(
        'div',
        { class: 'dialog__actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => close(false) }, cancelLabel),
        el(
          'button',
          {
            class: `btn ${destructive ? 'btn--danger' : 'btn--primary'}`,
            type: 'button',
            onClick: () => close(true),
          },
          confirmLabel,
        ),
      ),
    );

    const backdrop = el(
      'div',
      {
        class: 'dialog-backdrop',
        onClick: (event) => {
          if (event.target === backdrop) close(false);
        },
      },
      dialog,
    );

    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close(false);
    });

    document.body.appendChild(backdrop);
    document.body.classList.add('is-scroll-locked');
    const release = trapFocus(dialog);
  });
}

/**
 * Put a button into a busy state and return a function that restores it.
 * @param {HTMLButtonElement} button
 * @param {string} busyLabel
 * @returns {() => void}
 */
export function setBusy(button, busyLabel) {
  const original = button.textContent ?? '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setText(button, busyLabel);

  return () => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    setText(button, original);
  };
}

/**
 * Render a block of field errors above a form, for anything not tied to one
 * specific input.
 * @param {HTMLElement} container
 * @param {string|null} message
 */
export function setFormError(container, message) {
  if (!message) {
    replaceChildren(container);
    return;
  }
  replaceChildren(container, el('div', { class: 'alert alert--danger' }, message));
}
