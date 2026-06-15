/**
 * LingServer Dashboard — Processes Tab (dame graft)
 *
 * Sortable process table with kill action, pagination.
 * Data: GET /api/processes + DELETE /api/processes/{pid}
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, del } from '../api.js';
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';
import { bytes, percent } from '../utils/format.js';

let _refreshTimer = null;
let _sortKey = 'cpu', _sortDir = -1, _page = 1;

export async function renderProcesses(container) {
  clear(container);

  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' ps aux --sort=-%cpu',
      ),
      el('div', { class: 'panel__actions' },
        el('button', { class: 'panel__btn', id: 'proc-refresh', onClick: loadProcesses }, '刷新'),
      ),
    ),
    el('div', { class: 'panel__body', id: 'proc-body', style: 'overflow:auto;' }),
  );
  container.appendChild(panel);

  loadProcesses();
  _refreshTimer = setInterval(loadProcesses, 5000);
}

async function loadProcesses() {
  const body = $('#proc-body');
  if (!body) return;
  try {
    const data = await get(`/api/processes?sort=${_sortKey}&limit=100`);
    renderTable(data, body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
  }
}

function renderTable(data, body) {
  clear(body);
  const procs = data.processes || data.items || [];

  if (!procs.length) { body.innerHTML = '<div class="empty-state">无进程数据</div>'; return; }

  const COL_SORT_MAP = { cpu: 'cpu', cpu_percent: 'cpu', memory_percent: 'memory_percent' };
  const columns = [
    { key: 'pid', label: 'PID' },
    { key: 'name', label: '进程名' },
    { key: 'cpu_percent', label: 'CPU %' },
    { key: 'memory_percent', label: '内存 %' },
    { key: 'username', label: '用户' },
    { key: 'status', label: '状态' },
    { key: 'actions', label: '' },
  ];

  const th = (col) => {
    const isActive = _sortKey === col.key;
    const arrow = isActive ? (_sortDir > 0 ? ' ▴' : ' ▾') : '';
    return `<th class="${isActive ? 'sorted' : ''}" data-sort="${col.key}">${col.label}<span class="sort-arrow">${arrow}</span></th>`;
  };

  body.innerHTML = `<table class="proc-table">
    <thead><tr>${columns.map(th).join('')}</tr></thead>
    <tbody>${procs.map(p => {
      return `<tr>
        <td>${p.pid}</td>
        <td style="font-weight:500">${_esc(p.name)}</td>
        <td>${percent(p.cpu_percent || 0)}</td>
        <td>${percent(p.memory_percent || 0)}</td>
        <td>${_esc(p.username || '--')}</td>
        <td><span class="status-badge status-badge--neutral">${p.status || '--'}</span></td>
        <td><button class="panel__btn panel__btn--danger panel__btn--sm proc-action" data-kill="${p.pid}">终止</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;

  // Sort click
  body.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const mapped = COL_SORT_MAP[key] || key;
      if (_sortKey === mapped) _sortDir *= -1;
      else { _sortKey = mapped; _sortDir = -1; }
      loadProcesses();
    });
  });

  // Kill buttons (with double-click guard)
  body.querySelectorAll('[data-kill]').forEach(btn => {
    let killing = false;
    btn.addEventListener('click', async () => {
      if (killing) return;
      const pid = btn.dataset.kill;
      const ok = await confirm(`确定终止进程 PID ${pid}？`, '终止进程');
      if (!ok) return;
      killing = true; btn.disabled = true;
      try {
        await del(`/api/processes/${pid}`);
        notify.success(`已终止 PID ${pid}`);
        loadProcesses();
      } catch (e) {
        notify.error(`终止失败: ${e.message}`);
        killing = false; btn.disabled = false;
      }
    });
  });

  // Pagination
  if (data.pages > 1 || data.total > procs.length) {
    const pages = data.pages || Math.ceil((data.total || procs.length) / 25);
    body.appendChild(el('div', { class: 'panel__footer' },
      el('div', { class: 'pagination' },
        el('button', { class: 'pagination__btn', disabled: _page <= 1,
          onClick: () => { _page--; loadProcesses(); } }, '◀'),
        el('span', { class: 'pagination__info' }, `${_page} / ${pages}`),
        el('button', { class: 'pagination__btn', disabled: _page >= pages,
          onClick: () => { _page++; loadProcesses(); } }, '▶'),
      ),
    ));
  }
}

function _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

export function cleanup() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}
