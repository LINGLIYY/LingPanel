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

// Track which tabs have been loaded (lazy)
const _tabLoaded = {};
// Active tab's cleanup function (called before switching away)
let _activeCleanup = null;

// Single source of truth for all tabs — add new tabs here only
const TAB_DEFS = [
  { name: 'overview',  label: '总览',   active: true },
  { name: 'processes', label: '进程',   active: false },
  { name: 'services',  label: '服务',   active: false },
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

  // ── Bindings ──
  _bindTabs();
  _bindHeaderActions();
  _initClock();
  _initTheme();

  // ── Init tabs ──
  initTabs();
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
  if (_tabLoaded[name]) return;
  _tabLoaded[name] = true;

  const panel = document.getElementById(`tab-${name}`);
  if (!panel) return;

  try {
    const fnName = 'render' + name[0].toUpperCase() + name.slice(1);
    const mod = await import(`../tabs/${name}.js`);
    mod[fnName](panel);
  } catch (e) {
    console.error(`Failed to load tab ${name}:`, e);
    panel.innerHTML = `<div class="status-msg" style="color:var(--red)">加载失败: ${e.message}</div>`;
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
      document.documentElement.setAttribute('data-theme', next);
      appState.theme = next;
      localStorage.setItem('ling-theme', next);
      btn.innerHTML = next === 'dark' ? icon('moon') : icon('sun');
      emit('theme:change', { theme: next });
    });
  }
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
