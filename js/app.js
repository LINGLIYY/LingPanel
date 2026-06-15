/**
 * LingServer Dashboard — Application Entry
 *
 * Bootstrap: check auth → Login or Dashboard.
 * All heavy lifting delegated to screen modules.
 */
import { checkAuth } from './auth.js';
import { on } from './state.js';
import { renderLogin } from './screens/login.js';
import { renderDashboard } from './screens/dashboard.js';
import { disconnect } from './ws.js';
import { setStatus } from './utils/notify.js';

// ═══════════════════════════════════════════════════════════
//  Skeleton loading screen
// ═══════════════════════════════════════════════════════════

function showSkeleton() {
  const app = document.querySelector('.app');
  if (!app) return;
  app.innerHTML = '';
  app.className = 'app app--loading';

  const skeletonHtml = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
      <div style="text-align:center;">
        <div style="width:48px;height:48px;border:3px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>
        <div class="skeleton" style="width:200px;height:14px;margin:0 auto 12px;"></div>
        <div class="skeleton" style="width:140px;height:10px;margin:0 auto;"></div>
      </div>
    </div>
  `;
  app.innerHTML = skeletonHtml;

  // Add spin keyframe
  if (!document.getElementById('skeleton-style')) {
    const style = document.createElement('style');
    style.id = 'skeleton-style';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
}

// ═══════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════

async function bootstrap() {
  // Show skeleton immediately
  showSkeleton();

  // Check auth on load — backend auto-auths when dev key is active
  const authed = await checkAuth();

  if (authed) {
    renderDashboard();
    setStatus(`就绪 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } else {
    renderLogin();
  }

  // ── Navigation ──
  on('navigate', (target) => {
    if (target === 'dashboard') {
      disconnect(); // clean up any stale WS
      renderDashboard();
      setStatus(`就绪 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    } else if (target === 'login') {
      disconnect();
      renderLogin();
    }
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);
