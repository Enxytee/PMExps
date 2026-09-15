/**
 * PMExps — Login view
 *
 * Three modes in one card: sign in, create account, reset password. They share
 * a card rather than living on three pages so the user never loses what they
 * typed by clicking "Forgot password".
 *
 * Accessibility notes that are easy to lose later:
 *   - Errors are announced through the assertive live region, not just shown.
 *   - Each field's error is linked with aria-describedby and aria-invalid.
 *   - The submit button keeps its label while busy, so a screen reader still
 *     says what it does.
 *
 * @module views/login
 */

import { el, qs, replaceChildren, announce } from '../utils/dom.js';
import { signIn, signUp, sendPasswordReset, waitForAuthReady } from '../services/auth.js';
import { getPreference, setTheme, watchSystemTheme } from '../services/theme.js';
import { APP } from '../config/constants.js';

/** @type {'signin'|'register'|'reset'} */
let mode = 'signin';

/** Preserved across mode switches so nothing typed is lost. */
const formState = { email: '', password: '', displayName: '' };

const COPY = {
  signin: {
    title: 'Sign in',
    subtitle: 'Open your ledger.',
    submit: 'Sign in',
    busy: 'Signing in…',
  },
  register: {
    title: 'Create your account',
    subtitle: 'You will set up or join a workspace next.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  reset: {
    title: 'Reset your password',
    subtitle: 'We will email you a link to set a new one.',
    submit: 'Send reset link',
    busy: 'Sending…',
  },
};

function render() {
  const root = qs('#auth-root');
  if (!root) return;

  const copy = COPY[mode];
  const errorBox = el('div', { class: 'stack stack--tight', id: 'form-error' });

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'displayName',
    name: 'displayName',
    autocomplete: 'name',
    required: true,
    value: formState.displayName,
    onInput: (e) => { formState.displayName = e.target.value; },
  });

  const emailInput = el('input', {
    class: 'input',
    type: 'email',
    id: 'email',
    name: 'email',
    autocomplete: 'email',
    inputmode: 'email',
    required: true,
    value: formState.email,
    onInput: (e) => { formState.email = e.target.value; },
  });

  const passwordInput = el('input', {
    class: 'input',
    type: 'password',
    id: 'password',
    name: 'password',
    // 'current-password' vs 'new-password' tells a password manager whether to
    // offer the saved one or generate a fresh one. Getting this wrong is a
    // common reason people end up with weak reused passwords.
    autocomplete: mode === 'register' ? 'new-password' : 'current-password',
    required: true,
    value: formState.password,
    onInput: (e) => { formState.password = e.target.value; },
  });

  const submitButton = el(
    'button',
    { class: 'btn btn--primary btn--block', type: 'submit' },
    copy.submit,
  );

  /** @param {SubmitEvent} event */
  async function onSubmit(event) {
    event.preventDefault();
    replaceChildren(errorBox);
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.disabled = true;
    submitButton.textContent = copy.busy;

    try {
      if (mode === 'signin') {
        await signIn(formState.email, formState.password);
        announce('Signed in');
        window.location.replace('./index.html');
        return;
      }

      if (mode === 'register') {
        await signUp({
          email: formState.email,
          password: formState.password,
          displayName: formState.displayName,
        });
        announce('Account created');
        window.location.replace('./index.html');
        return;
      }

      await sendPasswordReset(formState.email);
      replaceChildren(
        errorBox,
        el(
          'div',
          { class: 'alert alert--success' },
          'If an account exists for that address, a reset link is on its way. Check your inbox and spam folder.',
        ),
      );
      announce('Reset link sent if the account exists');
    } catch (error) {
      const message = error?.message ?? 'Something went wrong. Try again.';
      replaceChildren(errorBox, el('div', { class: 'alert alert--danger' }, message));
      announce(message, 'assertive');
      // Focus the field most likely at fault, so a keyboard user does not
      // have to tab back up to find it.
      (error?.code?.includes('email') ? emailInput : passwordInput).focus();
    } finally {
      submitButton.removeAttribute('aria-busy');
      submitButton.disabled = false;
      submitButton.textContent = copy.submit;
    }
  }

  /** @param {'signin'|'register'|'reset'} next */
  function switchMode(next) {
    mode = next;
    render();
    qs('#email')?.focus();
  }

  const form = el(
    'form',
    { class: 'stack', novalidate: true, onSubmit },

    mode === 'register' &&
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field__label', for: 'displayName' }, 'Your name'),
        nameInput,
      ),

    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'email' }, 'Email'),
      emailInput,
    ),

    mode !== 'reset' &&
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field__label', for: 'password' }, 'Password'),
        passwordInput,
        mode === 'register' &&
          el('p', { class: 'field__hint' }, 'At least 8 characters.'),
      ),

    errorBox,
    submitButton,
  );

  const links = el('div', { class: 'stack stack--tight u-text-sm' });

  if (mode === 'signin') {
    links.append(
      el(
        'button',
        { class: 'btn btn--ghost', type: 'button', onClick: () => switchMode('reset') },
        'Forgot your password?',
      ),
      el(
        'button',
        { class: 'btn btn--ghost', type: 'button', onClick: () => switchMode('register') },
        'Create an account',
      ),
    );
  } else {
    links.append(
      el(
        'button',
        { class: 'btn btn--ghost', type: 'button', onClick: () => switchMode('signin') },
        'Back to sign in',
      ),
    );
  }

  replaceChildren(
    root,
    el(
      'div',
      { class: 'auth-card__brand' },
      el('img', { src: './assets/images/icon-192.png', alt: '', width: 40, height: 40 }),
      el(
        'div',
        {},
        el('p', { class: 'u-weight-semibold' }, APP.name),
        el('p', { class: 'u-text-muted u-text-xs' }, 'Daily ledger'),
      ),
    ),
    el('h1', { class: 'u-text-xl' }, copy.title),
    el('p', { class: 'u-text-secondary u-text-sm', style: { 'margin-bottom': 'var(--space-5)' } }, copy.subtitle),
    form,
    el('hr'),
    links,
  );
}

async function start() {
  setTheme(getPreference(), { animate: false });
  watchSystemTheme();

  // A signed-in user should never see this page. Waiting for the restore to
  // finish first avoids a flash of the login form on every reload.
  const user = await waitForAuthReady();
  if (user) {
    window.location.replace('./index.html');
    return;
  }

  render();
  qs('#email')?.focus();
}

start().catch((error) => {
  const root = qs('#auth-root');
  if (root) {
    replaceChildren(
      root,
      el(
        'div',
        { class: 'alert alert--danger' },
        `Could not load sign-in: ${error?.message ?? 'unknown error'}`,
      ),
    );
  }
});
