/**
 * LingServer Dashboard — Notification Utilities
 *
 * Toast notifications and status bar messages.
 */
import { el } from './dom.js';

const TOAST_DURATION = 4000; // ms
let _toastContainer = null;

function getContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById('toast-container');
    if (!_toastContainer) {
      _toastContainer = el('div', { class: 'toast-container', id: 'toast-container' });
      document.body.appendChild(_toastContainer);
    }
  }
  return _toastContainer;
}

/**
 * Show a toast notification.
 *
 * @param {string} message - The message text.
 * @param {'info'|'success'|'error'|'warning'} level - Severity.
 * @param {number} [duration=4000] - Auto-dismiss in ms.
 */
export function toast(message, level = 'info', duration = TOAST_DURATION) {
  const container = getContainer();

  const icons = { info: 'ℹ', success: '✓', error: '✕', warning: '⚠' };
  const toastEl = el('div', {
    class: `toast toast--${level}`,
    role: 'alert',
  },
    el('span', { class: 'toast__icon' }, icons[level] || ''),
    el('span', { class: 'toast__text' }, message),
  );

  container.appendChild(toastEl);

  // Animate in
  requestAnimationFrame(() => toastEl.classList.add('toast--visible'));

  // Auto-dismiss
  const timer = setTimeout(() => dismiss(toastEl), duration);

  // Click to dismiss
  toastEl.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss(toastEl);
  });

  return toastEl;
}

function dismiss(toastEl) {
  toastEl.classList.remove('toast--visible');
  toastEl.addEventListener('transitionend', () => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, { once: true });
  // Fallback: remove after transition even if event doesn't fire
  setTimeout(() => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, 400);
}

/**
 * Shorthand toast methods.
 */
export const notify = {
  info: (msg) => toast(msg, 'info'),
  success: (msg) => toast(msg, 'success'),
  error: (msg) => toast(msg, 'error'),
  warn: (msg) => toast(msg, 'warning'),
};

/**
 * Show a status bar message (non-intrusive, bottom bar).
 */
export function setStatus(message) {
  const el = document.getElementById('status-refresh');
  if (el) el.textContent = message;
}
