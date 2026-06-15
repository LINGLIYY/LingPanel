/**
 * LingServer Dashboard — Processes Tab
 *
 * Process table with sort, search, kill.
 * API: GET /api/processes?limit=&sort=
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, del } from '../api.js';
import { DataTable, KpiCard } from '../ui.js';
import { notify } from '../utils/notify.js';
import { number } from '../utils/format.js';
import { icon, iconLabel } from '../utils/icons.js';

let _sort = 'cpu';
let _limit = 50;
let _refreshTimer = null;

/**
 * Render the processes tab.
 */
export async function renderProcesses(container) {
  clear(container);

  // Toolbar
  const toolbar = el('div', {
    style: 'display:flex;align-items:center;gap:8px;margin-bottom:12px;',
  },
    el('span', { style: 'font-size:14px;font-weight:600;color:var(--color-text-heading);' }, '进程管理'),
    el('div', { style: 'flex:1;' }),
    el('select', {
      id: 'proc-sort',
      style: 'height:28px;padding:0 8px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:4px;font-size:12px;color:var(--color-text-body);',
      onChange: (e) => { _sort = e.target.value; loadProcesses(); },
    },
      el('option', { value: 'cpu' }, '按 CPU 排序'),
      el('option', { value: 'memory' }, '按内存排序'),
    ),
    el('input', {
      id: 'proc-search',
      type: 'text',
      placeholder: '搜索进程名...',
      style: 'height:28px;padding:0 8px;width:180px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:4px;font-size:12px;color:var(--color-text-body);',
      onInput: () => loadProcesses(),
    }),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: loadProcesses, html: iconLabel('refresh', '刷新')}),
  );
  container.appendChild(toolbar);

  // KPI row
  const kpiRow = el('div', { class: 'kpi-row', style: 'grid-template-columns:repeat(4,1fr);', id: 'proc-kpis' });
  container.appendChild(kpiRow);

  // Table
  const tableWrap = el('div', { id: 'proc-table-wrap' });
  container.appendChild(tableWrap);

  loadProcesses();

  // Auto-refresh every 5s
  _refreshTimer = setInterval(loadProcesses, 5000);
}

async function loadProcesses() {
  try {
    const searchTerm = $('#proc-search')?.value?.toLowerCase() || '';
    const data = await get(`/api/processes?limit=${_limit}&sort=${_sort}`);

    const processes = data.processes || [];
    const filtered = searchTerm
      ? processes.filter(p => p.name.toLowerCase().includes(searchTerm))
      : processes;

    // Update KPIs
    updateProcKpis(processes);
    // Update table
    renderProcTable(filtered, data.total);
  } catch (e) {
    notify.error(`加载进程失败: ${e.message}`);
  }
}

function updateProcKpis(processes) {
  const row = $('#proc-kpis');
  if (!row) return;
  clear(row);

  // Single-pass: count statuses + find top CPU/Mem
  let running = 0, sleeping = 0, topCpu = processes[0], topMem = processes[0];
  for (const p of processes) {
    if (p.status === 'running') running++;
    else if (p.status === 'sleeping') sleeping++;
    if ((p.cpu_percent || 0) > (topCpu.cpu_percent || 0)) topCpu = p;
    if ((p.memory_percent || 0) > (topMem.memory_percent || 0)) topMem = p;
  }
  const total = processes.length;

  row.appendChild(KpiCard({ label: '进程总数', value: number(total), icon: 'bar-chart' }));
  row.appendChild(KpiCard({ label: '运行中', value: number(running), icon: 'circle-green' }));
  row.appendChild(KpiCard({ label: 'CPU 最高', value: topCpu ? `${topCpu.name?.substring(0, 12)}` : '--', sub: topCpu ? `${topCpu.cpu_percent?.toFixed(1)}%` : '', icon: 'cpu' }));
  row.appendChild(KpiCard({ label: '内存最高', value: topMem ? `${topMem.name?.substring(0, 12)}` : '--', sub: topMem ? `${topMem.memory_percent?.toFixed(1)}%` : '', icon: 'memory' }));
}

function renderProcTable(processes, total) {
  const wrap = $('#proc-table-wrap');
  if (!wrap) return;
  clear(wrap);

  if (!processes.length) {
    wrap.appendChild(el('div', { style: 'padding:20px;text-align:center;color:var(--color-text-muted);' }, '无匹配进程'));
    return;
  }

  const rows = processes.map(p => ({
    pid: p.pid,
    name: p.name,
    cpu_percent: p.cpu_percent?.toFixed(1) || '0.0',
    memory_percent: p.memory_percent?.toFixed(1) || '0.0',
    status: p.status || '?',
    username: p.username || '?',
    actions: '⏹',
  }));

  const table = DataTable({
    columns: ['pid', 'name', 'cpu_percent', 'memory_percent', 'status', 'username', 'actions'],
    labels: {
      pid: 'PID', name: '进程名', cpu_percent: `CPU % ${_sort === 'cpu' ? '▼' : ''}`,
      memory_percent: `内存 % ${_sort === 'memory' ? '▼' : ''}`,
      status: '状态', username: '用户', actions: '',
    },
    rows,
    format: (col, val, row) => {
      if (col === 'pid') return el('span', { style: 'font-family:var(--font-mono);font-size:11px;' }, val);
      if (col === 'name') return el('span', { style: 'font-weight:500;' }, val);
      if (col === 'cpu_percent') {
        const v = parseFloat(val) || 0;
        const color = v > 50 ? 'var(--color-error)' : v > 20 ? 'var(--color-warning)' : 'var(--color-text-body)';
        return el('span', { style: `color:${color};font-family:var(--font-mono);` }, val + '%');
      }
      if (col === 'memory_percent') {
        const v = parseFloat(val) || 0;
        const color = v > 50 ? 'var(--color-error)' : v > 30 ? 'var(--color-warning)' : 'var(--color-text-body)';
        return el('span', { style: `color:${color};font-family:var(--font-mono);` }, val + '%');
      }
      if (col === 'status') {
        const color = val === 'running' ? 'var(--color-success)' : 'var(--color-text-muted)';
        return el('span', { style: `color:${color};` }, val);
      }
      if (col === 'actions') {
        return el('span', { class: 'process-kill-btn', title: '终止进程', onClick: (e) => { e.stopPropagation(); killProcess(row.pid, row.name); }, html: icon('x') });
      }
      return val;
    },
  });

  // Footer
  const footer = el('div', {
    style: 'padding:8px 12px;font-size:11px;color:var(--color-text-dim);text-align:right;',
  }, `显示 ${processes.length} / ${total} 个进程 · 每 5s 自动刷新`);

  wrap.appendChild(table);
  wrap.appendChild(footer);
}

async function killProcess(pid, name) {
  if (!confirm(`确定终止进程 ${name} (PID: ${pid})？`)) return;
  try {
    await del(`/api/processes/${pid}`);
    notify.success(`已终止: ${name}`);
    loadProcesses();
  } catch (e) {
    notify.error(`终止失败: ${e.message}`);
  }
}

// Cleanup on tab switch
export function cleanup() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}
