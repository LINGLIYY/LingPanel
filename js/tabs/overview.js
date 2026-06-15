/**
 * LingServer Dashboard — Overview Tab
 *
 * 6 real-time KPI cards + CPU waveform + detail panels.
 * Subscribes to WebSocket metrics updates.
 */
import { el, clear, $ } from '../utils/dom.js';
import { KpiCard, updateKpi, Panel, panelBody } from '../ui.js';
import { on, off, appState } from '../state.js';
import { connect } from '../ws.js';
import { uptime, percent, bytesPerSec } from '../utils/format.js';

let _initialized = false;
let _stopCanvasPolling = null;
let _onMetrics = null;
let _onTheme = null;
let _onResize = null;

/**
 * Render the Overview tab content.
 */
export async function renderOverview(container) {
  if (_initialized) return;
  clear(container);

  // ── KPI Row ──
  const kpiRow = el('div', { class: 'kpi-row' },
    KpiCard({ id: 'cpu',    label: 'CPU',       value: '--', sub: '--', icon: 'cpu',        color: 'blue-500' }),
    KpiCard({ id: 'mem',    label: '内存',     value: '--', sub: '--', icon: 'memory',     color: 'green' }),
    KpiCard({ id: 'disk',   label: '磁盘',     value: '--', sub: '--', icon: 'disk',       color: 'cyan-500' }),
    KpiCard({ id: 'net',    label: '网络',     value: '--', sub: '--', icon: 'network',    color: 'neon-500' }),
    KpiCard({ id: 'uptime', label: '运行时间', value: '--', sub: '--', icon: 'clock',      color: 'blue-300' }),
    KpiCard({ id: 'load',   label: '负载',     value: '--', sub: '--', icon: 'bar-chart', color: 'yellow' }),
  );
  container.appendChild(kpiRow);

  // ── CPU Waveform ──
  const wavePanel = Panel({ title: 'CPU 使用率 — 最近 60 秒', className: 'panel--wave' });
  const waveBody = panelBody(wavePanel);
  const canvas = el('canvas', { id: 'cpu-canvas', class: 'wave-canvas' });
  waveBody.appendChild(canvas);
  container.appendChild(wavePanel);

  // ── Detail panels row ──
  const detailRow = el('div', { class: 'detail-row' },
    el('div', { class: 'detail-col', id: 'detail-system' }),
    el('div', { class: 'detail-col', id: 'detail-disks' }),
  );
  container.appendChild(detailRow);

  // ── Init waveform ──
  let waveReady = false;
  const { initWave, pushCpu, resizeWave, stopWave } = await import('../canvas-wave.js');

  // Wait for canvas to be visible (max 50 retries, stops on cleanup)
  let _canvasRetries = 0;
  const initCanvas = () => {
    if (waveReady || _stopCanvasPolling) return;
    const c = $('#cpu-canvas');
    if (c && c.clientWidth > 0) {
      initWave(c);
      waveReady = true;
    } else if (_canvasRetries < 50) {
      _canvasRetries++;
      setTimeout(initCanvas, 100);
    }
  };
  initCanvas();

  // ── Subscribe to metrics ──
  _onMetrics = (data) => {
    updateKpis(data);
    if (waveReady && data.cpu) {
      pushCpu(data.cpu.percent);
    }
    renderDetailPanels(data);
  };
  on('metrics:update', _onMetrics);

  // ── Handle theme changes ──
  _onTheme = () => {
    if (waveReady) resizeWave();
  };
  on('theme:change', _onTheme);

  // ── Handle window resize ──
  _onResize = () => {
    if (waveReady) resizeWave();
  };
  window.addEventListener('resize', _onResize);

  // ── Stop canvas polling — store stopper ──
  _stopCanvasPolling = false;

  // ── Connect WebSocket if not already ──
  if (appState.wsStatus === 'disconnected') {
    connect(['system']);
  }

  _initialized = true;
}

export function cleanup() {
  if (_onMetrics) off('metrics:update', _onMetrics);
  if (_onTheme) off('theme:change', _onTheme);
  if (_onResize) window.removeEventListener('resize', _onResize);
  _stopCanvasPolling = true;
  _onMetrics = null;
  _onTheme = null;
  _onResize = null;
  _initialized = false;
}

// ═══════════════════════════════════════════════════════════
//  KPI Updates
// ═══════════════════════════════════════════════════════════

function updateKpis(data) {
  if (!data) return;

  // CPU
  if (data.cpu) {
    const color = data.cpu.percent > 90 ? 'red' :
                  data.cpu.percent > 70 ? 'yellow' : 'green';
    updateKpi('cpu', {
      value: percent(data.cpu.percent, 1),
      sub: `${data.cpu.cores || 0} 核 / ${data.cpu.threads || 0} 线程`,
      color,
    });
  }

  // Memory
  if (data.memory) {
    const color = data.memory.percent > 90 ? 'red' :
                  data.memory.percent > 70 ? 'yellow' : 'green';
    updateKpi('mem', {
      value: percent(data.memory.percent, 1),
      sub: `${data.memory.used_gb} / ${data.memory.total_gb} GB`,
      color,
    });
  }

  // Disk (first disk)
  if (data.disks && data.disks.length > 0) {
    const d = data.disks[0];
    const color = d.percent > 90 ? 'red' : d.percent > 75 ? 'yellow' : 'green';
    updateKpi('disk', {
      value: percent(d.percent, 1),
      sub: `${d.used_gb} / ${d.total_gb} GB`,
      color,
    });
  }

  // Network
  if (data.network) {
    updateKpi('net', {
      value: bytesPerSec(data.network.speed_down_kbs * 1024),
      sub: `↑ ${bytesPerSec(data.network.speed_up_kbs * 1024)}`,
    });
  }

  // Uptime
  if (data.uptime_seconds) {
    updateKpi('uptime', {
      value: uptime(data.uptime_seconds),
      sub: data.hostname || '',
    });
  }

  // Load
  if (data.cpu && data.cpu.load_avg) {
    const la = data.cpu.load_avg;
    updateKpi('load', {
      value: la['1min'] ? la['1min'].toFixed(2) : '--',
      sub: `${la['5min']?.toFixed(2) || '--'} / ${la['15min']?.toFixed(2) || '--'}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  Detail Panels
// ═══════════════════════════════════════════════════════════

function renderDetailPanels(data) {
  if (!data) return;

  const subtle = 'color:var(--color-subtle)';
  const mono = 'font-family:var(--font-mono);font-size:12px;';

  // System info — built with el() for safe text escaping
  const sysEl = $('#detail-system');
  if (sysEl) {
    clear(sysEl);
    const sysPanel = Panel({ title: '系统信息' });
    const body = panelBody(sysPanel);
    body.style.fontSize = '12px';
    body.style.lineHeight = '1.8';

    const rows = [
      el('div', {}, el('span', { style: subtle }, '主机名:'), ' ' + (data.hostname || '--')),
      el('div', {}, el('span', { style: subtle }, '系统:'), ` ${data.cpu?.cores || '--'} 核 · 运行 ${uptime(data.uptime_seconds)}`),
      el('div', {}, el('span', { style: subtle }, '负载:'),
        ` ${data.cpu?.load_avg?.['1min']?.toFixed(2) || '--'} / ${data.cpu?.load_avg?.['5min']?.toFixed(2) || '--'} / ${data.cpu?.load_avg?.['15min']?.toFixed(2) || '--'}`),
    ];

    if (data.swap) {
      rows.push(el('div', {},
        el('span', { style: subtle }, '交换:'),
        ` ${data.swap.used_gb} / ${data.swap.total_gb} GB (${percent(data.swap.percent)})`));
    }

    rows.push(
      el('div', {}, el('span', { style: subtle }, '网络:'),
        ` ↓ ${bytesPerSec((data.network?.speed_down_kbs || 0) * 1024)} · ↑ ${bytesPerSec((data.network?.speed_up_kbs || 0) * 1024)}`),
      el('div', {}, el('span', { style: subtle }, '总计:'),
        ` ↓ ${data.network?.total_down_gb || '--'} GB · ↑ ${data.network?.total_up_gb || '--'} GB`),
    );

    for (const row of rows) body.appendChild(row);
    sysEl.appendChild(sysPanel);
  }

  // Disks — built with el() for safe text escaping
  const diskEl = $('#detail-disks');
  if (diskEl && data.disks) {
    clear(diskEl);
    const diskPanel = Panel({ title: '磁盘' });
    const body = panelBody(diskPanel);

    const table = el('table', { class: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, '挂载点'),
          el('th', {}, '用量'),
          el('th', {}, '使用率'),
        ),
      ),
      el('tbody', {},
        ...data.disks.map(d => {
          const pct = d.percent;
          const color = pct > 90 ? 'var(--red)' : pct > 75 ? 'var(--yellow)' : 'var(--green)';
          return el('tr', {},
            el('td', { style: mono }, d.mount),
            el('td', { style: mono }, `${d.used_gb} / ${d.total_gb} GB`),
            el('td', { style: `${mono}color:${color};` }, percent(pct)),
          );
        }),
      ),
    );

    body.appendChild(table);
    diskEl.appendChild(diskPanel);
  }
}
