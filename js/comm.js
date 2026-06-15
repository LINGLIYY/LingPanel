/**
 * LingServer Dashboard — Unified Communication Layer
 *
 * Single entry point replacing direct imports from api.js / ws.js / state.js.
 *
 *   comm.rest.get / post / put / del    → REST (thin delegation to api.js)
 *   comm.live.connect / disconnect      → /ws/live WebSocket (delegates to ws.js)
 *   comm.live.status                    → read-only WS connection status
 *   comm.terminal.connect / disconnect  → /ws/terminal WebSocket (net-new wrapper)
 *   comm.terminal.send / onData / onControl / onClose / onError
 *   comm.on / comm.off                  → event bus (delegates to state.js)
 *   comm.state                          → read-only proxy of appState
 *
 * api.js, ws.js, state.js are preserved as internal modules.
 * Tabs migrate gradually by changing their import to comm.js.
 */
import { get, post, put, del } from './api.js';
import { connect as wsConnect, disconnect as wsDisconnect, socket } from './ws.js';
import { on, off, emit, appState } from './state.js';

// ═══════════════════════════════════════════════════════════
//  REST — thin delegation
// ═══════════════════════════════════════════════════════════

const rest = { get, post, put, del };

// ═══════════════════════════════════════════════════════════
//  Live WS (/ws/live) — delegates to ws.js singleton
// ═══════════════════════════════════════════════════════════

const live = {
  connect(channels) { wsConnect(channels); },
  disconnect() { wsDisconnect(); },
  get status() { return appState.wsStatus; },
  get socket() { return socket(); },
};

// ═══════════════════════════════════════════════════════════
//  Terminal WS (/ws/terminal) — per-tab connection manager
// ═══════════════════════════════════════════════════════════

let _termWs = null;
let _termCallbacks = {
  onData: null,      // raw PTY output (string)
  onControl: null,   // JSON control messages ({msg, ...})
  onClose: null,     // connection closed (code, reason)
  onError: null,     // connection error
};

function _termUrl(sessionId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${location.host}/ws/terminal`;
  return sessionId ? `${base}?session_id=${encodeURIComponent(sessionId)}` : base;
}

function _termClose() {
  if (_termWs) {
    try { _termWs.close(); } catch (_) { /* ignore */ }
    _termWs = null;
  }
}

const terminal = {
  connect(sessionId) {
    _termClose();
    const url = _termUrl(sessionId);
    _termWs = new WebSocket(url);

    _termWs.onopen = () => {
      // Connection established — caller should attach terminal
    };

    _termWs.onmessage = (e) => {
      // Distinguish JSON control messages from raw PTY output
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg && typeof msg === 'object' && 'msg' in msg) {
            if (_termCallbacks.onControl) _termCallbacks.onControl(msg);
            return;
          }
        } catch (_) { /* not JSON — raw PTY output */ }
      }
      if (_termCallbacks.onData) _termCallbacks.onData(e.data);
    };

    _termWs.onclose = (e) => {
      _termWs = null;
      if (_termCallbacks.onClose) _termCallbacks.onClose(e.code, e.reason);
    };

    _termWs.onerror = () => {
      if (_termCallbacks.onError) _termCallbacks.onError();
    };
  },

  disconnect() {
    _termClose();
  },

  send(data) {
    if (_termWs && _termWs.readyState === WebSocket.OPEN) {
      _termWs.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  },

  onData(fn)   { _termCallbacks.onData = fn; },
  onControl(fn){ _termCallbacks.onControl = fn; },
  onClose(fn)  { _termCallbacks.onClose = fn; },
  onError(fn)  { _termCallbacks.onError = fn; },

  get isOpen() { return _termWs !== null && _termWs.readyState === WebSocket.OPEN; },
};

// ═══════════════════════════════════════════════════════════
//  State — read-only proxy of appState
// ═══════════════════════════════════════════════════════════

const _stateProxy = new Proxy(appState, {
  set() {
    console.warn('comm.state is read-only — use comm.live / comm.on for state changes');
    return true; // silent no-op
  },
  deleteProperty() {
    console.warn('comm.state is read-only');
    return true;
  },
});

// ═══════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════

export const comm = {
  rest,
  live,
  terminal,
  on,
  off,
  state: _stateProxy,
};
