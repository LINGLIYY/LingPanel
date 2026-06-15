/**
 * LingServer Dashboard — Login Screen
 *
 * Renders login form, handles submit, lockout countdown, and error display.
 */
import { el, $, setText } from '../utils/dom.js';
import { login, changePassword } from '../auth.js';
import { emit } from '../state.js';

let _lockoutTimer = null;

/**
 * Render the login screen into the app container.
 */
export function renderLogin() {
  const app = document.querySelector('.app');
  if (!app) return;

  app.innerHTML = '';
  app.className = 'app app--login';

  const container = el('div', { class: 'login' },
    el('div', { class: 'login__card' },
      // Logo
      el('div', { class: 'login__logo' },
        el('span', { class: 'login__logo-dot' }, ''),
        el('span', {}, 'LINGLIYY.SERVER'),
      ),
      // Title
      el('h1', { class: 'login__title' }, '服务器运维面板'),
      el('p', { class: 'login__subtitle' }, '请登录以继续'),

      // Error
      el('div', { class: 'login__error', id: 'login-error', style: 'display:none;' }),

      // Form
      el('form', { class: 'login__form', id: 'login-form', onSubmit: (e) => { e.preventDefault(); handleLogin(); }},
        el('div', { class: 'login__field' },
          el('label', { for: 'login-user' }, '用户名'),
          el('input', {
            class: 'input', id: 'login-user', type: 'text',
            placeholder: 'admin', autocomplete: 'username',
            autofocus: 'true',
          }),
        ),
        el('div', { class: 'login__field' },
          el('label', { for: 'login-pass' }, '密码'),
          el('input', {
            class: 'input', id: 'login-pass', type: 'password',
            placeholder: '••••••••', autocomplete: 'current-password',
          }),
        ),
        el('button', {
          class: 'btn btn-primary login__submit', id: 'login-submit',
          type: 'submit',
        }, '登 录'),
      ),
    ),
  );

  app.appendChild(container);

  // Enter key on password field submits
  $('#login-pass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
}

/**
 * Handle login form submission.
 */
async function handleLogin() {
  const username = $('#login-user')?.value?.trim();
  const password = $('#login-pass')?.value;
  const errorEl = $('#login-error');
  const submitBtn = $('#login-submit');

  if (!username || !password) {
    showError('请输入用户名和密码');
    return;
  }

  // Disable form
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '登录中...';
  }
  hideError();

  const result = await login(username, password);

  if (result.success) {
    if (result.mustChangePassword) {
      showPasswordChange();
    } else {
      emit('navigate', 'dashboard');
    }
    return;
  }

  // Re-enable
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '登 录';
  }

  if (result.locked) {
    showError(result.error, true);
    startLockoutCountdown(result.error);
  } else {
    showError(result.error, false);
    // Shake
    const form = $('#login-form');
    if (form) {
      form.style.animation = 'none';
      form.offsetHeight; // reflow
      form.style.animation = 'shake 0.4s ease';
    }
    $('#login-pass')?.focus();
  }
}

function showError(msg, isLocked = false) {
  const el = $('#login-error');
  if (!el) return;
  setText(el, msg);
  el.style.display = 'block';
  el.className = 'login__error' + (isLocked ? ' login__error--locked' : '');
}

function hideError() {
  const el = $('#login-error');
  if (el) el.style.display = 'none';
}

function startLockoutCountdown(msg) {
  const submitBtn = $('#login-submit');
  if (submitBtn) submitBtn.disabled = true;

  // Parse seconds from message
  const match = msg.match(/(\d+)\s*秒/);
  let secs = match ? parseInt(match[1]) : 900;

  if (_lockoutTimer) clearInterval(_lockoutTimer);

  _lockoutTimer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(_lockoutTimer);
      _lockoutTimer = null;
      hideError();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '登 录';
      }
      return;
    }
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    const time = m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
    showError(`登录已锁定，请等待 ${time}`, true);
  }, 1000);
}

/**
 * Replace login form with password change form (forced on first login).
 */
function showPasswordChange() {
  const card = document.querySelector('.login__card');
  if (!card) return;

  card.innerHTML = '';

  card.appendChild(el('div', { class: 'login__logo' },
    el('span', { class: 'login__logo-dot' }, ''),
    el('span', {}, 'LINGLIYY.SERVER'),
  ));

  card.appendChild(el('h1', { class: 'login__title' }, '修改密码'));
  card.appendChild(el('p', { class: 'login__subtitle' }, '首次登录需要修改默认密码'));

  const errorEl = el('div', { class: 'login__error', id: 'login-error', style: 'display:none;' });
  card.appendChild(errorEl);

  const form = el('form', { class: 'login__form', onSubmit: (e) => { e.preventDefault(); handleChangePassword(); }});

  form.appendChild(el('div', { class: 'login__field' },
    el('label', { for: 'login-pass' }, '当前密码'),
    el('input', { class: 'input', id: 'change-old-pass', type: 'password', placeholder: '输入当前密码', autocomplete: 'current-password' }),
  ));
  form.appendChild(el('div', { class: 'login__field' },
    el('label', { for: 'login-pass' }, '新密码'),
    el('input', { class: 'input', id: 'change-new-pass', type: 'password', placeholder: '至少 8 位', autocomplete: 'new-password' }),
  ));
  form.appendChild(el('div', { class: 'login__field' },
    el('label', { for: 'login-pass' }, '确认新密码'),
    el('input', { class: 'input', id: 'change-confirm-pass', type: 'password', placeholder: '再次输入新密码', autocomplete: 'new-password' }),
  ));

  form.appendChild(el('button', { class: 'btn btn-primary login__submit', type: 'submit' }, '确认修改'));
  card.appendChild(form);
}

/**
 * Handle password change form submission.
 */
async function handleChangePassword() {
  const oldPw = $('#change-old-pass')?.value;
  const newPw = $('#change-new-pass')?.value;
  const confirmPw = $('#change-confirm-pass')?.value;
  const errorEl = $('#login-error');

  if (!oldPw || !newPw) {
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = '请填写所有字段'; }
    return;
  }
  if (newPw !== confirmPw) {
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = '两次新密码不一致'; }
    return;
  }
  if (newPw.length < 8) {
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = '新密码至少 8 位'; }
    return;
  }

  if (errorEl) errorEl.style.display = 'none';

  const result = await changePassword(oldPw, newPw);
  if (result.success) {
    emit('navigate', 'dashboard');
  } else {
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = result.error || '修改失败'; }
  }
}
