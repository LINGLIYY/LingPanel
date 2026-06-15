/**
 * LingServer Dashboard — Overview Tab (dame graft)
 *
 * 6 KPI cards (double-glass) with sparklines + CPU waveform +
 * system info & disk detail panels + Launchpad quick services.
 * Data: WebSocket /ws/live + localStorage for launchpad.
 */
import { el, clear, $ } from '../utils/dom.js';
import { comm } from '../comm.js';
const { on, off } = comm;
import { uptime, percent, bytesPerSec, bytes } from '../utils/format.js';

let _initialized = false;
let _stopCanvasPolling = false;
let _onMetrics = null;
let _onTheme = null;
let _onResize = null;

// Rolling history buffers for sparklines (60 samples each)
const _history = { cpu: [], mem: [], disk: [], net: [], load: [] };
const MAX_HIST = 60;

// ═══════════════════════════════════════════════════════════
//  Render
// ═══════════════════════════════════════════════════════════

export async function renderOverview(container) {
  if (_initialized) return;
  clear(container);

  // ── KPI Row ──
  const kpiRow = el('div', { class: 'kpi-row', id: 'kpi-row' });
  container.appendChild(kpiRow);

  // ── Detail panels row (3-column: waveform | system info | disks) ──
  const detailRow = el('div', { class: 'detail-row' },
    // CPU Waveform (column 1)
    el('div', { class: 'panel panel--wave' },
      el('div', { class: 'panel__header' },
        el('h2', { class: 'panel__title' },
          el('span', { class: 'prompt' }, '$'),
          ' cpu --watch',
        ),
      ),
      el('div', { class: 'panel__body' },
        el('canvas', { id: 'cpu-canvas', class: 'wave-canvas', role: 'img', 'aria-label': 'CPU 使用率波形图，最近 60 秒' }),
      ),
    ),
    // System Info (column 2)
    el('div', { class: 'panel', id: 'detail-system' },
      el('div', { class: 'panel__header' },
        el('h2', { class: 'panel__title' },
          el('span', { class: 'prompt' }, '$'),
          ' cat /proc/cpuinfo',
        ),
      ),
      el('div', { class: 'panel__body', id: 'detail-system-body' }),
    ),
    // Disk Table (column 3)
    el('div', { class: 'panel', id: 'detail-disks' },
      el('div', { class: 'panel__header' },
        el('h2', { class: 'panel__title' },
          el('span', { class: 'prompt' }, '$'),
          ' df -h',
        ),
      ),
      el('div', { class: 'panel__body', id: 'detail-disks-body' },
        el('div', { class: 'empty-state' }, '暂无磁盘数据'),
      ),
    ),
  );
  container.appendChild(detailRow);

  // ── Launchpad (quick services) ──
  const launchpad = el('div', { class: 'panel launchpad' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' ssh quick.launchpad',
      ),
      el('div', { class: 'panel__actions' },
        el('div', { class: 'view-toggle', id: 'launchpad-toggle' },
          el('button', { class: 'view-toggle__btn active', 'data-view': 'tile', 'data-tip': '平铺', 'aria-checked': 'true', role: 'radio' }, '▦'),
          el('button', { class: 'view-toggle__btn', 'data-view': 'icon', 'data-tip': '图标', 'aria-checked': 'false', role: 'radio' }, '⊞'),
        ),
      ),
    ),
    el('div', { class: 'launchpad__grid', id: 'launchpad-grid' }),
  );
  container.appendChild(launchpad);

  // ── Init waveform ──
  let waveReady = false;
  const { initWave, pushCpu, resizeWave, stopWave } = await import('../canvas-wave.js');

  let _canvasRetries = 0;
  const initCanvas = () => {
    if (waveReady || _stopCanvasPolling) return;
    const c = $('#cpu-canvas');
    if (c && c.clientWidth > 0) { initWave(c); waveReady = true; }
    else if (_canvasRetries < 50) { _canvasRetries++; setTimeout(initCanvas, 100); }
  };
  initCanvas();

  // ── Subscribe to metrics ──
  _onMetrics = (data) => {
    updateKpis(data);
    if (waveReady && data.cpu) pushCpu(data.cpu.percent);
    renderDetailPanels(data);
  };
  on('metrics:update', _onMetrics);

  // ── Theme / resize ──
  _onTheme = () => { if (waveReady) resizeWave(); };
  on('theme:change', _onTheme);
  _onResize = () => { if (waveReady) resizeWave(); };
  window.addEventListener('resize', _onResize);

  _stopCanvasPolling = false;

  // ── Connect WebSocket ──
  if (comm.state.wsStatus === 'disconnected') comm.live.connect(['system']);

  // ── Init launchpad ──
  initLaunchpad();

  _initialized = true;
}

export function cleanup() {
  if (_onMetrics) off('metrics:update', _onMetrics);
  if (_onTheme) off('theme:change', _onTheme);
  if (_onResize) window.removeEventListener('resize', _onResize);
  _stopCanvasPolling = true;
  _onMetrics = _onTheme = _onResize = null;
  _initialized = false;
}

// ═══════════════════════════════════════════════════════════
//  KPI Cards (dame double-glass)
// ═══════════════════════════════════════════════════════════

const KPI_ICONS = {
  cpu: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  mem: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/></svg>',
  disk: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="8"/><path d="M2 12h20"/><path d="M12 4v16"/></svg>',
  net: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10"/><path d="M12 2a15.3 15.3 0 00-4 10 15.3 15.3 0 004 10"/></svg>',
};

function kpiCardHTML(id, label, iconSvg, value, sub, color, hist) {
  const valClass = color ? `kpi-card__value ${color}` : 'kpi-card__value';
  const sparkSvg = hist && hist.length > 1 ? sparklineSVG(hist, color || 'green') : '';
  return `<div class="kpi-card-shell">
    <div class="kpi-card">
      <div class="kpi-card__header">
        <span class="kpi-card__icon">${iconSvg}</span>
        <span class="kpi-card__label">${label}</span>
      </div>
      <div class="${valClass}" id="kpi-${id}-val">${_esc(value)}</div>
      <div class="kpi-card__sub" id="kpi-${id}-sub">${_esc(sub)}</div>
      ${sparkSvg ? `<div class="kpi-card__spark">${sparkSvg}</div>` : ''}
    </div>
  </div>`;
}

function sparklineSVG(data, colorClass) {
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = 20, pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const strokeColor = colorClass === 'danger' ? 'oklch(0.55 0.22 25 / 0.6)'
    : colorClass === 'warning' ? 'oklch(0.75 0.15 85 / 0.6)'
    : 'oklch(0.72 0.22 160 / 0.5)';
  const fillColor = colorClass === 'danger' ? 'oklch(0.55 0.22 25 / 0.06)'
    : colorClass === 'warning' ? 'oklch(0.75 0.15 85 / 0.06)'
    : 'oklch(0.72 0.22 160 / 0.08)';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="${points} ${w - pad},${h - pad} ${pad},${h - pad}" fill="${fillColor}"/>
  </svg>`;
}

function updateKpis(data) {
  if (!data) return;
  updateHistory(data);

  const kpis = [
    { id: 'cpu', label: 'CPU', icon: 'cpu',
      val: percent(data.cpu?.percent || 0, 1),
      sub: `${data.cpu?.cores || 0}核 / ${data.cpu?.threads || 0}线程`,
      color: (data.cpu?.percent || 0) > 90 ? 'danger' : (data.cpu?.percent || 0) > 70 ? 'warning' : '',
      hist: _history.cpu },
    { id: 'mem', label: '内存', icon: 'mem',
      val: percent(data.memory?.percent || 0, 1),
      sub: `${data.memory?.used_gb || 0} / ${data.memory?.total_gb || 0} GB`,
      color: (data.memory?.percent || 0) > 90 ? 'danger' : (data.memory?.percent || 0) > 70 ? 'warning' : '',
      hist: _history.mem },
    { id: 'disk', label: '磁盘', icon: 'disk',
      val: percent(data.disks?.[0]?.percent || 0, 1),
      sub: `${data.disks?.[0]?.used_gb || 0} / ${data.disks?.[0]?.total_gb || 0} GB`,
      color: (data.disks?.[0]?.percent || 0) > 90 ? 'danger' : (data.disks?.[0]?.percent || 0) > 75 ? 'warning' : '',
      hist: _history.disk },
    { id: 'net', label: '网络', icon: 'net',
      val: bytesPerSec((data.network?.speed_down_kbs || 0) * 1024),
      sub: `↑ ${bytesPerSec((data.network?.speed_up_kbs || 0) * 1024)}`,
      color: '', hist: _history.net },
    { id: 'uptime', label: '运行时间', icon: 'clock',
      val: uptime(data.uptime_seconds || 0),
      sub: data.hostname || '--', color: '', hist: null },
    { id: 'load', label: '负载', icon: 'bar-chart',
      val: (data.cpu?.load_avg?.['1min'] || 0).toFixed(2),
      sub: `${(data.cpu?.load_avg?.['5min'] || 0).toFixed(2)} / ${(data.cpu?.load_avg?.['15min'] || 0).toFixed(2)}`,
      color: '', hist: _history.load },
  ];

  const row = $('#kpi-row');
  if (!row) return;

  const icons = {
    cpu: KPI_ICONS.cpu, mem: KPI_ICONS.mem, disk: KPI_ICONS.disk, net: KPI_ICONS.net,
    clock: KPI_ICONS.cpu, 'bar-chart': KPI_ICONS.net,
  };

  if (!row.dataset.init) {
    row.innerHTML = kpis.map(k => kpiCardHTML(k.id, k.label, icons[k.icon] || icons.cpu, k.val, k.sub, k.color, k.hist)).join('');
    row.dataset.init = '1';
  } else {
    for (const k of kpis) {
      const valEl = $(`#kpi-${k.id}-val`);
      const subEl = $(`#kpi-${k.id}-sub`);
      if (valEl) {
        if (valEl.textContent !== k.val) {
          valEl.textContent = k.val;
          valEl.style.animation = 'none';
          valEl.offsetHeight;
          valEl.style.animation = 'value-flash 0.4s cubic-bezier(0.16,1,0.3,1)';
        }
        valEl.className = `kpi-card__value ${k.color}`;
      }
      if (subEl) subEl.textContent = k.sub;
    }
  }
}

function updateHistory(data) {
  const push = (arr, val) => { arr.push(val); if (arr.length > MAX_HIST) arr.shift(); };
  if (data.cpu) push(_history.cpu, data.cpu.percent || 0);
  if (data.memory) push(_history.mem, data.memory.percent || 0);
  if (data.disks?.[0]) push(_history.disk, data.disks[0].percent || 0);
  if (data.network) push(_history.net, data.network.speed_down_kbs || 0);
  if (data.cpu?.load_avg) push(_history.load, data.cpu.load_avg['1min'] || 0);
}

// ═══════════════════════════════════════════════════════════
//  Detail Panels
// ═══════════════════════════════════════════════════════════

function renderDetailPanels(data) {
  if (!data) return;

  // System info
  const sysEl = $('#detail-system-body');
  if (sysEl) {
    sysEl.innerHTML = [
      `<div class="info-row"><span class="info-row__key">hostname</span><span class="info-row__val">${_esc(data.hostname || '--')}</span></div>`,
      `<div class="info-row"><span class="info-row__key">cores</span><span class="info-row__val">${data.cpu?.cores || '--'} 核 / ${data.cpu?.threads || '--'} 线程</span></div>`,
      `<div class="info-row"><span class="info-row__key">uptime</span><span class="info-row__val">${uptime(data.uptime_seconds || 0)}</span></div>`,
      `<div class="info-row"><span class="info-row__key">load</span><span class="info-row__val">${(data.cpu?.load_avg?.['1min'] || 0).toFixed(2)} / ${(data.cpu?.load_avg?.['5min'] || 0).toFixed(2)} / ${(data.cpu?.load_avg?.['15min'] || 0).toFixed(2)}</span></div>`,
      data.swap ? `<div class="info-row"><span class="info-row__key">swap</span><span class="info-row__val">${data.swap.used_gb || 0} / ${data.swap.total_gb || 0} GB (${percent(data.swap.percent || 0)})</span></div>` : '',
      `<div class="info-row"><span class="info-row__key">net</span><span class="info-row__val">↓ ${bytesPerSec((data.network?.speed_down_kbs || 0) * 1024)} · ↑ ${bytesPerSec((data.network?.speed_up_kbs || 0) * 1024)}</span></div>`,
      `<div class="info-row"><span class="info-row__key">total</span><span class="info-row__val">↓ ${data.network?.total_down_gb || '--'} GB · ↑ ${data.network?.total_up_gb || '--'} GB</span></div>`,
    ].join('');
  }

  // Disks
  const diskEl = $('#detail-disks-body');
  if (diskEl && data.disks) {
    diskEl.innerHTML = `<table class="data-table">
      <thead><tr><th>挂载点</th><th>用量</th><th>使用率</th></tr></thead>
      <tbody>${data.disks.map(d => {
        const pct = d.percent;
        const cls = pct > 90 ? 'crit' : pct > 75 ? 'warn' : 'ok';
        return `<tr>
          <td style="font-weight:500">${_esc(d.mount)}</td>
          <td>${d.used_gb} / ${d.total_gb} GB</td>
          <td><div class="usage-bar-wrap">${percent(pct)}<div class="usage-bar"><div class="usage-bar__fill ${cls}" style="width:${pct}%"></div></div></div></td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }
}

// ═══════════════════════════════════════════════════════════
//  Launchpad (localStorage-backed quick services)
// ═══════════════════════════════════════════════════════════

function initLaunchpad() { renderLaunchpad(); initViewToggle(); }

const LS_SERVICES = 'ling-services';
const DEFAULT_SERVICES = [
  { id: 's_default_1', name: 'AsrtBot', url: '#', desc: '机器人控制台', icon: 'bot', primary: true },
  { id: 's_default_2', name: 'Portainer', url: '#', desc: '容器管理', icon: 'grid' },
  { id: 's_default_3', name: 'Grafana', url: '#', desc: '监控面板', icon: 'chart' },
  { id: 's_default_4', name: 'NPM', url: '#', desc: '反向代理', icon: 'globe' },
];

const LAUNCH_ICONS = {
  bot: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 014 4v1h3a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h3V6a4 4 0 014-4z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
  grid: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  chart: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  globe: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10"/><path d="M12 2a15.3 15.3 0 00-4 10 15.3 15.3 0 004 10"/></svg>',
  service: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
};

function loadServices() {
  try {
    const raw = localStorage.getItem(LS_SERVICES);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; }
  } catch (_) {}
  localStorage.setItem(LS_SERVICES, JSON.stringify(DEFAULT_SERVICES));
  return DEFAULT_SERVICES.slice();
}

function saveServices(arr) { localStorage.setItem(LS_SERVICES, JSON.stringify(arr)); }

function renderLaunchpad() {
  const grid = $('#launchpad-grid');
  if (!grid) return;
  const services = loadServices();
  grid.innerHTML = '';
  services.forEach(svc => {
    const wrap = el('div', { class: 'svc-card-wrap' });
    const a = el('a', { href: svc.url || '#', class: 'svc-card' + (svc.primary ? ' svc-card--primary' : ''), target: '_blank', rel: 'noopener' },
      el('span', { class: 'svc-card__icon', html: LAUNCH_ICONS[svc.icon] || LAUNCH_ICONS.service }),
      el('span', { class: 'svc-card__body' },
        el('span', { class: 'svc-card__name' }, _esc(svc.name)),
        el('span', { class: 'svc-card__desc' }, _esc(svc.desc || svc.name)),
      ),
      el('span', { class: 'svc-card__arrow', html: '↗' }),
    );
    const editBtn = el('button', { class: 'svc-card__edit', title: '编辑', 'aria-label': '编辑 ' + svc.name, html: '✎' });
    const delBtn = el('button', { class: 'svc-card__delete', title: '删除', 'aria-label': '删除 ' + svc.name, html: '✕' });
    wrap.appendChild(a);
    wrap.appendChild(editBtn);
    wrap.appendChild(delBtn);
    grid.appendChild(wrap);
  });
  // Add button
  grid.appendChild(el('div', { class: 'svc-card svc-card--add', onClick: () => openServiceModal(null) },
    el('span', { class: 'svc-card__icon', html: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' }),
    el('span', { class: 'svc-card__body' },
      el('span', { class: 'svc-card__name' }, '新建入口'),
      el('span', { class: 'svc-card__desc' }, '添加快捷方式'),
    ),
  ));

  // Event delegation
  grid.addEventListener('click', (e) => {
    const wrap = e.target.closest('.svc-card-wrap');
    if (!wrap) return;
    const nameEl = wrap.querySelector('.svc-card__name');
    const svcName = nameEl ? nameEl.textContent : '';
    const svc = loadServices().find(s => s.name === svcName);
    if (!svc) return;

    if (e.target.closest('.svc-card__edit')) {
      e.preventDefault(); e.stopPropagation();
      openServiceModal(svc.id);
    } else if (e.target.closest('.svc-card__delete')) {
      e.preventDefault(); e.stopPropagation();
      deleteService(svc);
    }
  });
}

function openServiceModal(editId) {
  const nameInp = $('#svc-name');
  const urlInp = $('#svc-url');
  const descInp = $('#svc-desc');
  const editIdInp = $('#svc-edit-id');
  const title = $('#service-modal-title');
  const submit = $('#modal-submit');
  const urlField = urlInp?.closest('.modal-field');
  if (urlField) urlField.style.display = '';  // restore visibility (services tab hides it)

  if (nameInp) nameInp.classList.remove('error');
  if (urlInp) urlInp.classList.remove('error');

  if (editId) {
    const svc = loadServices().find(s => s.id === editId);
    if (svc) {
      if (nameInp) nameInp.value = svc.name;
      if (urlInp) urlInp.value = svc.url;
      if (descInp) descInp.value = svc.desc || '';
      if (editIdInp) editIdInp.value = svc.id;
      if (title) title.innerHTML = '<span class="prompt">$</span> vim quick';
      if (submit) submit.textContent = '保存修改';
    }
  } else {
    if (nameInp) nameInp.value = '';
    if (urlInp) urlInp.value = '';
    if (descInp) descInp.value = '';
    if (editIdInp) editIdInp.value = '';
    if (title) title.innerHTML = '<span class="prompt">$</span> ssh-add quick';
    if (submit) submit.textContent = '添加入口';
  }

  // Bind submit handler — reads values directly from DOM (no param passing)
  window._svcTabSubmit = () => {
    const n = $('#svc-name')?.value?.trim();
    const u = $('#svc-url')?.value?.trim();
    const d = $('#svc-desc')?.value?.trim();
    const eid = $('#svc-edit-id')?.value;
    if (!n) {
      $('#svc-name')?.classList.add('error');
      return;
    }
    const services = loadServices();
    if (eid) {
      const s = services.find(x => String(x.id) === String(eid));
      if (s) { s.name = n; s.url = u || '#'; s.desc = d || n; }
    } else {
      services.push({ id: 's_' + Date.now(), name: n, url: u || '#', desc: d || n, icon: 'service' });
    }
    saveServices(services);
    renderLaunchpad();
    const bd = document.getElementById('service-modal');
    if (bd) { bd.classList.add('closing'); bd.setAttribute('aria-hidden', 'true');
      setTimeout(() => bd.classList.remove('open', 'closing'), 200); }
    window._svcTabSubmit = null;
    notify.info(n + (eid ? ' 已更新' : ' 已添加'));
  };

  const backdrop = document.getElementById('service-modal');
  if (backdrop) {
    backdrop.classList.remove('closing');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('#svc-name')?.focus(), 100);
  }
}

async function deleteService(svc) {
  const { confirm: cfm } = await import('../utils/confirm.js');
  const ok = await cfm('确定删除 ' + svc.name + '？', '删除服务');
  if (!ok) return;
  saveServices(loadServices().filter(s => s.id !== svc.id));
  renderLaunchpad();
  const { notify } = await import('../utils/notify.js');
  notify.info(svc.name + ' 已删除');
}

function initViewToggle() {
  const toggle = $('#launchpad-toggle');
  const panel = document.querySelector('.launchpad');
  if (!toggle || !panel) return;

  let currentView = localStorage.getItem('ling-launchpad-view') || 'tile';
  applyView(currentView);

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-toggle__btn');
    if (!btn) return;
    applyView(btn.dataset.view);
  });
}

function applyView(view) {
  localStorage.setItem('ling-launchpad-view', view);
  const panel = document.querySelector('.launchpad');
  if (panel) panel.classList.toggle('launchpad--icon', view === 'icon');
  const toggle = $('#launchpad-toggle');
  if (toggle) {
    toggle.querySelectorAll('.view-toggle__btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-checked', b.dataset.view === view ? 'true' : 'false');
    });
  }
}

function _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
