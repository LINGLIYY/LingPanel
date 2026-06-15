/**
 * LingServer Dashboard — Global Event Bus
 *
 * Simple pub/sub for decoupled module communication.
 * No diffing, no framework — just emit and listen.
 */

const _listeners = {};

/**
 * Subscribe to an event.
 * @param {string} event
 * @param {Function} fn
 * @returns {Function} unsubscribe function
 */
export function on(event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
  return () => off(event, fn);
}

/**
 * Unsubscribe from an event.
 */
export function off(event, fn) {
  const arr = _listeners[event];
  if (arr) {
    const i = arr.indexOf(fn);
    if (i > -1) arr.splice(i, 1);
  }
}

/**
 * Emit an event with data.
 */
export function emit(event, data) {
  const arr = _listeners[event];
  if (arr) {
    for (const fn of arr) {
      try { fn(data); } catch (e) { console.error('[state]', event, e); }
    }
  }
}

// ── Application-level state ──

export const appState = {
  /** @type {'loading'|'unauthenticated'|'authenticated'} */
  auth: 'loading',

  /** @type {string|null} */
  username: null,

  /** @type {string} */
  currentTab: 'overview',

  /** @type {'connected'|'reconnecting'|'disconnected'} */
  wsStatus: 'disconnected',

  /** Latest system metrics snapshot */
  metrics: null,

  /** @type {'dark'|'light'} */
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
};

/**
 * Convenience: emit state change events.
 */
export function setAuth(status, username = null) {
  appState.auth = status;
  appState.username = username;
  emit('auth:change', { status, username });
}

export function setWsStatus(status) {
  appState.wsStatus = status;
  emit('ws:change', { status });
}

export function setMetrics(data) {
  appState.metrics = data;
  emit('metrics:update', data);
}

export function setTab(name) {
  appState.currentTab = name;
  emit('tab:change', { tab: name });
}
