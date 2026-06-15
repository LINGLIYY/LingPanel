/**
 * LingServer Dashboard — Alerts Tab (dame graft)
 *
 * Rule CRUD with toggle switches, alert history with status badges,
 * glass-modal rule form, browser notification permission.
 *
 * Data: REST /api/alerts/* + WS /ws/live alert events
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, post, put, del as apiDel } from '../api.js';
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';
import { on, off } from '../state.js';
import { icon } from '../utils/icons.js';
import { dateShort } from '../utils/format.js';

const METRIC_LABELS = {
  cpu_percent: 'CPU 使用率',
  mem_percent: '内存使用率',
  disk_percent: '磁盘使用率',
};

let _historyPage = 1;
let _onAlert = null;
let _alertModal = null;  // cached modal DOM

// ═══════════════════════════════════════════════════════════
//  Main render
// ═══════════════════════════════════════════════════════════

export async function renderAlerts(container) {
  clear(container);

  // ── Notification permission bar ──
  const notifBar = el('div', { id: 'notif-perm-bar', style: 'margin-bottom:8px;' });
  if (window.Notification && Notification.permission === 'default') {
    notifBar.appendChild(el('button', {
      class: 'panel__btn panel__btn--sm',
      onClick: () => Notification.requestPermission().then(p => {
        notify.info(p === 'granted' ? '通知已开启' : '通知被拒绝');
        renderNotifBar();
      }),
    }, icon('bell') + ' 开启浏览器通知'));
  } else if (window.Notification && Notification.permission === 'granted') {
    notifBar.innerHTML = `<span style="font-size:12px;color:var(--neon);">${icon('check')} 浏览器通知已开启</span>`;
  }
  container.appendChild(notifBar);

  // ── Rules Panel ──
  const rulesPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' cat /etc/alert-rules',
      ),
      el('div', { class: 'panel__actions' },
        el('button', { class: 'panel__btn panel__btn--primary', id: 'alert-new-rule', onClick: () => showAlertModal(null) },
          '+ 新建规则',
        ),
      ),
    ),
    el('div', { class: 'panel__body', id: 'alert-rules-body' },
      el('div', { class: 'empty-state' }, '暂无告警规则'),
    ),
  );
  container.appendChild(rulesPanel);

  // ── History Panel ──
  const histPanel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' journalctl --alert-history',
      ),
    ),
    el('div', { class: 'panel__body', id: 'alert-history-body' },
      el('div', { class: 'empty-state' }, '暂无告警记录'),
    ),
  );
  container.appendChild(histPanel);

  // Load data
  await loadRules();
  await loadHistory();

  // Listen for real-time alerts via WS
  _onAlert = (data) => {
    if (data.level === 'critical' && window.Notification && Notification.permission === 'granted') {
      new Notification(data.rule_name, { body: data.message });
    }
    notify.warn(data.message);
    loadHistory();
  };
  on('alert', _onAlert);
}

function renderNotifBar() {
  const bar = $('#notif-perm-bar');
  if (!bar) return;
  if (window.Notification && Notification.permission === 'granted') {
    bar.innerHTML = `<span style="font-size:12px;color:var(--neon);">${icon('check')} 浏览器通知已开启</span>`;
  }
}

// ═══════════════════════════════════════════════════════════
//  Rules — table with toggle switches
// ═══════════════════════════════════════════════════════════

async function loadRules() {
  const body = $('#alert-rules-body');
  if (!body) return;
  try {
    const data = await get('/api/alerts/rules');
    renderRulesList(data.rules || [], body);
  } catch (e) {
    body.innerHTML = `<div class="status-msg" style="color:var(--red);">加载失败: ${e.message}</div>`;
  }
}

function renderRulesList(rules, body) {
  clear(body);
  if (!rules.length) {
    body.innerHTML = '<div class="empty-state">暂无告警规则<br><small>点击上方"+ 新建规则"创建</small></div>';
    return;
  }
  body.innerHTML = `<table class="rule-table">
    <thead><tr><th>名称</th><th>指标</th><th>条件</th><th>阈值</th><th>持续(s)</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${rules.map(r => `<tr>
      <td style="font-weight:500">${_esc(r.name)}</td>
      <td>${METRIC_LABELS[r.metric] || r.metric}</td>
      <td>${r.condition}</td>
      <td>${r.threshold}</td>
      <td>${r.duration_seconds || r.duration || 0}s</td>
      <td>
        <label class="toggle-switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${r.enabled ? 'checked' : ''}>
          <span class="toggle-slider" data-rule-id="${r.id}"></span>
        </label>
      </td>
      <td>
        <button class="panel__btn panel__btn--sm" data-edit="${r.id}">编辑</button>
        <button class="panel__btn panel__btn--danger panel__btn--sm" data-delete="${r.id}">删除</button>
      </td>
    </tr>`).join('')}</tbody></table>`;

  // Wire up toggle switches
  body.querySelectorAll('.toggle-slider').forEach(slider => {
    slider.addEventListener('click', async () => {
      const ruleId = parseInt(slider.dataset.ruleId);
      const checkbox = slider.parentElement.querySelector('input');
      // Toggle hasn't happened yet — checkbox.checked is old state
      const newEnabled = !checkbox.checked;
      try {
        await put('/api/alerts/rules/' + ruleId, { enabled: newEnabled });
        notify.success(`规则已${newEnabled ? '启用' : '禁用'}`);
        loadRules();
      } catch (e) {
        notify.error('操作失败');
        loadRules();
      }
    });
  });

  // Wire up edit/delete
  body.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => showAlertModal(parseInt(btn.dataset.edit)));
  });
  body.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteRule(parseInt(btn.dataset.delete)));
  });
}

async function deleteRule(ruleId) {
  const ok = await confirm('确定删除此规则？', '删除告警规则');
  if (!ok) return;
  try {
    await apiDel('/api/alerts/rules/' + ruleId);
    notify.success('已删除');
    loadRules();
  } catch (e) {
    notify.error(`删除失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Rule Modal (glass design, dynamically created)
// ═══════════════════════════════════════════════════════════

function ensureAlertModal() {
  if (_alertModal) return _alertModal;

  const modal = document.createElement('div');
  modal.id = 'alert-modal';
  modal.className = 'alert-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'alert-modal-title');
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-shell"><div class="modal-card">
      <h2>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        <span id="alert-modal-title">新建告警规则</span>
      </h2>
      <div class="form-group"><label>规则名称</label><input id="alert-name" placeholder="例如：CPU 高温"></div>
      <div class="form-row">
        <div class="form-group"><label>监控指标</label><select id="alert-metric"><option value="cpu_percent">cpu_percent</option><option value="mem_percent">mem_percent</option><option value="disk_percent">disk_percent</option></select></div>
        <div class="form-group"><label>条件</label><select id="alert-condition"><option value=">">&gt;</option><option value="<">&lt;</option><option value=">=">&gt;=</option><option value="<=">&lt;=</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>阈值</label><input id="alert-threshold" type="number" placeholder="90"></div>
        <div class="form-group"><label>持续时间(秒)</label><input id="alert-duration" type="number" placeholder="300"></div>
      </div>
      <div class="form-actions">
        <button class="panel__btn" id="alert-cancel">取消</button>
        <button class="panel__btn panel__btn--primary" id="alert-submit">保存</button>
      </div>
    </div></div>`;
  document.body.appendChild(modal);

  // Backdrop click to close
  modal.querySelector('.modal-backdrop').addEventListener('click', () => closeAlertModal());
  modal.querySelector('#alert-cancel').addEventListener('click', () => closeAlertModal());

  _alertModal = modal;
  return modal;
}

function showAlertModal(editId) {
  _installAlertModalListeners();
  const modal = ensureAlertModal();
  let allRules = [];
  // Try to load current rules for editing
  modal._editId = editId || null;
  document.getElementById('alert-modal-title').textContent = editId ? '编辑告警规则' : '新建告警规则';

  if (editId) {
    // Fetch current rule data for pre-filling
    get('/api/alerts/rules').then(data => {
      const r = (data.rules || []).find(r => r.id === editId);
      if (r) {
        document.getElementById('alert-name').value = r.name || '';
        document.getElementById('alert-metric').value = r.metric || 'cpu_percent';
        document.getElementById('alert-condition').value = r.condition || '>';
        document.getElementById('alert-threshold').value = r.threshold || '';
        document.getElementById('alert-duration').value = r.duration_seconds || r.duration || '';
      }
    }).catch(() => {});
  } else {
    document.getElementById('alert-name').value = '';
    document.getElementById('alert-metric').value = 'cpu_percent';
    document.getElementById('alert-condition').value = '>';
    document.getElementById('alert-threshold').value = '';
    document.getElementById('alert-duration').value = '';
  }

  openAlertModal();
}

function openAlertModal() {
  const modal = ensureAlertModal();
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('alert-name')?.focus(), 100);
}

function closeAlertModal() {
  const modal = ensureAlertModal();
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  document.getElementById('alert-new-rule')?.focus();
}

function _onAlertModalClick(e) {
  if (e.target.id !== 'alert-submit') return;
  const modal = document.getElementById('alert-modal');
  if (!modal) return;

  const name = document.getElementById('alert-name').value.trim();
  const metric = document.getElementById('alert-metric').value;
  const condition = document.getElementById('alert-condition').value;
  const threshold = parseFloat(document.getElementById('alert-threshold').value);
  const duration = parseInt(document.getElementById('alert-duration').value);

  let valid = true;
  ['alert-name', 'alert-threshold', 'alert-duration'].forEach(id => {
    const el = document.getElementById(id);
    const val = el.value.trim();
    if (!val || (id.includes('threshold') && isNaN(threshold)) || (id.includes('duration') && isNaN(duration))) {
      el.classList.add('error'); valid = false;
    } else el.classList.remove('error');
  });
  if (!valid) return;

  const body = { name, metric, condition, threshold, duration_seconds: duration, action_type: 'browser', enabled: true };

  const editId = modal._editId;
  (editId ? put('/api/alerts/rules/' + editId, body) : post('/api/alerts/rules', body))
    .then(() => {
      notify.success(editId ? '规则已更新' : '规则已创建');
      closeAlertModal();
      loadRules();
    })
    .catch(err => notify.error(`保存失败: ${err.message}`));
}

function _onAlertModalKeydown(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('alert-modal');
    if (modal && modal.getAttribute('aria-hidden') === 'false') {
      closeAlertModal();
    }
  }
}

let _alertListenersInstalled = false;
function _installAlertModalListeners() {
  if (_alertListenersInstalled) return;
  document.addEventListener('click', _onAlertModalClick);
  document.addEventListener('keydown', _onAlertModalKeydown);
  _alertListenersInstalled = true;
}
function _removeAlertModalListeners() {
  document.removeEventListener('click', _onAlertModalClick);
  document.removeEventListener('keydown', _onAlertModalKeydown);
  _alertListenersInstalled = false;
}

// ═══════════════════════════════════════════════════════════
//  History — table with status badges
// ═══════════════════════════════════════════════════════════

async function loadHistory(page = 1) {
  _historyPage = page;
  const body = $('#alert-history-body');
  if (!body) return;
  try {
    const data = await get(`/api/alerts/history?page=${page}&size=20`);
    renderHistory(data, body);
  } catch (e) {
    body.innerHTML = `<div class="status-msg" style="color:var(--red);">加载失败</div>`;
  }
}

function renderHistory(data, body) {
  clear(body);
  if (!data.items || data.items.length === 0) {
    body.innerHTML = '<div class="empty-state">暂无告警记录</div>';
    return;
  }
  body.innerHTML = `<table class="data-table">
    <thead><tr><th>时间</th><th>规则</th><th>消息</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${data.items.map(h => `<tr>
      <td>${dateShort(h.triggered_at)}</td>
      <td style="font-weight:500">${_esc(h.rule_name)}</td>
      <td>${_esc(h.message || '')}</td>
      <td>${_historyBadge(h.state)}</td>
      <td>${h.state === 'fired'
        ? `<button class="panel__btn panel__btn--sm btn-ack" data-ack="${h.id}">确认</button>`
        : ''}</td>
    </tr>`).join('')}</tbody></table>`;

  // Wire up acknowledge buttons
  body.querySelectorAll('.btn-ack').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await post(`/api/alerts/${btn.dataset.ack}/acknowledge`);
        loadHistory(_historyPage);
      } catch (e) { /* ignore */ }
    });
  });

  // Pagination
  if (data.pages > 1) {
    body.appendChild(el('div', { class: 'panel__footer' },
      el('div', { class: 'pagination' },
        el('button', { class: 'pagination__btn', disabled: data.page <= 1, onClick: () => loadHistory(data.page - 1) }, '◀'),
        el('span', { class: 'pagination__info' }, `${data.page} / ${data.pages}`),
        el('button', { class: 'pagination__btn', disabled: data.page >= data.pages, onClick: () => loadHistory(data.page + 1) }, '▶'),
      ),
    ));
  }
}

function _historyBadge(state) {
  switch (state) {
    case 'fired':        return '<span class="status-badge status-badge--crit">触发中</span>';
    case 'acknowledged': return '<span class="status-badge status-badge--warn">已确认</span>';
    case 'recovered':    return '<span class="status-badge status-badge--ok">已恢复</span>';
    default:             return `<span class="status-badge status-badge--neutral">${state}</span>`;
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ═══════════════════════════════════════════════════════════
//  Cleanup
// ═══════════════════════════════════════════════════════════

export function cleanup() {
  if (_onAlert) {
    off('alert', _onAlert);
    _onAlert = null;
  }
  _removeAlertModalListeners();
}
