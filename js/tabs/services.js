/**
 * LingServer Dashboard — Services Tab (dame graft)
 *
 * Service management cards with dot indicators, start/stop/restart,
 * plus custom service CRUD (localStorage-backed).
 *
 * Data: GET /api/services + POST /api/services/{name}/{action}
 */
import { el, clear, $, escapeHtml } from '../utils/dom.js';
import { comm } from '../comm.js';
const { get, post } = comm.rest;
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';
import { icon } from '../utils/icons.js';

let _refreshTimer = null;

const STATUS_LABELS = { active: '运行中', inactive: '已停止', failed: '异常', unknown: '未知' };

export async function renderServices(container) {
  clear(container);

  // ── Panel header ──
  const header = el('div', { class: 'panel__header' },
    el('h2', { class: 'panel__title' },
      el('span', { class: 'prompt' }, '$'),
      ' systemctl list-units',
    ),
    el('div', { class: 'panel__actions' },
      el('button', { class: 'panel__btn panel__btn--primary', id: 'svc-add' }, '+ 新建'),
      el('button', { class: 'panel__btn', id: 'svc-refresh', onClick: loadServices, html: icon('refresh') }),
    ),
  );

  // ── System services section ──
  const body = el('div', { class: 'panel__body', id: 'svc-body' },
    el('div', { id: 'svc-system-grid' }),
    el('div', { style: 'margin-top:12px;border-top:1px solid var(--card-inner-border);padding-top:12px;',
      id: 'svc-custom-section' },
      el('div', { style: 'font-size:11px;color:var(--t-muted);margin-bottom:6px;' }, '自定义服务'),
      el('div', { class: 'svc-grid', id: 'svc-custom-grid' }),
    ),
  );

  container.appendChild(el('div', { class: 'panel' }, header, body));

  // Wire up add button
  $('#svc-add')?.addEventListener('click', () => openSvcEdit(null));

  loadServices();
  _refreshTimer = setInterval(loadServices, 10000);
}

// ═══════════════════════════════════════════════════════════
//  System services (real API)
// ═══════════════════════════════════════════════════════════

async function loadServices() {
  // Load system services from API
  try {
    const data = await get('/api/services');
    renderSystemServices(data.services || []);
  } catch (e) {
    notify.error(`加载服务失败: ${e.message}`);
  }
  // Also render custom services
  renderCustomServices();
}

function renderSystemServices(services) {
  const grid = $('#svc-system-grid');
  if (!grid) return;
  if (!services.length) { grid.innerHTML = '<div class="empty-state">无系统服务</div>'; return; }
  grid.innerHTML = '<div class="svc-grid">' + services.map(s => _svcCardHTML(s)).join('') + '</div>';

  // Wire up action buttons
  grid.querySelectorAll('.svc-act-start, .svc-act-stop, .svc-act-restart').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.svcName;
      const action = btn.classList.contains('svc-act-start') ? 'start'
        : btn.classList.contains('svc-act-stop') ? 'stop' : 'restart';
      const labels = { start: '启动', stop: '停止', restart: '重启' };
      const ok = await confirm(`确定${labels[action]}服务 ${name}？`, '服务操作', 'info');
      if (!ok) return;
      try {
        await post(`/api/services/${name}/${action}`);
        notify.success(`${name}: ${labels[action]}成功`);
        loadServices();
      } catch (e) {
        notify.error(`${name} ${labels[action]}失败: ${e.message}`);
      }
    });
  });
}

function _svcCardHTML(svc) {
  const status = svc.status || 'unknown';
  const label = STATUS_LABELS[status] || status;
  const dotClass = status === 'active' ? 'svc-mgmt-card__dot--active'
    : status === 'failed' ? 'svc-mgmt-card__dot--failed' : 'svc-mgmt-card__dot--inactive';
  const canStart = status !== 'active';
  const canStop = status === 'active';
  const s = escapeHtml;

  return `<div class="svc-mgmt-card">
    <span class="svc-mgmt-card__icon">${icon('server')}</span>
    <span class="svc-mgmt-card__dot ${dotClass}"></span>
    <span class="svc-mgmt-card__body">
      <div class="svc-mgmt-card__name">${s(svc.name)}</div>
      <div class="svc-mgmt-card__desc">systemctl · ${label}</div>
    </span>
    <span class="svc-mgmt-card__actions">
      ${canStart ? `<button class="panel__btn panel__btn--sm svc-act-start" data-svc-name="${s(svc.name)}">▶</button>` : ''}
      ${canStop ? `<button class="panel__btn panel__btn--danger panel__btn--sm svc-act-stop" data-svc-name="${s(svc.name)}">■</button>` : ''}
      <button class="panel__btn panel__btn--sm svc-act-restart" data-svc-name="${s(svc.name)}">↻</button>
    </span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  Custom services (localStorage CRUD — dame feature)
// ═══════════════════════════════════════════════════════════

const LS_KEY = 'ling-svc-tab';

function loadCustom() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function saveCustom(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

function renderCustomServices() {
  const grid = $('#svc-custom-grid');
  const section = $('#svc-custom-section');
  if (!grid || !section) return;
  const services = loadCustom();
  section.style.display = services.length ? '' : 'none';
  grid.innerHTML = services.length
    ? '<div class="svc-grid">' + services.map(s => {
        const dotClass = 'svc-mgmt-card__dot--inactive';
        const sid = escapeHtml(s.id);
        return `<div class="svc-mgmt-card" data-svc-id="${sid}">
          <span class="svc-mgmt-card__icon">${icon('box')}</span>
          <span class="svc-mgmt-card__dot ${dotClass}"></span>
          <span class="svc-mgmt-card__body">
            <div class="svc-mgmt-card__name">${escapeHtml(s.name)}</div>
            <div class="svc-mgmt-card__desc">${escapeHtml(s.desc || '')}</div>
          </span>
          <span class="svc-mgmt-card__actions">
            <button class="panel__btn panel__btn--sm svc-act-edit" data-svc-edit="${sid}">✎</button>
            <button class="panel__btn panel__btn--sm svc-act-delete" data-svc-del="${sid}" style="color:var(--red)">✕</button>
          </span>
        </div>`;
      }).join('') + '</div>'
    : '';

  // Wire up edit/delete
  grid.querySelectorAll('[data-svc-edit]').forEach(b => {
    b.addEventListener('click', () => {
      const svc = loadCustom().find(s => s.id === b.dataset.svcEdit);
      if (svc) openSvcEdit(svc);
    });
  });
  grid.querySelectorAll('[data-svc-del]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.svcDel;
      const svc = loadCustom().find(s => s.id === id);
      const ok = await confirm(`确定删除服务 ${svc?.name || ''}？`, '删除服务');
      if (!ok) return;
      saveCustom(loadCustom().filter(s => s.id !== id));
      renderCustomServices();
      notify.info(`${svc?.name || ''} 已删除`);
    });
  });
}

function openSvcEdit(svc) {
  const nameInp = document.getElementById('svc-name');
  const urlInp = document.getElementById('svc-url');
  const descInp = document.getElementById('svc-desc');
  const editIdInp = document.getElementById('svc-edit-id');
  const title = document.getElementById('service-modal-title');
  const submit = document.getElementById('modal-submit');
  const urlField = urlInp?.closest('.modal-field');

  [nameInp, descInp].forEach(el => { if (el) el.classList.remove('error'); });
  if (urlField) urlField.style.display = 'none';

  if (svc) {
    if (nameInp) nameInp.value = svc.name;
    if (urlInp) urlInp.value = '';
    if (descInp) descInp.value = svc.desc || '';
    if (editIdInp) editIdInp.value = svc.id;
    if (title) title.innerHTML = '<span class="prompt">$</span> vim systemctl unit';
    if (submit) submit.textContent = '保存修改';
  } else {
    if (nameInp) nameInp.value = '';
    if (urlInp) urlInp.value = '';
    if (descInp) descInp.value = '';
    if (editIdInp) editIdInp.value = '';
    if (title) title.innerHTML = '<span class="prompt">$</span> systemctl add-unit';
    if (submit) submit.textContent = '添加服务';
  }

  // Bind submit handler — reads values directly from DOM (no param passing)
  window._svcTabSubmit = () => {
    const n = document.getElementById('svc-name')?.value?.trim();
    const d = document.getElementById('svc-desc')?.value?.trim();
    const eid = document.getElementById('svc-edit-id')?.value;
    if (!n) {
      document.getElementById('svc-name')?.classList.add('error');
      return;
    }
    const services = loadCustom();
    if (eid) {
      const s = services.find(x => String(x.id) === String(eid));
      if (s) { s.name = n; s.desc = d || n; }
    } else {
      services.push({ id: 'svc_' + Date.now(), name: n, desc: d || n, icon: 'box' });
    }
    saveCustom(services);
    renderCustomServices();
    window._svcTabSubmit = null;
    notify.info(n + (eid ? ' 已更新' : ' 已添加'));

    const bd = document.getElementById('service-modal');
    if (bd) { bd.classList.add('closing'); bd.setAttribute('aria-hidden', 'true');
      setTimeout(() => bd.classList.remove('open', 'closing'), 200); }
  };

  // Open the shared service modal
  const backdrop = document.getElementById('service-modal');
  if (backdrop) {
    backdrop.classList.remove('closing');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('svc-name')?.focus(), 100);
  }
}


// ═══════════════════════════════════════════════════════════
//  Cleanup
// ═══════════════════════════════════════════════════════════

export function cleanup() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}
