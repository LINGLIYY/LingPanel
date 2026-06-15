/**
 * LingServer Dashboard — Docker Tab (dame graft)
 *
 * Container cards with status dots, start/stop, logs viewer.
 * Gracefully degrades when Docker is unavailable.
 * Data: GET /api/docker/* + POST /api/docker/containers/{id}/{action}
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, post } from '../api.js';
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';

let _refreshTimer = null;

export async function renderDocker(container) {
  clear(container);

  // Docker info bar
  const infoBar = el('div', { id: 'docker-info', style: 'margin-bottom:8px;' });
  container.appendChild(infoBar);

  // Containers panel
  const cPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' docker ps -a',
      ),
    ),
    el('div', { class: 'panel__body', id: 'docker-containers-body', style: 'overflow:auto;' }),
  );
  container.appendChild(cPanel);

  // Images panel
  const iPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' docker images',
      ),
    ),
    el('div', { class: 'panel__body', id: 'docker-images-body', style: 'overflow:auto;' }),
  );
  container.appendChild(iPanel);

  loadAll();
  _refreshTimer = setInterval(loadAll, 10000);
}

async function loadAll() {
  // Info
  try {
    const info = await get('/api/docker/info');
    const bar = $('#docker-info');
    if (bar && info) {
      bar.innerHTML = `<span style="font-size:12px;color:var(--t-muted);">
        Docker ${info.server_version || info.version || '--'} ·
        容器: ${info.containers_running || 0} 运行 / ${info.containers_total || 0} 总计 ·
        镜像: ${info.images || 0}
      </span>`;
    }
  } catch (_) {}

  // Containers
  const cBody = $('#docker-containers-body');
  if (cBody) {
    try {
      const data = await get('/api/docker/containers');
      renderContainers(data.containers || data || [], cBody);
    } catch (e) {
      cBody.innerHTML = `<div class="empty-state">Docker 不可用<br><small>${e.message}</small></div>`;
    }
  }

  // Images
  const iBody = $('#docker-images-body');
  if (iBody) {
    try {
      const data = await get('/api/docker/images');
      const images = data.images || data || [];
      if (!images.length) iBody.innerHTML = '<div class="empty-state">无镜像</div>';
      else renderImages(images, iBody);
    } catch (_) {
      iBody.innerHTML = '<div class="empty-state">-</div>';
    }
  }
}

function renderContainers(containers, body) {
  clear(body);
  if (!containers.length) { body.innerHTML = '<div class="empty-state">无容器</div>'; return; }

  body.innerHTML = `<div class="svc-grid">${containers.map(c => {
    const running = (c.status || c.state || '').toLowerCase().includes('up') || c.state === 'running';
    const dotClass = running ? 'svc-mgmt-card__dot--active' : 'svc-mgmt-card__dot--inactive';
    const name = c.name || c.id?.substring(0, 12) || '--';
    const ports = c.ports ? (Array.isArray(c.ports) ? c.ports.join(', ') : c.ports) : '';
    return `<div class="svc-mgmt-card">
      <span class="svc-mgmt-card__icon">🐳</span>
      <span class="svc-mgmt-card__dot ${dotClass}"></span>
      <span class="svc-mgmt-card__body">
        <div class="svc-mgmt-card__name">${_esc(name)}</div>
        <div class="svc-mgmt-card__desc">${_esc(c.image || '--')}${ports ? ' · ' + _esc(ports) : ''}</div>
      </span>
      <span class="svc-mgmt-card__actions">
        ${running
          ? `<button class="panel__btn panel__btn--danger panel__btn--sm ctrl-stop" data-cid="${c.id}">■</button>`
          : `<button class="panel__btn panel__btn--sm ctrl-start" data-cid="${c.id}">▶</button>`}
        <button class="panel__btn panel__btn--sm ctrl-logs" data-cid="${c.id}">📋</button>
      </span>
    </div>`;
  }).join('')}</div>`;

  // Wire up actions
  body.querySelectorAll('.ctrl-start, .ctrl-stop').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.cid;
      const action = btn.classList.contains('ctrl-start') ? 'start' : 'stop';
      const ok = await confirm(`确定${action === 'start' ? '启动' : '停止'}容器？`, '容器操作', 'info');
      if (!ok) return;
      try {
        await post(`/api/docker/containers/${cid}/${action}`);
        notify.success(`容器${action === 'start' ? '已启动' : '已停止'}`);
        loadAll();
      } catch (e) { notify.error(`操作失败: ${e.message}`); }
    });
  });

  body.querySelectorAll('.ctrl-logs').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const data = await get(`/api/docker/containers/${btn.dataset.cid}/logs?tail=50`);
        const logs = data.logs || JSON.stringify(data);
        // Show in a simple modal-style overlay
        const overlay = el('div', {
          style: 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:oklch(0 0 0 / 0.6);',
          onClick: (e) => { if (e.target === overlay) overlay.remove(); },
        },
          el('div', { class: 'panel', style: 'width:700px;max-width:90vw;max-height:80vh;' },
            el('div', { class: 'panel__header' },
              el('span', { class: 'panel__title' }, '容器日志'),
              el('button', { class: 'panel__btn panel__btn--sm', onClick: () => overlay.remove() }, '关闭'),
            ),
            el('pre', { class: 'panel__body', style: 'max-height:60vh;overflow:auto;font-family:var(--font-mono);font-size:11px;white-space:pre-wrap;' },
              _esc(logs),
            ),
          ),
        );
        document.body.appendChild(overlay);
      } catch (e) { notify.error(`获取日志失败: ${e.message}`); }
    });
  });
}

function renderImages(images, body) {
  clear(body);
  body.innerHTML = `<div class="svc-grid">${images.map(i => `<div class="svc-mgmt-card">
    <span class="svc-mgmt-card__icon">📦</span>
    <span class="svc-mgmt-card__body">
      <div class="svc-mgmt-card__name">${_esc(i.tag || i.tags?.[0] || i.repository || i.id?.substring(0, 12) || '--')}</div>
      <div class="svc-mgmt-card__desc">${_esc(i.created || '')} · ${_esc(i.size_bytes || i.size || '')}</div>
    </span>
  </div>`).join('')}</div>`;
}

function _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

export function cleanup() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}
