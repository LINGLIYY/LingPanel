/**
 * LingServer Dashboard — Terminal Tab (dame graft)
 *
 * xterm.js + WebSocket PTY terminal with session management.
 * Core PTY logic retained from main line; dame visual theme applied.
 * Features: multi-session, attach/detach, resize, font zoom, clipboard.
 */
import { el, clear, $ } from '../utils/dom.js';
import { comm } from '../comm.js';
const { get, del } = comm.rest;
import { icon } from '../utils/icons.js';
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';

let _terminal = null;
let _fitAddon = null;
let _searchAddon = null;
let _activeSessionId = null;
let _hasPty = false;
let _fontSize = 13;
let _sessionRefreshTimer = null;
let _resizeObserver = null;
let _termContainer = null;
let _xtermLoading = null;
let _activeSessionId = null;
let _hasPty = false;
let _fontSize = 13;
let _sessionRefreshTimer = null;
let _resizeObserver = null;
let _termContainer = null;
let _xtermLoading = null;

/**
 * Lazy-load xterm.js and its addons (only when terminal tab is opened).
 * Saves ~500KB on initial page load.
 */
async function _ensureXterm() {
  if (typeof Terminal !== 'undefined') return;
  if (_xtermLoading) return _xtermLoading;

  _xtermLoading = (async () => {
    // Load CSS
    if (!document.querySelector('link[href*="xterm.css"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
      document.head.appendChild(css);
    }
    // Load xterm.js core
    await _loadScript('https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js');
    // Load addons
    await _loadScript('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js');
    await _loadScript('https://cdn.jsdelivr.net/npm/xterm-addon-search@0.13.0/lib/xterm-addon-search.js');
    _xtermLoading = null;
  })();
  return _xtermLoading;
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════════════

export async function renderTerminal(container) {
  clear(container);
  _termContainer = container;
  // Use class to avoid inline display overriding .tab-panel { display:none }
  container.classList.add('tab-panel--terminal');
  // Lazy-load xterm.js (saves ~500KB on initial load)
  await _ensureXterm();

  // ── Sidebar ──
  const sidebar = el('div', {
    id: 'term-sidebar',
    style: 'width:200px;min-width:160px;border-right:1px solid var(--color-border);' +
           'display:flex;flex-direction:column;background:var(--color-bg-card);flex-shrink:0;',
  });
  container.appendChild(sidebar);

  // Sidebar header
  sidebar.appendChild(el('div', {
    style: 'padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;' +
           'letter-spacing:0.5px;color:var(--color-text-muted);' +
           'border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;',
  },
    el('span', {}, '会话列表'),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      style: 'padding:0 4px;height:20px;font-size:14px;line-height:1;',
      onClick: refreshSessionList,
      title: '刷新',
    }, '🔄'),
  ));

  // Session list
  const sessionList = el('div', {
    id: 'term-session-list',
    style: 'flex:1;overflow-y:auto;',
  });
  sidebar.appendChild(sessionList);

  // New session button
  sidebar.appendChild(el('button', {
    class: 'btn btn-ghost btn-sm',
    style: 'margin:8px;justify-content:center;',
    onClick: () => connectSession(''),
  }, '➕ 新建会话'));

  // ── Main terminal area ──
  const mainArea = el('div', {
    style: 'flex:1;display:flex;flex-direction:column;overflow:hidden;',
  });

  // Toolbar
  const toolbar = el('div', {
    style: 'display:flex;align-items:center;gap:8px;padding:6px 8px;' +
           'border-bottom:1px solid var(--color-border);flex-shrink:0;',
  },
    el('span', {
      style: 'font-size:12px;color:var(--color-text-muted);font-family:var(--font-mono);',
      id: 'term-session-info',
    }, '未连接'),
    el('span', {
      style: 'font-size:10px;padding:1px 6px;border-radius:3px;display:none;',
      id: 'term-pty-badge',
    }, ''),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: () => zoomFont(-1), title: '缩小 (Ctrl+-)' }, 'A⁻'),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: () => zoomFont(+1), title: '放大 (Ctrl+Plus)' }, 'A⁺'),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: toggleSearchBar, title: '搜索 (Ctrl+Shift+F)', 'aria-expanded': 'false', 'aria-label': '搜索终端内容', html: icon('search') }),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: showAuditLog, title: '审计日志', html: icon('terminal') }),
    el('button', { class: 'btn btn-ghost btn-sm', id: 'btn-term-reconnect', onClick: () => connectSession(_activeSessionId), html: icon('refresh') }),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: () => connectSession(''), html: icon('plus') }),
  );

  // Search bar (hidden by default)
  const searchBar = el('div', {
    id: 'term-search-bar',
    style: 'display:none;align-items:center;gap:6px;padding:4px 8px;' +
           'border-bottom:1px solid var(--color-border);background:var(--color-bg-card);flex-shrink:0;',
  },
    el('input', {
      id: 'term-search-input',
      type: 'text',
      'aria-label': '搜索终端内容',
      placeholder: '搜索终端内容...',
      style: 'flex:1;height:26px;padding:0 8px;background:var(--color-bg-root);' +
             'border:1px solid var(--color-border);border-radius:4px;' +
             'font-size:12px;color:var(--color-text-body);outline:none;',
      onInput: (e) => doSearch(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter') {
          e.shiftKey ? findPrev(e.target.value) : findNext(e.target.value);
        } else if (e.key === 'Escape') {
          toggleSearchBar();
          _terminal?.focus();
        }
      },
    }),
    el('span', { id: 'term-search-count', style: 'font-size:11px;color:var(--color-text-muted);min-width:40px;' }, ''),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: () => findPrev($('#term-search-input')?.value || ''), title: '上一个 (Shift+Enter)' }, '▲'),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: () => findNext($('#term-search-input')?.value || ''), title: '下一个 (Enter)' }, '▼'),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: toggleSearchBar, title: '关闭 (Escape)' }, '✕'),
  );
  mainArea.appendChild(searchBar);
  mainArea.appendChild(toolbar);

  // Terminal container
  const termWrap = el('div', {
    id: 'terminal-container',
    style: 'flex:1;background:#0d1117;overflow:hidden;',
  });
  mainArea.appendChild(termWrap);
  container.appendChild(mainArea);

  // Init
  await initXterm();
  connectSession('');

  // Start refreshing session list (skips when page is hidden)
  refreshSessionList();
  _sessionRefreshTimer = setInterval(() => {
    if (!document.hidden) refreshSessionList();
  }, 10000);
}

// ═══════════════════════════════════════════════════════════
//  Session list
// ═══════════════════════════════════════════════════════════

async function refreshSessionList() {
  const listEl = $('#term-session-list');
  if (!listEl) return;

  try {
    const data = await get('/api/terminal/sessions');
    const sessions = data.sessions || [];
    clear(listEl);

    if (sessions.length === 0) {
      listEl.appendChild(el('div', {
        style: 'padding:16px 12px;font-size:12px;color:var(--color-text-dim);text-align:center;',
      }, '暂无会话'));
    }

    for (const s of sessions) {
      const isActive = s.session_id === _activeSessionId;
      const row = el('div', {
        class: 'term-session-row',
        style: `padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--color-border);` +
               `transition:background 0.15s;` +
               (isActive ? 'background:var(--color-primary-soft);border-left:3px solid var(--color-primary);' : 'border-left:3px solid transparent;'),
        onClick: () => {
          if (!isActive) connectSession(s.session_id);
        },
      },
        el('div', {
          style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;',
        },
          el('span', {
            style: `font-size:12px;font-weight:600;color:var(--color-text-body);` +
                   (isActive ? 'color:var(--color-primary);' : ''),
          }, s.name || s.session_id),
          el('button', {
            style: 'width:18px;height:18px;padding:0;border:none;background:none;cursor:pointer;' +
                   'color:var(--color-text-dim);font-size:12px;line-height:18px;text-align:center;' +
                   'border-radius:3px;',
            title: '终止会话',
            onClick: (e) => {
              e.stopPropagation();
              killSession(s.session_id);
            },
          }, '✕'),
        ),
        el('div', {
          style: 'font-size:10px;color:var(--color-text-dim);display:flex;gap:8px;',
        },
          el('span', {}, s.shell?.split('\\').pop() || s.shell || '?'),
          el('span', {}, s.has_pty ? 'PTY' : 'pipe'),
          el('span', {}, idleLabel(s.idle_seconds)),
        ),
      );

      // Hover
      row.addEventListener('mouseenter', () => {
        if (!isActive) row.style.background = 'var(--color-bg-elevated)';
      });
      row.addEventListener('mouseleave', () => {
        if (!isActive) row.style.background = '';
      });

      listEl.appendChild(row);
    }
  } catch (e) {
    // Silently ignore — session list is non-critical
  }
}

// Coarse duration for sidebar compactness — see format.js:duration() for full formatting
function idleLabel(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

async function killSession(sessionId) {
  if (!await confirm(`确定终止会话 ${sessionId}？`)) return;
  try {
    await del(`/api/terminal/sessions/${sessionId}`);
    notify.info(`已终止: ${sessionId}`);
    if (_activeSessionId === sessionId) {
      _activeSessionId = null;
      updateSessionInfo('未连接');
    }
    refreshSessionList();
  } catch (e) {
    notify.error(`终止失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  xterm.js init
// ═══════════════════════════════════════════════════════════

async function initXterm() {
  const container = $('#terminal-container');
  if (!container) return;

  if (typeof Terminal === 'undefined') {
    container.innerHTML = '<div style="color:#ff6b6b;padding:20px;text-align:center;">xterm.js 未加载 — 检查 CDN</div>';
    return;
  }

  if (_terminal) {
    _terminal.dispose();
  }

  _terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: _fontSize,
    fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
    scrollback: 5000,
    allowProposedApi: true,
    allowTransparency: false,
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: '#264f78',
      selectionForeground: '#c9d1d9',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39d353',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d364',
      brightWhite: '#f0f6fc',
    },
  });

  // Fit addon
  if (typeof FitAddon !== 'undefined') {
    const FitClass = FitAddon.FitAddon || FitAddon;
    _fitAddon = new FitClass();
    _terminal.loadAddon(_fitAddon);
  }

  // Search addon
  if (typeof SearchAddon !== 'undefined') {
    const SearchClass = SearchAddon.SearchAddon || SearchAddon;
    _searchAddon = new SearchClass();
    _terminal.loadAddon(_searchAddon);
  }

  _terminal.open(container);

  // Welcome
  _terminal.writeln('\x1b[1;36m  LingServer Terminal v2\x1b[0m');
  _terminal.writeln('  多会话模式 — 左侧列表切换');
  _terminal.writeln('  Ctrl+C 中断 | Ctrl+D 退出 | Ctrl+L 清屏\r\n');

  // Resize forwarding
  _terminal.onResize(({ cols, rows }) => {
    if (_activeWs && _activeWs.readyState === WebSocket.OPEN) {
comm.terminal.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  // ResizeObserver for container
  if (_fitAddon) {
    try { _fitAddon.fit(); } catch (e) { /* ignore */ }
    _resizeObserver = new ResizeObserver(() => {
      try { _fitAddon.fit(); } catch (e) { /* ignore */ }
    });
    _resizeObserver.observe(container);
  }

  // Input → WebSocket
  _terminal.onData((data) => {
    if (_activeWs && _activeWs.readyState === WebSocket.OPEN) {
      if (!_hasPty) _terminal.write(data);  // local echo for pipe mode
      comm.terminal.send(data);
    }
  });

  // Keyboard shortcuts
  _terminal.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && e.key === '=') { zoomFont(+1); return true; }
    if (e.ctrlKey && e.key === '-') { zoomFont(-1); return true; }
    if (e.ctrlKey && e.key === '0') { resetFont(); return true; }
    // Ctrl+Shift+F → toggle search
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      toggleSearchBar();
      return true;
    }
    return true;
  });

  // Right-click menu
  _terminal.element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  setTimeout(() => _terminal.focus(), 300);
}

// ═══════════════════════════════════════════════════════════
//  WebSocket connect / attach
// ═══════════════════════════════════════════════════════════

function connectSession(sessionId) {
  // Close current
  comm.terminal.disconnect();

  _activeSessionId = sessionId || null;
  updateSessionInfo(sessionId ? `连接中 (${sessionId})...` : '连接中...');
  updatePtyBadge(false, '');

  // Wire up callbacks before connecting
  comm.terminal.onData((data) => {
    _terminal?.write(data);
  });
  comm.terminal.onControl((msg) => {
    handleControlMessage(msg);
  });
  comm.terminal.onClose((code) => {
    if (code === 4001) {
      updateSessionInfo('认证失败');
      notify.error('终端连接认证失败 — 请重新登录');
    } else {
      updateSessionInfo('已断开');
    }
    updatePtyBadge(false, '');
    _hasPty = false;
    _activeSessionId = null;
    refreshSessionList();
  });
  comm.terminal.onError(() => {
    updateSessionInfo('连接错误');
  });

  // Connect — onopen clears terminal & focuses
  comm.terminal.connect(sessionId);
  // Short delay for WS handshake, then clear & focus
  setTimeout(() => {
    _terminal?.clear();
    _terminal?.focus();
  }, 150);
}

// ═══════════════════════════════════════════════════════════
//  Control messages
// ═══════════════════════════════════════════════════════════

function handleControlMessage(msg) {
  switch (msg.type) {
    case 'ready':
      _activeSessionId = msg.session_id;
      _hasPty = !!msg.pty;
      const reattach = msg.reattached ? ' [重连]' : '';
      updateSessionInfo(`${msg.name || msg.session_id} · ${msg.shell?.split('\\').pop() || msg.shell} · ${msg.encoding}${reattach}`);
      updatePtyBadge(msg.pty, msg.pty ? 'PTY' : 'pipe');
      refreshSessionList();
      _terminal?.focus();
      break;

    case 'timeout':
      notify.warn(msg.message);
      updateSessionInfo('已超时断开');
      refreshSessionList();
      break;

    case 'killed':
      notify.warn(msg.message);
      updateSessionInfo('会话已终止');
      break;

    case 'danger_warning':
      notify.warn(`⚠️ 危险命令: ${msg.command}`);
      if (msg.matches?.length) {
        for (const m of msg.matches) {
          notify.warn(`  ${m.severity}: ${m.description}`);
        }
      }
      break;

    case 'error':
      notify.error(msg.message);
      break;
  }
}

// ═══════════════════════════════════════════════════════════
//  Font zoom
// ═══════════════════════════════════════════════════════════

function zoomFont(delta) {
  _fontSize = Math.max(8, Math.min(24, _fontSize + delta));
  if (_terminal) {
    _terminal.options.fontSize = _fontSize;
    try { _fitAddon?.fit(); } catch (e) { /* ignore */ }
  }
}

function resetFont() {
  _fontSize = 13;
  if (_terminal) {
    _terminal.options.fontSize = _fontSize;
    try { _fitAddon?.fit(); } catch (e) { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════
//  Context menu
// ═══════════════════════════════════════════════════════════

function showContextMenu(x, y) {
  const existing = $('.terminal-context-menu');
  if (existing) existing.remove();

  const menu = el('div', {
    class: 'terminal-context-menu',
    style: `position:fixed;left:${x}px;top:${y}px;z-index:3000;
      background:var(--color-bg-elevated);border:1px solid var(--color-border);
      border-radius:6px;box-shadow:var(--shadow-lg);min-width:160px;
      padding:4px 0;font-size:12px;`,
  },
    menuItem(icon('copy') + ' 复制', copySelection),
    menuItem(icon('paste') + ' 粘贴', pasteClipboard),
    el('div', { style: 'height:1px;background:var(--color-border);margin:4px 0;' }),
    menuItem(icon('clear-format') + ' 清屏', clearScreen),
    menuItem(icon('refresh') + ' 重连', () => connectSession(_activeSessionId)),
    menuItem(icon('plus') + ' 新会话', () => connectSession('')),
  );

  document.body.appendChild(menu);
  const close = (e2) => {
    if (!menu.contains(e2.target)) {
      menu.remove();
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
  }, 0);
}

function menuItem(html, onClick) {
  return el('div', {
    style: 'padding:6px 12px;cursor:pointer;color:var(--t-body);display:flex;align-items:center;gap:6px;',
    html,
    onMouseEnter(e) { e.target.style.background = 'oklch(0.55 0.18 255 / 0.10)'; },
    onMouseLeave(e) { e.target.style.background = ''; },
    onClick() {
      document.querySelector('.terminal-context-menu')?.remove();
      onClick();
    },
  });
}

function copySelection() {
  const sel = _terminal?.getSelection();
  if (sel) {
    navigator.clipboard.writeText(sel).then(() => notify.info('已复制'))
      .catch(() => notify.warn('复制失败'));
  }
}

function pasteClipboard() {
  navigator.clipboard.readText()
    .then(text => {
      if (_activeWs && _activeWs.readyState === WebSocket.OPEN && text) {
        comm.terminal.send(text);
      }
    })
    .catch(() => notify.warn('粘贴失败（需授权剪贴板）'));
}

function clearScreen() {
  _terminal?.clear();
  if (_activeWs && _activeWs.readyState === WebSocket.OPEN) {
    comm.terminal.send('\x0c');
  }
}

// ═══════════════════════════════════════════════════════════
//  UI helpers
// ═══════════════════════════════════════════════════════════

function updateSessionInfo(text) {
  const el2 = $('#term-session-info');
  if (el2) el2.textContent = text;
}

function updatePtyBadge(hasPty, label) {
  const badge = $('#term-pty-badge');
  if (!badge) return;
  badge.style.display = 'inline';
  if (hasPty) {
    badge.style.background = 'var(--color-success-muted)';
    badge.style.color = 'var(--color-success)';
  } else {
    badge.style.background = 'var(--color-warning-muted)';
    badge.style.color = 'var(--color-warning)';
  }
  badge.textContent = label;
}

// ═══════════════════════════════════════════════════════════
//  Terminal search
// ═══════════════════════════════════════════════════════════

function toggleSearchBar() {
  const bar = $('#term-search-bar');
  const input = $('#term-search-input');
  const btn = document.querySelector('.btn[title="搜索 (Ctrl+Shift+F)"]');
  if (!bar || !input) return;

  if (bar.style.display === 'none') {
    bar.style.display = 'flex';
    input.value = '';
    input.focus();
    updateSearchCount(0, 0);
    if (btn) btn.setAttribute('aria-expanded', 'true');
    _searchAddon?.findNext('');
  } else {
    bar.style.display = 'none';
    if (btn) btn.setAttribute('aria-expanded', 'false');
    _searchAddon?.findNext('');
    _terminal?.focus();
  }
}

function doSearch(query) {
  if (!_searchAddon) return;
  if (!query || query.length < 1) {
    _searchAddon.findNext('');
    updateSearchCount(0, 0);
    return;
  }
  // findNext highlights all matches and moves to first
  _searchAddon.findNext(query, { incremental: true });
  // We can't easily get total count; show indicator
  updateSearchCount(-1, -1);
}

function findNext(query) {
  if (!_searchAddon || !query) return;
  _searchAddon.findNext(query);
}

function findPrev(query) {
  if (!_searchAddon || !query) return;
  _searchAddon.findPrevious(query);
}

function updateSearchCount(current, total) {
  const el = $('#term-search-count');
  if (!el) return;
  if (current < 0) {
    el.textContent = '搜索中...';
  } else if (total === 0) {
    el.textContent = '';
  } else {
    el.textContent = total > 0 ? `${current}/${total}` : '';
  }
}

// ═══════════════════════════════════════════════════════════
//  Audit log viewer
// ═══════════════════════════════════════════════════════════

async function showAuditLog() {
  const { Modal } = await import('../ui.js');

  try {
    const data = await get('/api/terminal/audit?limit=50');
    const items = data.items || [];

    const rows = items.map(item => {
      const isDanger = item.is_dangerous;
      return [
        item.timestamp?.replace('T', ' ').substring(0, 19) || '',
        item.session_id || '',
        isDanger ? '⚠️' : '',
        { value: item.input_text || '', style: isDanger ? 'color:var(--color-error);font-weight:600;' : '' },
      ];
    });

    const { DataTable } = await import('../ui.js');
    const table = DataTable({
      columns: ['timestamp', 'session_id', 'danger', 'input_text'],
      labels: { timestamp: '时间', session_id: '会话', danger: '', input_text: '命令' },
      rows,
      format: (col, val) => val || '',
    });

    Modal({
      title: icon('terminal') + ' 终端审计日志',
      body: el('div', { style: 'max-height:60vh;overflow:auto;' },
        items.length === 0
          ? el('div', { style: 'padding:20px;text-align:center;color:var(--color-text-muted);' }, '暂无审计记录')
          : table,
      ),
      footer: `共 ${data.total || items.length} 条 · 最近 ${items.length} 条`,
    });
  } catch (e) {
    notify.error(`加载审计日志失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Cleanup on tab switch
// ═══════════════════════════════════════════════════════════
export function cleanup() {
  if (_sessionRefreshTimer) {
    clearInterval(_sessionRefreshTimer);
    _sessionRefreshTimer = null;
  }
  if (_activeWs) {
comm.terminal.disconnect();
  }
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  // Note: tab-panel--terminal class stays — it's structural, not state.
  // Removing it would break re-display since _tabLoaded prevents re-render.
  _termContainer = null;
}
