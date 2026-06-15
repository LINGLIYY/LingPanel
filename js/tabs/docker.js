/**
 * LingServer Dashboard — Docker Tab
 *
 * Container list with start/stop, logs viewer, images list.
 * Degrades gracefully when Docker is unavailable.
 */
import { el, clear, $ } from '../utils/dom.js';
import { Panel, DataTable, Modal, EmptyState } from '../ui.js';
import { get, post } from '../api.js';
import { notify } from '../utils/notify.js';
import { bytes, dateShort } from '../utils/format.js';
import { icon } from '../utils/icons.js';

/**
 * Render the Docker tab.
 */
export async function renderDocker(container) {
  clear(container);

  // Check availability first
  let dockerAvailable = false;
  try {
    const info = await get('/api/docker');
    dockerAvailable = info.available;
  } catch (e) {
    // 503 or network error
  }

  if (!dockerAvailable) {
    container.appendChild(EmptyState({
      icon: 'docker',
      message: 'Docker 不可用 — Socket 无法连接。请确认 Docker 已安装并运行。',
    }));
    return;
  }

  // ── Info bar ──
  const infoBar = el('div', { id: 'docker-info-bar', style: 'margin-bottom:8px;' });
  container.appendChild(infoBar);

  // ── Container panel ──
  const cPanel = Panel({ title: '容器', className: 'panel--docker' });
  container.appendChild(cPanel);

  // ── Image panel ──
  const iPanel = Panel({ title: '镜像', className: 'panel--docker' });
  container.appendChild(iPanel);

  await loadAll();
}

// ═══════════════════════════════════════════════════════════
//  Load data
// ═══════════════════════════════════════════════════════════

async function loadAll() {
  try {
    const [info, cData, iData] = await Promise.all([
      get('/api/docker'),
      get('/api/docker/containers?all=true'),
      get('/api/docker/images'),
    ]);
    renderInfoBar(info);
    renderContainers(cData.containers || []);
    renderImages(iData.images || []);
  } catch (e) {
    notify.error(`Docker 数据加载失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Info bar
// ═══════════════════════════════════════════════════════════

function renderInfoBar(info) {
  const bar = $('#docker-info-bar');
  if (!bar) return;
  bar.innerHTML = `<span style="font-size:12px;color:var(--color-text-muted);">
    ${icon('server')} ${info.server_version || '?'} · ${info.os || '?'} ·
    容器 ${info.containers_running || 0}/${info.containers || 0} 运行 ·
    镜像 ${info.images || 0}
  </span>`;
}

// ═══════════════════════════════════════════════════════════
//  Containers
// ═══════════════════════════════════════════════════════════

function renderContainers(containers) {
  const panel = document.querySelector('.panel--docker');
  if (!panel) return;
  const body = panel.querySelector('.panel__body');
  if (!body) return;
  clear(body);

  if (!containers.length) {
    body.appendChild(EmptyState({ icon: 'empty-box', message: '没有容器' }));
    return;
  }

  const table = DataTable({
    columns: ['name', 'image', 'status', 'cpu_percent', 'memory', 'ports', 'actions'],
    labels: { name: '名称', image: '镜像', status: '状态', cpu_percent: 'CPU', memory: '内存', ports: '端口', actions: '' },
    rows: containers.map(c => ({
      ...c,
      memory: c.memory_limit > 0 ? `${(c.memory_usage / 1024 / 1024).toFixed(1)} / ${(c.memory_limit / 1024 / 1024).toFixed(0)} MB` : '--',
      ports: (c.ports || []).join(', ') || '--',
    })),
    format: (col, val, row) => {
      if (col === 'status') {
        const running = row.state === 'running';
        return el('span', {
          style: `color:${running ? 'var(--green)' : 'var(--color-text-dim)'};`,
        }, val).outerHTML;
      }
      if (col === 'cpu_percent') return `${val}%`;
      if (col === 'actions') {
        const running = row.state === 'running';
        const nameAttr = String(row.name || '').replace(/"/g, '&quot;');
        return `<button data-action="${running ? 'stop' : 'start'}" data-id="${row.id}" data-name="${nameAttr}" class="btn btn-sm ${running ? 'btn-danger' : 'btn-primary'}" style="height:24px;font-size:11px;">${running ? '停止' : '启动'}</button>`;
      }
      return val || '--';
    },
  });

  // Action handlers
  table.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const name = btn.dataset.name || id;

      try {
        if (action === 'start') {
          await post(`/api/docker/containers/${id}/start`);
          notify.success(`${name} 已启动`);
        } else {
          await post(`/api/docker/containers/${id}/stop`);
          notify.success(`${name} 已停止`);
        }
        loadAll();
      } catch (e) {
        notify.error(`${action === 'start' ? '启动' : '停止'}失败: ${e.message}`);
      }
    });
  });

  // Row click → logs
  table.querySelectorAll('tbody tr').forEach((tr, i) => {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', async () => {
      const c = containers[i];
      try {
        const data = await get(`/api/docker/containers/${c.id}/logs?tail=200`);
        Modal({
          title: `${icon('terminal')} ${c.name} — 日志`,
          body: el('pre', {
            style: 'background:var(--abyss-950);color:var(--abyss-100);padding:12px;border-radius:4px;font-family:var(--font-mono);font-size:11px;line-height:1.5;max-height:60vh;overflow:auto;white-space:pre-wrap;',
          }, data.logs || '(无日志)'),
          footer: `最近 200 行 · ${c.id}`,
        });
      } catch (e) {
        notify.error(`获取日志失败: ${e.message}`);
      }
    });
  });

  body.appendChild(table);
}

// ═══════════════════════════════════════════════════════════
//  Images
// ═══════════════════════════════════════════════════════════

function renderImages(images) {
  const panel = document.querySelectorAll('.panel--docker')[1];
  if (!panel) return;
  const body = panel.querySelector('.panel__body');
  if (!body) return;
  clear(body);

  if (!images.length) {
    body.appendChild(EmptyState({ icon: 'disk', message: '没有镜像' }));
    return;
  }

  const table = DataTable({
    columns: ['tag', 'id', 'size_bytes', 'created'],
    labels: { tag: '标签', id: 'ID', size_bytes: '大小', created: '创建时间' },
    rows: images,
    format: (col, val) => {
      if (col === 'size_bytes') return bytes(val);
      if (col === 'created') return val ? dateShort(val) : '--';
      return val || '--';
    },
  });

  body.appendChild(table);
}
