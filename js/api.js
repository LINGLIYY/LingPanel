/**
 * LingServer Dashboard — API Client
 *
 * @deprecated Use `comm.rest` from `js/comm.js` instead.
 *   import { comm } from '../comm.js';
 *   const { get, post, put, del } = comm.rest;
 *
 * Fetch wrapper with:
 *  - Auto CSRF from cookie
 *  - 401 → refresh token → retry once
 *  - JSON parsing and error normalization
 */

const API_BASE = window.location.origin;

/**
 * Core fetch wrapper.
 */
async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  const defaults = {
    headers: {
      'Accept': 'application/json',
    },
    credentials: 'same-origin',
  };

  // Merge headers
  const config = {
    ...defaults,
    ...options,
    headers: {
      ...defaults.headers,
      ...(options.headers || {}),
    },
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
    config.headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, config);
  } catch (e) {
    throw new ApiError(0, '服务器无响应，请检查服务是否运行', {});
  }

  // Auto-refresh on 401 (try once)
  if (res.status === 401 && !options._retried) {
    const refreshed = await refreshToken();
    if (refreshed) {
      return request(path, { ...options, _retried: true });
    }
  }

  return res;
}

/**
 * Attempt to refresh the access token.
 */
async function refreshToken() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function _handleResponse(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail || res.statusText, body);
  }
  return res.json();
}

export async function get(path) {
  return _handleResponse(await request(path));
}

export async function post(path, data) {
  return _handleResponse(await request(path, { method: 'POST', body: data }));
}

export async function del(path) {
  return _handleResponse(await request(path, { method: 'DELETE' }));
}

export async function put(path, data) {
  return _handleResponse(await request(path, { method: 'PUT', body: data }));
}

/**
 * Structured API error.
 */
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// ── Convenience: auth endpoints ──

export const authApi = {
  login: (username, password) =>
    post('/api/auth/login', { username, password }),
  logout: () =>
    post('/api/auth/logout'),
  refresh: () =>
    post('/api/auth/refresh'),
  me: () =>
    get('/api/auth/me'),
  changePassword: (oldPassword, newPassword) =>
    post('/api/auth/change-password', { old_password: oldPassword, new_password: newPassword }),
};

