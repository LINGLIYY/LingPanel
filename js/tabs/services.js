/**
 * LingServer Dashboard — Services Tab
 *
 * Service status cards with start/stop/restart actions.
 * API: GET /api/services, POST /api/services/{name}/{action}
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, post } from '../api.js';
import { notify } from '../utils/notify.js';
import { icon, iconLabel } from '../utils/icons.js';

let _refreshTimer = null;

const SERVICE_ICONS = {
  nginx: 'globe',
  docker: 'docker',
  mysql: 'database',
  'redis-server': 'activity',
  ssh: 'shield',
  cron: 'clock',
};

const STATUS_LABELS = {
  active: '运行中',
  inactive: '已停止',
  failed: '异常',
  unknown: '未知',
};

/**
 * Render the services tab.
 */
export async function renderServices(container) {
  clear(container);

  // Header
  container.appendChild(el('div', {
    style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;',
  },
    el('span', { style: 'font-size:14px;font-weight:600;color:var(--color-text-heading);' }, '服务管理'),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: loadServices, html: iconLabel('refresh', '刷新')}),
  ));

  // Service grid
  const grid = el('div', {
    id: 'services-grid',
    style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;',
  });
  container.appendChild(grid);

  // Info banner for Windows
  container.appendChild(el('div', {
    style: 'margin-top:16px;padding:8px 12px;background:var(--color-bg-card);border:1px solid var(--color-border);' +
           'border-radius:6px;font-size:11px;color:var(--color-text-dim);',
  }, `${icon('settings')} 提示：服务管理基于 systemctl，Windows 系统下显示为"未知"。部署到 Ubuntu 服务器后即可使用。`));

  loadServices();
  _refreshTimer = setInterval(loadServices, 10000);
}

async function loadServices() {
  try {
    const data = await get('/api/services');
    renderServiceCards(data.services || []);
  } catch (e) {
    notify.error(`加载服务失败: ${e.message}`);
  }
}

function renderServiceCards(services) {
  const grid = $('#services-grid');
  if (!grid) return;
  clear(grid);

  for (const svc of services) {
    grid.appendChild(buildServiceCard(svc));
  }
}

function buildServiceCard(svc) {
  const status = svc.status || 'unknown';
  const iconName = SERVICE_ICONS[svc.name] || 'server';
  const label = STATUS_LABELS[status] || status;

  // Status color
  let statusColor = 'var(--color-text-dim)';
  let dotIcon = 'circle-yellow';
  if (status === 'active') { statusColor = 'var(--color-success)'; dotIcon = 'circle-green'; }
  else if (status === 'failed') { statusColor = 'var(--color-error)'; dotIcon = 'circle-red'; }
  else if (status === 'unknown') { statusColor = 'var(--color-warning)'; dotIcon = 'circle-yellow'; }

  const isSystemctl = status !== 'unknown';

  return el('div', {
    class: 'panel',
    style: 'padding:16px;',
  },
    // Header row
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;' },
      el('div', { style: 'display:flex;align-items:center;gap:8px;' },
        el('span', { class: 'service-card__icon', html: icon(iconName) }),
        el('div', {},
          el('div', { style: 'font-size:14px;font-weight:600;color:var(--color-text-heading);' }, svc.name),
          el('div', { style: 'font-size:11px;color:var(--color-text-muted);font-family:var(--font-mono);' }, svc.name),
        ),
      ),
      el('span', {
        style: `font-size:12px;font-weight:500;color:${statusColor};display:flex;align-items:center;gap:4px;`,
        html: icon(dotIcon) + ' ' + label,
      }),
    ),

    // Action buttons
    el('div', { style: 'display:flex;gap:6px;' },
      el('button', {
        class: 'btn btn-sm',
        style: 'flex:1;background:var(--color-success-muted);color:var(--color-success);border:none;',
        disabled: !isSystemctl || status === 'active',
        onClick: () => serviceAction(svc.name, 'start'),
        html: icon('chevron-right') + ' 启动',
      }),
      el('button', {
        class: 'btn btn-sm',
        style: 'flex:1;background:var(--color-error-muted);color:var(--color-error);border:none;',
        disabled: !isSystemctl || status !== 'active',
        onClick: () => serviceAction(svc.name, 'stop'),
        html: icon('x') + ' 停止',
      }),
      el('button', {
        class: 'btn btn-sm',
        style: 'flex:1;background:var(--color-warning-muted);color:var(--color-warning);border:none;',
        disabled: !isSystemctl,
        onClick: () => serviceAction(svc.name, 'restart'),
        html: iconLabel('refresh', '重启'),
      }),
    ),
  );
}

async function serviceAction(name, action) {
  const labels = { start: '启动', stop: '停止', restart: '重启' };
  if (!confirm(`确定${labels[action]}服务 ${name}？`)) return;

  try {
    await post(`/api/services/${name}/${action}`);
    notify.success(`${name}: ${labels[action]}成功`);
    loadServices();
  } catch (e) {
    notify.error(`${name} ${labels[action]}失败: ${e.message}`);
  }
}

// Cleanup on tab switch
export function cleanup() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}
