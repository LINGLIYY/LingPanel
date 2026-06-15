/**
 * LingServer Dashboard — Dashboard Shell
 *
 * Renders the full app shell (header, tabs, content area, statusbar) after auth.
 * Delegates tab content to individual tab modules.
 */
import { el, $, $$, setText } from '../utils/dom.js';
import { on, emit, setTab, appState } from '../state.js';
import { logout } from '../auth.js';
import { disconnect } from '../ws.js';
import { icon } from '../utils/icons.js';
import { initControlBar } from '../utils/control-bar.js';

// Track which tabs have been loaded (lazy) — stores module reference for cleanup access
const _tabModule = {};
// Active tab's cleanup function (called before switching away)
let _activeCleanup = null;

// Single source of truth for all tabs — add new tabs here only
const TAB_DEFS = [
  { name: 'overview',  label: '总览',   active: true },
  { name: 'processes', label: '进程',   active: false },
  { name: 'services',  label: '系统服务', active: false },
  { name: 'files',     label: '文件',   active: false },
  { name: 'docker',    label: 'Docker', active: false },
  { name: 'terminal',  label: '终端',   active: false },
  { name: 'logs',      label: '日志',   active: false },
  { name: 'alerts',    label: '告警',   active: false },
];

/**
 * Render the dashboard shell and set up event listeners.
 */
export function renderDashboard() {
  const app = document.querySelector('.app');
  if (!app) return;

  app.innerHTML = '';
  app.className = 'app';
  app.style.cssText = '';

  // ── Header ──
  app.appendChild(_buildHeader());

  // ── Content ──
  const content = el('main', { class: 'content', id: 'main-content', tabindex: '-1' });
  for (const t of TAB_DEFS) {
    const panel = el('div', {
      class: 'tab-panel' + (t.active ? ' active' : ''),
      id: `tab-${t.name}`,
    });
    content.appendChild(panel);
  }
  app.appendChild(content);

  // ── StatusBar ──
  app.appendChild(_buildStatusBar());

  // ── Toast container ──
  app.appendChild(el('div', { class: 'toast-container', id: 'toast-container' }));

  // ── Shared service modal (used by overview launchpad + services tab) ──
  app.appendChild(_buildServiceModal());

  // ── Bindings ──
  _bindTabs();
  _bindHeaderActions();
  _initClock();
  _initTheme();

  // ── Init tabs ──
  initTabs();

  // ── Init control bar (background layer toggles) ──
  initControlBar();
}

// ═══════════════════════════════════════════════════════════
//  Header
// ═══════════════════════════════════════════════════════════

function _buildHeader() {
  return el('header', { class: 'header' },
    el('div', { class: 'header__left' },
      el('a', { href: '#', class: 'header__logo', title: 'LINGLIYY.SERVER' },
        el('span', { class: 'header__logo-dot', id: 'ws-dot' }),
        el('span', {}, 'LINGLIYY.SERVER'),
      ),
      el('nav', { class: 'nav-tabs', id: 'nav-tabs', role: 'tablist' },
        ...TAB_DEFS.map(t => _tab(t.name, t.label, t.active)),
      ),
    ),
    el('div', { class: 'header__right' },
      el('button', { class: 'header__icon-btn', id: 'btn-theme', title: '切换主题', 'aria-label': '切换明暗主题', html: icon('moon') }),
      el('button', { class: 'header__icon-btn', id: 'btn-notify', title: '通知', 'aria-label': '通知中心', html: icon('bell') }),
      el('span', { class: 'header__clock', id: 'clock' }, '--:--:--'),
      el('button', { class: 'header__icon-btn', id: 'btn-logout', title: '登出', 'aria-label': '登出', html: icon('logout') }),
    ),
  );
}

function _tab(name, label, active = false) {
  return el('button', {
    class: 'nav-tab' + (active ? ' active' : ''),
    'data-tab': name,
    role: 'tab',
    'aria-selected': active ? 'true' : 'false',
  }, label);
}

// ═══════════════════════════════════════════════════════════
//  StatusBar
// ═══════════════════════════════════════════════════════════

function _buildStatusBar() {
  return el('footer', { class: 'statusbar' },
    el('div', { class: 'statusbar__left' },
      el('span', {},
        el('span', { class: 'statusbar__dot disconnected', id: 'ws-status-dot' }),
        el('span', { id: 'ws-status-text' }, '未连接'),
      ),
      el('span', { id: 'status-refresh' }, '--'),
    ),
    el('div', { class: 'statusbar__right' },
      el('span', { id: 'status-tz' }, Intl.DateTimeFormat().resolvedOptions().timeZone),
    ),
  );
}

// ═══════════════════════════════════════════════════════════
//  Shared service modal (used by overview launchpad + services tab)
// ═══════════════════════════════════════════════════════════

function _buildServiceModal() {
  return el('div', { class: 'modal-backdrop', id: 'service-modal', 'aria-modal': 'true', role: 'dialog', 'aria-hidden': 'true' },
    el('div', { class: 'modal-shell' },
      el('div', { class: 'modal-card' },
        el('h2', { id: 'service-modal-title' }, el('span', { class: 'prompt' }, '$'), ' ssh-add quick'),
        el('div', { class: 'modal-field' },
          el('label', { class: 'modal-field__label' }, '名称'),
          el('input', { id: 'svc-name', class: 'modal-field__input', placeholder: '服务名称', maxlength: 20 }),
        ),
        el('div', { class: 'modal-field' },
          el('label', { class: 'modal-field__label' }, 'URL'),
          el('input', { id: 'svc-url', class: 'modal-field__input', placeholder: 'https://...', type: 'url' }),
        ),
        el('div', { class: 'modal-field' },
          el('label', { class: 'modal-field__label' }, '描述'),
          el('input', { id: 'svc-desc', class: 'modal-field__input', placeholder: '简短描述', maxlength: 30 }),
        ),
        el('input', { type: 'hidden', id: 'svc-edit-id' }),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'panel__btn', id: 'modal-cancel', onClick: () => {
            const bd = document.getElementById('service-modal');
            if (bd) { bd.classList.add('closing'); bd.setAttribute('aria-hidden', 'true');
              setTimeout(() => bd.classList.remove('open', 'closing'), 200); }
          } }, '取消'),
          el('button', { class: 'panel__btn panel__btn--primary', id: 'modal-submit', onClick: () => {
            if (typeof window._svcTabSubmit === 'function') window._svcTabSubmit();
          } }, '添加入口'),
        ),
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab switching
// ═══════════════════════════════════════════════════════════

function _bindTabs() {
  const nav = $('#nav-tabs');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('.nav-tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  // Arrow key navigation (WCAG 2.1 Tab Panel pattern)
  nav.addEventListener('keydown', (e) => {
    const tabs = Array.from(nav.querySelectorAll('.nav-tab'));
    const idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = tabs[(idx + 1) % tabs.length];
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = tabs[(idx - 1 + tabs.length) % tabs.length];
    } else if (e.key === 'Home') {
      e.preventDefault();
      next = tabs[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      next = tabs[tabs.length - 1];
    }
    if (next) {
      next.focus();
      switchTab(next.dataset.tab);
    }
  });

  // Restore from hash
  const hash = window.location.hash.slice(1);
  if (hash && document.getElementById(`tab-${hash}`)) {
    switchTab(hash);
  }
}

function switchTab(name) {
  // Call cleanup on the previously active tab
  if (_activeCleanup) {
    try { _activeCleanup(); } catch (e) { /* ignore */ }
    _activeCleanup = null;
  }

  setTab(name);

  $$('.nav-tab').forEach(btn => {
    const isActive = btn.dataset.tab === name;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  $$('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${name}`);
  });

  window.location.hash = name;

  // Lazy-load tab content
  loadTab(name).then((mod) => {
    // Store cleanup reference for next switch
    if (mod && typeof mod.cleanup === 'function') {
      _activeCleanup = mod.cleanup;
    }
  });
}

async function loadTab(name) {
  // Return cached module if already loaded
  if (_tabModule[name]) return _tabModule[name];

  const panel = document.getElementById(`tab-${name}`);
  if (!panel) return null;

  try {
    const fnName = 'render' + name[0].toUpperCase() + name.slice(1);
    const mod = await import(`../tabs/${name}.js`);
    mod[fnName](panel);
    _tabModule[name] = mod;
    return mod;
  } catch (e) {
    console.error(`Failed to load tab ${name}:`, e);
    panel.innerHTML = `<div class="status-msg" style="color:var(--red)">加载失败: ${e.message}</div>`;
    return null;
  }
}

export function initTabs() {
  // Load overview immediately
  loadTab('overview');
}
// Also export for external use
export { switchTab, loadTab };

// ═══════════════════════════════════════════════════════════
//  Header actions
// ═══════════════════════════════════════════════════════════

function _bindHeaderActions() {
  const btnLogout = $('#btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      disconnect();
      await logout();
      emit('navigate', 'login');
    });
  }
  // Notification bell → switch to alerts tab
  const btnNotify = $('#btn-notify');
  if (btnNotify) {
    btnNotify.addEventListener('click', () => {
      window.location.hash = '#alerts';
      switchTab('alerts');
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  Clock
// ═══════════════════════════════════════════════════════════

function _initClock() {
  const clockEl = $('#clock');
  let _lastSecond = -1;
  const tick = () => {
    const now = new Date();
    // Only update DOM when the second changes; rAF pauses when tab is hidden
    if (now.getSeconds() !== _lastSecond) {
      _lastSecond = now.getSeconds();
      const time = now.toLocaleTimeString('zh-CN', { hour12: false });
      const date = now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      setText(clockEl, `${time} · ${date}`);
    }
    requestAnimationFrame(tick);
  };
  tick();
}

// ═══════════════════════════════════════════════════════════
//  Theme
// ═══════════════════════════════════════════════════════════

function _initTheme() {
  const saved = localStorage.getItem('ling-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    appState.theme = saved;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    appState.theme = prefersDark ? 'dark' : 'light';
  }

  const btn = $('#btn-theme');
  if (btn) {
    btn.innerHTML = appState.theme === 'dark' ? icon('moon') : icon('sun');
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      _themeRipple(btn, next);
      btn.innerHTML = next === 'dark' ? icon('moon') : icon('sun');
      emit('theme:change', { theme: next });
    });
  }
}

function _themeRipple(btn, targetTheme) {
  const reveal = document.getElementById('theme-reveal');
  if (!reveal) return;

  const btnRect = btn.getBoundingClientRect();
  const size = 16;
  reveal.style.left = (btnRect.left + btnRect.width / 2) + 'px';
  reveal.style.top = (btnRect.top + btnRect.height / 2) + 'px';
  reveal.style.width = size + 'px';
  reveal.style.height = size + 'px';
  reveal.style.marginLeft = -(size / 2) + 'px';
  reveal.style.marginTop = -(size / 2) + 'px';

  const isLight = targetTheme === 'light';
  reveal.className = 'theme-reveal ' + (isLight ? 'theme-reveal--light' : 'theme-reveal--dark');
  reveal.classList.add('active');

  setTimeout(() => {
    document.documentElement.setAttribute('data-theme', targetTheme);
    appState.theme = targetTheme;
    localStorage.setItem('ling-theme', targetTheme);
    if (window._updateImageForTheme) window._updateImageForTheme();
  }, 150);

  setTimeout(() => reveal.classList.remove('active'), 600);
}

// ═══════════════════════════════════════════════════════════
//  WS status update (called from ws.js via state events)
// ═══════════════════════════════════════════════════════════

// Cache status DOM elements once
let _wsDot = null, _wsText = null, _wsHeaderDot = null;

on('ws:change', ({ status }) => {
  // Lazy-init cached refs (DOM is ready when this first fires)
  if (!_wsDot) _wsDot = $('#ws-status-dot');
  if (!_wsText) _wsText = $('#ws-status-text');
  if (!_wsHeaderDot) _wsHeaderDot = $('#ws-dot');

  if (_wsDot) _wsDot.className = 'statusbar__dot ' + status;
  if (_wsText) {
    const labels = { connected: '已连接', reconnecting: '重连中', disconnected: '未连接' };
    setText(_wsText, labels[status] || status);
  }
  if (_wsHeaderDot) {
    const colors = {
      connected: 'var(--status-online)',
      reconnecting: 'var(--status-warning)',
      disconnected: 'var(--status-offline)',
    };
    _wsHeaderDot.style.background = colors[status] || colors.disconnected;
    _wsHeaderDot.style.boxShadow = status === 'connected'
      ? 'var(--status-online-glow)' : 'none';
  }
});
