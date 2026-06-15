/**
 * LingServer Dashboard — Auth Module
 *
 * Check login state, handle login/logout flow.
 */
import { authApi } from './api.js';
import { setAuth, emit } from './state.js';
import { notify } from './utils/notify.js';

/**
 * Check if user is authenticated by calling /api/auth/me.
 * Updates global auth state.
 * @returns {Promise<boolean>}
 */
export async function checkAuth() {
  try {
    const res = await authApi.me();
    if (res.success && res.data) {
      setAuth('authenticated', res.data.username);
      return true;
    }
  } catch (e) {
    // 401 or network error
  }
  setAuth('unauthenticated');
  return false;
}

/**
 * Login with username and password.
 * @returns {Promise<{success: boolean, error?: string, lockedSeconds?: number}>}
 */
export async function login(username, password) {
  try {
    const res = await authApi.login(username, password);
    if (res.success) {
      const user = res.data.user;
      setAuth('authenticated', user.username);
      notify.success(`欢迎，${user.username}`);

      // Check if password change is required
      if (user.must_change_password) {
        emit('login:success', res.data);
        return { success: true, mustChangePassword: true };
      }

      emit('login:success', res.data);
      return { success: true };
    }
    return { success: false, error: '未知错误' };
  } catch (e) {
    if (e.status === 423) {
      const remaining = e.body?.detail || '请稍后再试';
      return { success: false, error: remaining, locked: true };
    }
    return { success: false, error: e.message || '登录失败' };
  }
}

/**
 * Change the current user's password.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function changePassword(oldPassword, newPassword) {
  try {
    const res = await authApi.changePassword(oldPassword, newPassword);
    return { success: res.success };
  } catch (e) {
    return { success: false, error: e.message || '修改失败' };
  }
}

/**
 * Logout — clear server session and local state.
 */
export async function logout() {
  try {
    await authApi.logout();
  } catch (e) {
    // Logout best-effort
  }
  setAuth('unauthenticated');
  emit('logout');
}
