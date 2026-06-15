/**
 * LingServer Dashboard — Login Screen (dame graft v2)
 *
 * Double-glass login card matching dame/登录页 design:
 * ripple-pulse logo dot, SSH typing line, divider, glass inputs,
 * code-fragment particle burst, blue breathing submit button.
 * Auth logic delegated to auth.js; this is pure UI.
 */
import { el, $ } from '../utils/dom.js';
import { login, changePassword } from '../auth.js';
import { emit } from '../state.js';

let _lockoutTimer = null;

/**
 * Render the login screen (dame double-glass card design).
 */
export function renderLogin() {
  const app = document.querySelector('.app');
  if (!app) return;

  app.innerHTML = '';
  app.className = 'app app--login';
  app.style.cssText = 'display:flex;align-items:center;justify-content:center;';

  // ── Card shell (outer glass) ──
  const shell = el('div', { class: 'card-shell', id: 'card-shell' },
    el('div', { class: 'card' },
      // Dismiss button
      el('button', { class: 'card__dismiss', id: 'card-dismiss', 'aria-label': '收起登录框', title: '收起', type: 'button',
        html: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
      }),

      // Logo
      el('div', { class: 'card__logo' },
        el('div', { class: 'card__logo-dot' }),
        el('span', { class: 'card__logo-text' }, 'LINGLIYY.SERVER'),
      ),

      // SSH typing line
      el('div', { class: 'card__ssh', id: 'ssh-line' },
        el('span', { class: 'card__ssh-prompt' }, '$ ssh admin@ling-server'),
        el('span', { class: 'card__ssh-cursor' }),
      ),

      // Divider
      el('div', { class: 'card__divider' }),

      // Error message
      el('div', { class: 'card__error', id: 'login-error', role: 'alert' },
        el('div', { class: 'card__error-ghost', 'aria-hidden': 'true' },
          el('span', {}, 'SIGKILL'), el('span', {}, 'SIGTERM'), el('span', {}, 'SEGFAULT'),
          el('span', {}, 'ECONNREFUSED'), el('span', {}, 'EACCES'), el('span', {}, 'ENOENT'),
          el('span', {}, '0xDEAD'), el('span', {}, '0xBEEF'), el('span', {}, '0xBAADF00D'),
          el('span', {}, 'PERMISSION'), el('span', {}, 'AUTH_FAILED'), el('span', {}, 'FATAL'),
          el('span', {}, 'EXCEPTION'), el('span', {}, 'STACK_OVERFLOW'), el('span', {}, 'NULL_PTR'),
          el('span', {}, 'BUFFER_OVERFLOW'), el('span', {}, 'ACCESS_VIOLATION'),
          el('span', {}, 'KERNEL_PANIC'), el('span', {}, 'ERR'), el('span', {}, 'ERR'),
          el('span', {}, '0xDEADBEEF'), el('span', {}, 'SIGKILL'), el('span', {}, 'SIGTERM'),
        ),
        el('span', { class: 'card__error-prefix' }, '[ERR]'),
        el('span', { class: 'card__error-text', id: 'error-text' }, ''),
      ),

      // Username
      el('div', { class: 'card__field' },
        el('label', { class: 'card__field-label', for: 'login-user' },
          el('span', { class: 'card__field-prompt' }, 'admin@ling:~$'),
          ' whoami',
        ),
        el('div', { class: 'card__field-input' },
          el('input', { type: 'text', id: 'login-user', placeholder: '输入用户名', autocomplete: 'username', spellcheck: 'false', autofocus: 'true' }),
        ),
      ),

      // Password
      el('div', { class: 'card__field' },
        el('label', { class: 'card__field-label', for: 'login-pass' },
          el('span', { class: 'card__field-prompt' }, 'password:'),
        ),
        el('div', { class: 'card__field-input' },
          el('input', { type: 'password', id: 'login-pass', placeholder: '输入密码', autocomplete: 'current-password' }),
          el('button', { class: 'card__field-toggle', id: 'toggle-pw', 'aria-label': '显示密码', type: 'button',
            html: '<svg id="eye-on" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg id="eye-off" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
          }),
        ),
      ),

      // Submit
      el('button', { class: 'card__submit', id: 'login-submit', type: 'button' },
        el('span', { class: 'btn-text' }, '建 立 连 接'),
        el('span', { class: 'spinner' }),
      ),

      // Footer
      el('div', { class: 'card__footer' },
        el('span', {}, 'LING-SERVER '),
        'v2.0 · 安全连接 · 2026',
      ),
    ),
  );

  // Restore button (hidden until card dismissed)
  const restoreBtn = el('button', { class: 'card__restore', id: 'card-restore', 'aria-label': '展开登录框', title: '展开',
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9l-6 6-6-6"/></svg><span>显示登录</span>',
  });

  app.appendChild(shell);
  app.appendChild(restoreBtn);

  // ── Card dismiss / restore ──
  $('#card-dismiss')?.addEventListener('click', () => {
    shell.classList.add('collapsed');
    restoreBtn.classList.add('visible');
  });
  restoreBtn.addEventListener('click', () => {
    shell.classList.remove('collapsed');
    restoreBtn.classList.remove('visible');
  });

  // ── SSH typing animation ──
  _animateSSHLine();

  // ── Password toggle ──
  const toggleBtn = $('#toggle-pw');
  const passInput = $('#login-pass');
  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passInput.type === 'password';
      passInput.type = isPassword ? 'text' : 'password';
      const eyeOn = toggleBtn.querySelector('#eye-on');
      const eyeOff = toggleBtn.querySelector('#eye-off');
      if (eyeOn) eyeOn.style.display = isPassword ? 'none' : '';
      if (eyeOff) eyeOff.style.display = isPassword ? '' : 'none';
      passInput.focus();
    });
  }

  // ── Submit button ──
  $('#login-submit')?.addEventListener('click', handleLogin);

  // ── Enter key ──
  $('#login-pass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  $('#login-user')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  // ── Clear error on input ──
  $('#login-user')?.addEventListener('input', () => {
    $('#login-user')?.classList.remove('error');
    _hideLoginError();
  });
  $('#login-pass')?.addEventListener('input', () => {
    $('#login-pass')?.classList.remove('error');
    _hideLoginError();
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
    _showLoginError('请输入用户名和密码', false);
    $('#login-user')?.classList.add('error');
    return;
  }
  $('#login-user')?.classList.remove('error');
  $('#login-pass')?.classList.remove('error');
  _hideLoginError();

  // Loading state
  submitBtn?.classList.add('loading');
  submitBtn?.setAttribute('aria-busy', 'true');
  [$('#login-user'), $('#login-pass')].forEach(el => el?.setAttribute('disabled', ''));

  const result = await login(username, password);

  // Reset loading
  submitBtn?.classList.remove('loading');
  submitBtn?.removeAttribute('aria-busy');
  [$('#login-user'), $('#login-pass')].forEach(el => el?.removeAttribute('disabled'));

  if (result.success) {
    if (result.mustChangePassword) {
      showPasswordChange();
    } else {
      emit('navigate', 'dashboard');
    }
    return;
  }

  if (result.locked) {
    _showLoginError(result.error, true);
    startLockoutCountdown(result.error);
  } else {
    _showLoginError(result.error, false);
    _burstParticles();
    $('#login-pass')?.classList.add('error');
    $('#login-pass')?.focus();
  }
}

function _showLoginError(msg, isLocked) {
  const el = $('#login-error');
  if (!el) return;
  const prefix = el.querySelector('.card__error-prefix');
  const text = el.querySelector('.card__error-text');
  if (prefix) {
    prefix.textContent = isLocked ? '[LOCK]' : '[ERR]';
  }
  if (text) text.textContent = msg;
  el.classList.add('visible');
  if (isLocked) {
    el.style.background = 'oklch(0.75 0.15 85 / 0.10)';
    el.style.borderColor = 'oklch(0.75 0.15 85 / 0.30)';
    el.style.color = 'var(--yellow)';
  }
}

function _hideLoginError() {
  const el = $('#login-error');
  if (el) {
    el.classList.remove('visible');
    el.style.background = '';
    el.style.borderColor = '';
    el.style.color = '';
  }
}

function startLockoutCountdown(msg) {
  const submitBtn = $('#login-submit');
  if (submitBtn) submitBtn.disabled = true;
  const match = msg.match(/(\d+)\s*秒/);
  let secs = match ? parseInt(match[1]) : 900;

  if (_lockoutTimer) clearInterval(_lockoutTimer);
  _lockoutTimer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(_lockoutTimer);
      _lockoutTimer = null;
      _hideLoginError();
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    _showLoginError(`登录已锁定，请等待 ${m > 0 ? m + '分' : ''}${s}秒`, true);
  }, 1000);
}

// ── Password change (forced on first login) ──

export function showPasswordChange() {
  const card = document.querySelector('.card');
  if (!card) return;

  card.innerHTML = '';

  card.appendChild(el('div', { class: 'card__logo' },
    el('div', { class: 'card__logo-dot' }),
    el('span', { class: 'card__logo-text' }, 'LINGLIYY.SERVER'),
  ));

  card.appendChild(el('div', { class: 'card__ssh' },
    el('span', { class: 'card__ssh-prompt' }, '$ passwd admin'),
    el('span', { class: 'card__ssh-cursor', style: 'animation:cursor-blink 0.8s step-end infinite' }),
  ));

  card.appendChild(el('div', { class: 'card__divider' }));

  const errorEl = el('div', { class: 'card__error', id: 'login-error', role: 'alert' },
    el('div', { class: 'card__error-ghost', 'aria-hidden': 'true' },
      el('span', {}, 'SIGKILL'), el('span', {}, 'PERMISSION'), el('span', {}, 'AUTH_FAILED'),
      el('span', {}, 'FATAL'), el('span', {}, 'EXCEPTION'), el('span', {}, 'ERR'),
    ),
    el('span', { class: 'card__error-prefix' }, '[ERR]'),
    el('span', { class: 'card__error-text', id: 'error-text' }, ''),
  );
  card.appendChild(errorEl);

  const fields = [
    { id: 'change-old-pass', label: '当前密码', ph: '输入当前密码' },
    { id: 'change-new-pass', label: '新密码', ph: '至少 8 位' },
    { id: 'change-confirm-pass', label: '确认新密码', ph: '再次输入新密码' },
  ];

  fields.forEach(f => {
    card.appendChild(el('div', { class: 'card__field' },
      el('label', { class: 'card__field-label', for: f.id },
        el('span', { class: 'card__field-prompt' }, 'passwd:'),
        ' ' + f.label,
      ),
      el('div', { class: 'card__field-input' },
        el('input', { type: 'password', id: f.id, placeholder: f.ph }),
      ),
    ));
  });

  card.appendChild(el('button', { class: 'card__submit', id: 'login-submit', type: 'button' },
    el('span', { class: 'btn-text' }, '确认修改'),
    el('span', { class: 'spinner' }),
  ));

  card.appendChild(el('div', { class: 'card__footer' },
    el('span', {}, 'LING-SERVER '),
    '首次登录必须修改默认密码',
  ));

  $('#login-submit')?.addEventListener('click', handleChangePassword);
  $('#change-confirm-pass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleChangePassword();
  });
}

async function handleChangePassword() {
  const oldPw = $('#change-old-pass')?.value;
  const newPw = $('#change-new-pass')?.value;
  const confirmPw = $('#change-confirm-pass')?.value;

  if (!oldPw || !newPw) {
    _showLoginError('请填写所有字段', false);
    return;
  }
  if (newPw !== confirmPw) {
    _showLoginError('两次新密码不一致', false);
    return;
  }
  if (newPw.length < 8) {
    _showLoginError('新密码至少 8 位', false);
    return;
  }
  _hideLoginError();

  const submitBtn = $('#login-submit');
  const inputs = [$('#change-old-pass'), $('#change-new-pass'), $('#change-confirm-pass')];
  submitBtn?.classList.add('loading');
  inputs.forEach(el => el?.setAttribute('disabled', ''));

  const result = await changePassword(oldPw, newPw);

  submitBtn?.classList.remove('loading');
  inputs.forEach(el => el?.removeAttribute('disabled'));

  if (result.success) {
    emit('navigate', 'dashboard');
  } else {
    _showLoginError(result.error || '修改失败', false);
  }
}

// ── SSH typing animation ──

function _animateSSHLine() {
  const promptEl = document.querySelector('.card__ssh-prompt');
  const cursorEl = document.querySelector('.card__ssh-cursor');
  if (!promptEl || !cursorEl) return;

  const fullText = '$ ssh admin@ling-server';
  promptEl.textContent = '';
  cursorEl.style.display = 'inline';
  let i = 0;

  function type() {
    if (i < fullText.length) {
      promptEl.textContent += fullText.charAt(i);
      i++;
      setTimeout(type, 40 + Math.random() * 60);
    } else {
      cursorEl.style.animation = 'cursor-blink 0.8s step-end infinite';
    }
  }
  type();
}

// ── Particle burst (code-fragment error effect, dame-style) ──

const CODE_FRAGS = [
  'ERR', 'SIGKILL', 'SIGTERM', 'SEGFAULT', 'EACCES', 'ENOENT',
  '0xDEAD', '0xBEEF', 'FATAL', 'EXCEPTION', 'NULL', 'STACK',
  'ABORT', 'PANIC', '0xFF', 'FAIL', 'CRASH', 'DUMP',
];

function _burstParticles() {
  let canvas = document.getElementById('particle-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'particle-canvas';
    canvas.className = 'particle-canvas';
    document.querySelector('.scene')?.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const particles = [];
  for (let i = 0; i < 35; i++) {
    const frag = CODE_FRAGS[Math.floor(Math.random() * CODE_FRAGS.length)];
    particles.push({
      text: frag,
      x: window.innerWidth / 2 - 60 + Math.random() * 120,
      y: window.innerHeight / 2 - 80 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 3,
      vy: -1.5 - Math.random() * 5,
      life: 1,
      decay: 0.02 + Math.random() * 0.04,
      size: 7 + Math.random() * 6,
      alpha: 0.55 + Math.random() * 0.35,
    });
  }

  function draw() {
    if (particles.length === 0) { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = p.alpha * p.life;
      ctx.font = `${p.size}px "Fira Code", monospace`;
      ctx.fillStyle = p.life > 0.5 ? 'oklch(0.55 0.22 25)' : 'oklch(0.75 0.15 85)';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
