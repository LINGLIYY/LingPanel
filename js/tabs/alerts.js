/**
 * LingServer Dashboard — Alerts Tab
 *
 * Rule CRUD, alert history with pagination, acknowledge,
 * browser notification permission.
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, post, put, del as apiDel } from '../api.js';
import { notify } from '../utils/notify.js';
import { on, off } from '../state.js';
import { icon } from '../utils/icons.js';
import { dateShort } from '../utils/format.js';

const METRIC_LABELS = {
  cpu_percent: 'CPU 使用率',
  mem_percent: '内存使用率',
  disk_percent: '磁盘使用率',
};

const STATE_LABELS = {
  fired: icon('bell') + ' 触发',
  recovered: icon('check') + ' 已恢复',
  acknowledged: icon('eye') + ' 已确认',
};

let _historyPage = 1;
let _onAlert = null;

/**
 * Render the alerts tab.
 */
export async function renderAlerts(container) {
  clear(container);

  // ── Notification permission ──
  const notifBar = el('div', { id: 'notif-perm-bar', style: 'margin-bottom:8px;' });
  if (window.Notification && Notification.permission === 'default') {
    notifBar.appendChild(el('button', {
      class: 'btn btn-secondary btn-sm',
      onClick: () => Notification.requestPermission().then(p => {
        notify.info(p === 'granted' ? '通知已开启' : '通知被拒绝');
        renderNotifBar();
      }),
    }, icon('bell') + ' 开启浏览器通知'));
  } else if (window.Notification && Notification.permission === 'granted') {
    notifBar.appendChild(el('span', { style: 'font-size:12px;color:var(--green);' }, icon('bell') + ' 浏览器通知已开启'));
  }
  container.appendChild(notifBar);

  // ── Two-panel layout ──
  const row = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;' });
  container.appendChild(row);

  // Left: Rules
  const rulesPanel = el('div', { class: 'panel', id: 'alerts-rules-panel' });
  rulesPanel.innerHTML = '<div class="panel__header"><h3 class="panel__title">告警规则</h3></div><div class="panel__body" id="rules-body"></div>';
  row.appendChild(rulesPanel);

  // Right: History
  const histPanel = el('div', { class: 'panel', id: 'alerts-hist-panel' });
  histPanel.innerHTML = '<div class="panel__header"><h3 class="panel__title">告警历史</h3></div><div class="panel__body" id="hist-body"></div>';
  row.appendChild(histPanel);

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
    bar.innerHTML = '<span style="font-size:12px;color:var(--green);">' + icon('check') + ' 浏览器通知已开启</span>';
  }
}

// ═══════════════════════════════════════════════════════════
//  Rules
// ═══════════════════════════════════════════════════════════

async function loadRules() {
  const body = $('#rules-body');
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

  // Add button
  body.appendChild(el('button', { class: 'btn btn-sm btn-primary', style: 'margin-bottom:8px;', onClick: showRuleForm }, '+ 新建规则'));

  if (!rules.length) {
    body.appendChild(el('div', { class: 'status-msg' }, '暂无规则'));
    return;
  }

  for (const r of rules) {
    const enabled = r.enabled;
    const active = r.active;
    const statusColor = active ? 'var(--red)' : enabled ? 'var(--green)' : 'var(--color-text-dim)';

    const row = el('div', {
      style: `padding:8px;margin-bottom:4px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:4px;font-size:12px;border-left:3px solid ${statusColor};`,
    },
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
        el('strong', { style: 'color:var(--color-text-heading);' }, r.name),
        el('span', {},
          el('span', { style: `font-size:11px;color:${statusColor};margin-right:8px;` }, active ? '● 触发中' : enabled ? '● 启用' : '○ 禁用'),
          el('button', { class: 'btn btn-ghost btn-sm', style: 'height:22px;font-size:11px;', onClick: () => toggleRule(r) }, enabled ? '禁用' : '启用'),
          el('button', { class: 'btn btn-ghost btn-sm', style: 'height:22px;font-size:11px;', onClick: () => showRuleForm(r) }, '编辑'),
          el('button', { class: 'btn btn-ghost btn-sm', style: 'height:22px;font-size:11px;color:var(--red);', onClick: () => deleteRule(r) }, '删除'),
        ),
      ),
      el('div', { style: 'color:var(--color-text-muted);margin-top:4px;' },
        `${METRIC_LABELS[r.metric] || r.metric} ${r.condition} ${r.threshold}% · 持续 ${r.duration_seconds}s · ${r.action_type}`,
      ),
    );
    body.appendChild(row);
  }
}

async function toggleRule(rule) {
  try {
    await put('/api/alerts/rules/' + rule.id, { enabled: !rule.enabled });
    notify.success(`规则已${rule.enabled ? '禁用' : '启用'}`);
    loadRules();
  } catch (e) {
    notify.error('操作失败');
  }
}

async function deleteRule(rule) {
  if (!confirm(`确定删除规则 "${rule.name}"?`)) return;
  try {
    await apiDel('/api/alerts/rules/' + rule.id);
    notify.success('已删除');
    loadRules();
  } catch (e) {
    notify.error(`删除失败: ${e.message}`);
  }
}

async function showRuleForm(rule = null) {
  const isEdit = !!rule;
  const title = isEdit ? '编辑规则' : '新建规则';

  const form = el('div', {},
    el('div', { class: 'login__field' },
      el('label', {}, '名称'),
      el('input', { class: 'input', id: 'rule-name', value: rule?.name || '', style: 'width:100%;box-sizing:border-box;' }),
    ),
    el('div', { class: 'login__field' },
      el('label', {}, '指标'),
      el('select', { class: 'input', id: 'rule-metric', style: 'width:100%;' },
        el('option', { value: 'cpu_percent', selected: rule?.metric === 'cpu_percent' || !rule }, 'CPU 使用率'),
        el('option', { value: 'mem_percent', selected: rule?.metric === 'mem_percent' }, '内存使用率'),
        el('option', { value: 'disk_percent', selected: rule?.metric === 'disk_percent' }, '磁盘使用率'),
      ),
    ),
    el('div', { style: 'display:flex;gap:8px;' },
      el('div', { class: 'login__field', style: 'flex:1;' },
        el('label', {}, '条件'),
        el('select', { class: 'input', id: 'rule-cond', style: 'width:100%;' },
          el('option', { value: '>', selected: rule?.condition === '>' || !rule }, '> (大于)'),
          el('option', { value: '<', selected: rule?.condition === '<' }, '< (小于)'),
          el('option', { value: '>=', selected: rule?.condition === '>=' }, '>= (大于等于)'),
          el('option', { value: '<=', selected: rule?.condition === '<=' }, '<= (小于等于)'),
        ),
      ),
      el('div', { class: 'login__field', style: 'flex:1;' },
        el('label', {}, '阈值 (%)'),
        el('input', { class: 'input', id: 'rule-threshold', type: 'number', value: rule?.threshold || 90, style: 'width:100%;box-sizing:border-box;' }),
      ),
    ),
    el('div', { class: 'login__field' },
      el('label', {}, '持续时间 (秒)'),
      el('input', { class: 'input', id: 'rule-duration', type: 'number', value: rule?.duration_seconds || 30, style: 'width:100%;box-sizing:border-box;' }),
    ),
    el('div', { class: 'login__field' },
      el('label', {}, '通知方式'),
      el('select', { class: 'input', id: 'rule-action', style: 'width:100%;' },
        el('option', { value: 'browser', selected: rule?.action_type === 'browser' || !rule }, '浏览器通知'),
        el('option', { value: 'webhook', selected: rule?.action_type === 'webhook' }, 'Webhook'),
      ),
    ),
    el('div', { class: 'login__field', id: 'webhook-field', style: rule?.action_type === 'webhook' ? '' : 'display:none;' },
      el('label', {}, 'Webhook URL'),
      el('input', { class: 'input', id: 'rule-webhook', value: rule?.action_config || '', placeholder: 'https://...', style: 'width:100%;box-sizing:border-box;' }),
    ),
  );

  // Show/hide webhook field
  setTimeout(() => {
    $('#rule-action')?.addEventListener('change', (e) => {
      const wf = $('#webhook-field');
      if (wf) wf.style.display = e.target.value === 'webhook' ? '' : 'none';
    });
  }, 50);

  const { Modal } = await import('../ui.js');
  const m = Modal({
    title,
    body: form,
    footer: el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn btn-secondary btn-sm', onClick: () => m.close() }, '取消'),
      el('button', { class: 'btn btn-primary btn-sm', onClick: () => saveRule(rule, m) }, '保存'),
    ),
  });
}

async function saveRule(rule, modal) {
  const name = $('#rule-name')?.value?.trim();
  const metric = $('#rule-metric')?.value;
  const condition = $('#rule-cond')?.value;
  const threshold = parseFloat($('#rule-threshold')?.value);
  const duration = parseInt($('#rule-duration')?.value);
  const actionType = $('#rule-action')?.value;
  const actionConfig = actionType === 'webhook' ? ($('#rule-webhook')?.value || '') : '';

  if (!name) { notify.error('请输入规则名称'); return; }

  const body = { name, metric, condition, threshold, duration_seconds: duration, action_type: actionType, action_config: actionConfig };

  try {
    if (rule) {
      await put('/api/alerts/rules/' + rule.id, body);
      notify.success('规则已更新');
    } else {
      await post('/api/alerts/rules', body);
      notify.success('规则已创建');
    }
    modal.close();
    loadRules();
  } catch (e) {
    notify.error(`保存失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  History
// ═══════════════════════════════════════════════════════════

async function loadHistory(page = 1) {
  _historyPage = page;
  const body = $('#hist-body');
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
    body.appendChild(el('div', { class: 'status-msg' }, '暂无告警记录'));
    return;
  }

  for (const h of data.items) {
    const stateStyle = h.state === 'fired' ? 'color:var(--red);' :
                       h.state === 'recovered' ? 'color:var(--green);' : 'color:var(--color-text-muted);';

    body.appendChild(el('div', {
      style: 'padding:8px;margin-bottom:4px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:4px;font-size:12px;',
    },
      el('div', { style: 'display:flex;justify-content:space-between;' },
        el('strong', {}, h.rule_name),
        el('span', { style: stateStyle }, STATE_LABELS[h.state] || h.state),
      ),
      el('div', { style: 'color:var(--color-text-muted);margin-top:4px;' }, h.message || ''),
      el('div', { style: 'color:var(--color-text-dim);font-size:11px;margin-top:2px;' },
        `${dateShort(h.triggered_at)}` +
        (h.recovered_at ? ` · 恢复: ${dateShort(h.recovered_at)}` : '') +
        (h.state === 'fired'
          ? el('button', { class: 'btn btn-ghost btn-sm', style: 'height:20px;font-size:10px;margin-left:8px;',
              onClick: async () => {
                try { await post(`/api/alerts/${h.id}/acknowledge`); loadHistory(_historyPage); }
                catch (e) { /* ignore */ }
              },
            }, '确认')
          : null),
      ),
    ));
  }

  // Pagination
  if (data.pages > 1) {
    body.appendChild(el('div', { style: 'display:flex;gap:8px;justify-content:center;margin-top:8px;' },
      el('button', { class: 'btn btn-ghost btn-sm', disabled: data.page <= 1, onClick: () => loadHistory(data.page - 1) }, '◀'),
      el('span', { style: 'font-size:12px;color:var(--color-text-muted);padding:4px;' }, `${data.page} / ${data.pages}`),
      el('button', { class: 'btn btn-ghost btn-sm', disabled: data.page >= data.pages, onClick: () => loadHistory(data.page + 1) }, '▶'),
    ));
  }
}

// Cleanup on tab switch — remove WS alert listener
export function cleanup() {
  if (_onAlert) {
    off('alert', _onAlert);
    _onAlert = null;
  }
}
