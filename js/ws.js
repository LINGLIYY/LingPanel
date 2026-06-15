/**
 * LingServer Dashboard — WebSocket Client
 *
 * Features:
 *  - Exponential backoff reconnection (1s → 2s → 4s → max 30s)
 *  - Auto-resubscribe on reconnect
 *  - Heartbeat pong
 *  - Status events via global state
 */

import { setWsStatus, setMetrics, emit } from './state.js';
import { notify } from './utils/notify.js';

const WS_URL = (() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/live`;
})();

let _ws = null;
let _reconnectTimer = null;
let _reconnectDelay = 1000;
let _shouldReconnect = true;
let _channels = ['system'];
let _pingTimer = null;

const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 25000;

/**
 * Connect to the WebSocket endpoint.
 */
export function connect(channels = ['system']) {
  _channels = channels;
  _shouldReconnect = true;
  _reconnectDelay = 1000;
  _doConnect();
}

function _doConnect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setWsStatus('reconnecting');

  try {
    _ws = new WebSocket(WS_URL);
  } catch (e) {
    _scheduleReconnect();
    return;
  }

  _ws.onopen = () => {
    setWsStatus('connected');
    _reconnectDelay = 1000;
    emit('ws:open', {});

    // Subscribe
    _ws.send(JSON.stringify({ type: 'subscribe', channels: _channels }));

    // Start heartbeat
    _startHeartbeat();
  };

  _ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);

      if (msg.type === 'ping') {
        // Respond with pong
        _ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        return;
      }

      if (msg.type === 'metric') {
        setMetrics(msg);
      }

      if (msg.type === 'alert') {
        notify.warn(`[${msg.level}] ${msg.message}`);
        emit('alert', msg);
      }
    } catch (err) {
      // Non-JSON message, ignore
    }
  };

  _ws.onclose = (e) => {
    setWsStatus('disconnected');
    _stopHeartbeat();
    _ws = null;

    if (_shouldReconnect) {
      _scheduleReconnect();
    }
  };

  _ws.onerror = () => {
    // onclose will fire after this
  };
}

function _scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _doConnect();
  }, _reconnectDelay);

  _reconnectDelay = Math.min(_reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function _startHeartbeat() {
  _stopHeartbeat();
  _pingTimer = setInterval(() => {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }
  }, PING_INTERVAL);
}

function _stopHeartbeat() {
  if (_pingTimer) {
    clearInterval(_pingTimer);
    _pingTimer = null;
  }
}

/**
 * Disconnect and stop reconnection attempts.
 */
export function disconnect() {
  _shouldReconnect = false;
  _stopHeartbeat();
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  setWsStatus('disconnected');
}

/**
 * Get the current WebSocket instance (null if disconnected).
 */
export function socket() {
  return _ws && _ws.readyState === WebSocket.OPEN ? _ws : null;
}
