/**
 * LingServer Dashboard — Confirm Modal
 *
 * Promise-based confirm/alert replacement using dame's modal styles.
 * Usage:
 *   const ok = await confirm('确定删除？', '删除服务');
 *   await alert('操作成功', '提示');
 */
import { el } from './dom.js';

let _activeTrap = null;
let _focusRestore = null;

// ── Shared modal utilities ──

function trapFocus(backdrop) {
  _focusRestore = document.activeElement;
  const card = backdrop.querySelector('.modal-card');
  if (!card) return;
  const focusable = card.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (focusable.length > 0) focusable[0].focus();

  function onKey(e) {
    if (e.key === 'Escape') { closeBackdrop(backdrop); return; }
    if (e.key !== 'Tab') return;
    const f = card.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (f.length === 0) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey);
  _activeTrap = onKey;
}

function releaseTrap() {
  if (_activeTrap) { document.removeEventListener('keydown', _activeTrap); _activeTrap = null; }
  if (_focusRestore && typeof _focusRestore.focus === 'function') {
    try { _focusRestore.focus(); } catch (_) {}
    _focusRestore = null;
  }
}

function openBackdrop(backdrop) {
  backdrop.classList.remove('closing');
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
  setTimeout(() => trapFocus(backdrop), 50);
}

function closeBackdrop(backdrop) {
  releaseTrap();
  backdrop.classList.add('closing');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('animationend', () => {
    backdrop.classList.remove('open', 'closing');
  }, { once: true });
  setTimeout(() => backdrop.classList.remove('open', 'closing'), 220);
}

// ── Build / ensure DOM ──

let _confirmModal = null;

function ensureConfirmDOM() {
  if (_confirmModal) return _confirmModal;

  const backdrop = el('div', { class: 'modal-backdrop', id: 'confirm-modal', 'aria-hidden': 'true' },
    el('div', { class: 'modal-shell' },
      el('div', { class: 'modal-card' },
        el('div', { class: 'modal-title', id: 'confirm-title' }, '确认操作'),
        el('div', { style: 'font-size:13px;color:var(--t-body);margin-bottom:20px', id: 'confirm-msg' }, ''),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'modal-btn modal-btn--cancel', id: 'confirm-cancel' }, '取消'),
          el('button', { class: 'modal-btn modal-btn--submit', id: 'confirm-ok' }, '确认'),
        ),
      ),
    ),
  );

  document.body.appendChild(backdrop);
  _confirmModal = backdrop;
  return backdrop;
}

// ── Public API ──

/**
 * Show a confirm dialog. Returns true if confirmed, false if cancelled.
 * @param {string} message
 * @param {string} [title='确认操作']
 * @param {'danger'|'info'|'warning'} [variant='danger']
 * @returns {Promise<boolean>}
 */
export function confirm(message, title = '确认操作', variant = 'danger') {
  const modal = ensureConfirmDOM();
  const titleEl = modal.querySelector('#confirm-title');
  const msgEl = modal.querySelector('#confirm-msg');
  const okBtn = modal.querySelector('#confirm-ok');

  titleEl.textContent = title;
  msgEl.textContent = message;

  if (variant === 'danger') {
    okBtn.style.background = 'var(--red)';
    okBtn.style.boxShadow = '0 2px 12px oklch(0.55 0.22 25 / 0.25)';
  } else {
    okBtn.style.background = 'var(--blue)';
    okBtn.style.boxShadow = '0 2px 12px oklch(0.55 0.18 255 / 0.25)';
  }

  openBackdrop(modal);

  return new Promise((resolve) => {
    function close(result) {
      closeBackdrop(modal);
      resolve(result);
      // Clean up listeners
      okBtn.removeEventListener('click', onOk);
      modal.querySelector('#confirm-cancel').removeEventListener('click', onCancel);
    }

    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBackdropClick(e) { if (e.target === modal) close(false); }
    function onEsc(e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        close(false);
        document.removeEventListener('keydown', onEsc);
      }
    }

    okBtn.addEventListener('click', onOk);
    modal.querySelector('#confirm-cancel').addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onEsc);
  });
}

/**
 * Show an alert dialog (single OK button).
 * @param {string} message
 * @param {string} [title='提示']
 * @returns {Promise<void>}
 */
export function alert(message, title = '提示') {
  const modal = ensureConfirmDOM();
  const titleEl = modal.querySelector('#confirm-title');
  const msgEl = modal.querySelector('#confirm-msg');
  const okBtn = modal.querySelector('#confirm-ok');
  const cancelBtn = modal.querySelector('#confirm-cancel');

  titleEl.textContent = title;
  msgEl.textContent = message;
  okBtn.style.background = 'var(--blue)';
  okBtn.style.boxShadow = '0 2px 12px oklch(0.55 0.18 255 / 0.25)';
  okBtn.textContent = '确定';
  cancelBtn.style.display = 'none';

  openBackdrop(modal);

  return new Promise((resolve) => {
    function close() {
      cancelBtn.style.display = '';  // restore
      okBtn.textContent = '确认';    // restore
      closeBackdrop(modal);
      resolve();
      okBtn.removeEventListener('click', onOk);
    }

    function onOk() { close(); }
    function onBackdropClick(e) { if (e.target === modal) close(); }
    function onEsc(e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        close();
        document.removeEventListener('keydown', onEsc);
      }
    }

    okBtn.addEventListener('click', onOk);
    modal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onEsc);
  });
}
