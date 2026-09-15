/**
 * PMExps — DOM helpers
 *
 * The app never assigns user-controlled data to `innerHTML`. Every piece of
 * text that came from a person — a description, a party name, a remark, a
 * workspace name — reaches the page as a text node via `el()` or `setText()`.
 * `escapeHtml` exists for the two places where a string genuinely must be
 * built (the PDF HTML template and the print view) and is the only sanctioned
 * path there.
 *
 * @module utils/dom
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into an HTML string.
 * Prefer `el()` / `setText()`; use this only when building markup as text.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Escape a value for use inside an HTML attribute built as a string.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttribute(value) {
  return escapeHtml(value).replace(/\r?\n/g, '&#10;');
}

/**
 * Create an element with attributes and children in one call.
 *
 * Children that are strings become text nodes — never parsed as HTML — so
 * `el('td', {}, entry.description)` is safe for any description a user typed.
 *
 * Attribute keys map to real DOM properties where that is safer:
 *   class / className, for / htmlFor, dataset object, aria-* and data-*
 *   passed through setAttribute, and `on*` keys bound as listeners.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {...(Node|string|number|null|undefined|Array<Node|string>)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dKey, dValue] of Object.entries(value)) {
        if (dValue !== null && dValue !== undefined) node.dataset[dKey] = String(dValue);
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [sKey, sValue] of Object.entries(value)) {
        node.style.setProperty(sKey, String(sValue));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

/**
 * @param {Node} parent
 * @param {Array<unknown>} children
 */
export function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

/**
 * Replace an element's contents with the given children. Safe by the same
 * rule as `el()`: strings become text.
 * @param {HTMLElement} node
 * @param {...unknown} children
 * @returns {HTMLElement}
 */
export function replaceChildren(node, ...children) {
  node.textContent = '';
  appendChildren(node, children);
  return node;
}

/**
 * Set text content, tolerating a null node so callers need not guard.
 * @param {Element|null} node
 * @param {unknown} value
 */
export function setText(node, value) {
  if (node) node.textContent = value === null || value === undefined ? '' : String(value);
}

/**
 * Query a single element, typed, scoped to document by default.
 * @param {string} selector
 * @param {ParentNode} [scope]
 * @returns {HTMLElement|null}
 */
export function qs(selector, scope = document) {
  return /** @type {HTMLElement|null} */ (scope.querySelector(selector));
}

/**
 * Query all matching elements as a real array.
 * @param {string} selector
 * @param {ParentNode} [scope]
 * @returns {HTMLElement[]}
 */
export function qsa(selector, scope = document) {
  return /** @type {HTMLElement[]} */ (Array.from(scope.querySelectorAll(selector)));
}

/**
 * Toggle a class, returning the resulting state.
 * @param {Element|null} node
 * @param {string} className
 * @param {boolean} [force]
 * @returns {boolean}
 */
export function toggleClass(node, className, force) {
  if (!node) return false;
  return node.classList.toggle(className, force);
}

/**
 * Show or hide an element using the `hidden` attribute, which screen readers
 * and keyboard navigation both respect — unlike `display:none` applied ad hoc.
 * @param {Element|null} node
 * @param {boolean} visible
 */
export function setVisible(node, visible) {
  if (!node) return;
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}

/**
 * Announce a message to screen readers via the shared live region.
 * `polite` for status updates, `assertive` for errors that interrupt.
 * @param {string} message
 * @param {'polite'|'assertive'} [priority]
 */
export function announce(message, priority = 'polite') {
  const region = document.getElementById(
    priority === 'assertive' ? 'sr-alerts' : 'sr-status',
  );
  if (!region) return;
  // Clearing first guarantees re-announcement of an identical message.
  region.textContent = '';
  window.requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/** Elements that can receive keyboard focus, for focus trapping. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Focusable descendants in document order, excluding hidden ones.
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
export function focusableWithin(container) {
  return qsa(FOCUSABLE, container).filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

/**
 * Trap Tab focus inside a container (dialogs, drawers) and restore focus to
 * the previously active element on release.
 * @param {HTMLElement} container
 * @returns {() => void} release function
 */
export function trapFocus(container) {
  const previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key !== 'Tab') return;
    const focusable = focusableWithin(container);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeydown);
  focusableWithin(container)[0]?.focus();

  return () => {
    container.removeEventListener('keydown', onKeydown);
    previouslyFocused?.focus?.();
  };
}

/**
 * Debounce — used for search inputs so a keystroke does not fire a query.
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} [wait]
 * @returns {F & { cancel: () => void }}
 */
export function debounce(fn, wait = 250) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return /** @type {any} */ (wrapped);
}
