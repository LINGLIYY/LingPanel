/**
 * LingServer Dashboard — Settings Tab
 *
 * Sidebar-navigated settings: General, Account, Alerts, Audit, Backgrounds, About.
 *
 * Data flow:
 *   load  → GET /api/settings         (all key-value config)
 *           GET /api/settings/stats   (audit record counts)
 *           GET /api/system/backgrounds (available wallpapers)
 *           GET /api/alerts/rules     (existing alert rules)
 *   save  → PUT /api/settings         (batch update config)
 *           POST /api/auth/change-password
 *           PUT /api/alerts/rules/{id}
 *           DELETE /api/alerts/rules/{id}
 */
import { el, clear, $, escapeHtml } from '../utils/dom.js';
import { comm } from '../comm.js';
const { get, post, put, del: apiDel } = comm.rest;
import { notify } from '../utils/notify.js';
import { icon } from '../utils/icons.js';
import { confirm } from '../utils/confirm.js';

// ── Section registry ──
const SECTIONS = [
  { id: 'general',     label: '通用',     icon: 'settings'  },
  { id: 'account',     label: '账户安全', icon: 'lock'      },
  { id: 'alerts',      label: '告警规则', icon: 'bell'      },
  { id: 'audit',       label: '审计数据', icon: 'clipboard' },
  { id: 'backgrounds', label: '登录背景', icon: 'image'     },
  { id: 'about',       label: '关于',     icon: 'info'      },
];

let _dirty = false;
let _alertRules = [];

// ═══════════════════════════════════════════════════════════
//  Main render — pure DOM, no async data
// ═══════════════════════════════════════════════════════════

export async function renderSettings(container) {
  clear(container);

  // ── Sidebar ──
  const sidebar = el('nav', { class: 'settings-sidebar', id: 'settings-sidebar' });
  sidebar.appendChild(el('div', { class: 'settings-sidebar__brand' },
    el('span', { html: icon('settings'), style: 'width:18px;height:18px;display:inline-flex;align-items:center;' }),
    ' 设置',
  ));

  const nav = el('div', { class: 'settings-sidebar__nav' });
  SECTIONS.forEach((s, i) => {
    if (i === 4) nav.appendChild(el('div', { class: 'settings-sidebar__group' }, '外观'));
    nav.appendChild(el('button', {
      class: 'settings-sidebar__item' + (s.id === 'general' ? ' active' : ''),
      'data-section': s.id,
      onClick: () => switchSection(s.id),
    }, el('span', { class: 'settings-sidebar__item-icon', html: icon(s.icon) }), s.label));
  });
  sidebar.appendChild(nav);
  container.appendChild(sidebar);

  // ── Main Content ──
  const main = el('div', { class: 'settings-main', id: 'settings-main' });
  main.appendChild(el('div', { class: 'settings-main__header' },
    el('h2', { class: 'settings-main__title', id: 'settings-title' }, '通用设置'),
    el('button', {
      class: 'panel__btn panel__btn--primary',
      id: 'settings-save-btn',
      disabled: 'true',
      onClick: saveAll,
    }, '保存全部'),
  ));

  SECTIONS.forEach(s => {
    main.appendChild(el('div', {
      class: 'settings-section' + (s.id === 'general' ? ' visible' : ''),
      id: 'sec-' + s.id,
    }));
  });
  container.appendChild(main);

  // ── Build all sections (empty shells, data loaded after) ──
  buildGeneral();
  buildAccount();
  buildAlerts();
  buildAudit();
  buildBackgrounds();
  buildAbout();

  // ── Load all data sequentially (settings first, then dependents) ──
  loadAllData();
}

// ═══════════════════════════════════════════════════════════
//  Build functions — pure DOM creation (no async)
// ═══════════════════════════════════════════════════════════

function buildGeneral() {
  const sec = $('#sec-general'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' }, '调整面板的全局行为和采集参数。'));

  const rows = [
    { l: '指标刷新间隔',  h: '系统指标采集频率（1–60 秒）。',    id: 'cfg-refresh_interval', v: '1',  min: 1,  max: 60,  suffix: '秒'   },
    { l: '指标保留天数',  h: 'metrics_history 保留时长。超期自动清理。', id: 'cfg-retention_days', v: '7',  min: 1,  max: 90,  suffix: '天'   },
    { l: '终端闲置超时',  h: '终端无活动超时后自动断开。',         id: 'cfg-terminal_timeout', v: '30', min: 5,  max: 120, suffix: '分钟' },
  ];
  rows.forEach(r => {
    sec.appendChild(settingRow(r.l, r.h, () =>
      el('input', { class: 'settings-input settings-input--sm', id: r.id, type: 'number', value: r.v, min: r.min, max: r.max, oninput: markDirty })
    , r.suffix));
  });

  // Debug panel toggle
  sec.appendChild(settingRow('调试面板', '显示背景图层控制条。', () => {
    const label = el('label', { class: 'toggle' });
    label.appendChild(el('input', { type: 'checkbox', id: 'cfg-debug_panel', checked: 'true', onchange: markDirty }));
    label.appendChild(el('span', { class: 'toggle__slider' }));
    return label;
  }));
}

function buildAccount() {
  const sec = $('#sec-account'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' },
    '修改管理员密码。当前用户：',
    el('span', { style: 'color:var(--neon);font-family:var(--font-mono);' }, 'admin')));

  sec.appendChild(settingRow('当前密码', '验证身份。', () =>
    el('input', { class: 'settings-input', type: 'password', id: 'old-pw', placeholder: '当前密码', autocomplete: 'current-password' })));
  sec.appendChild(settingRow('新密码', '长度 ≥ 8 位。', () =>
    el('input', { class: 'settings-input', type: 'password', id: 'new-pw', placeholder: '新密码 (≥8位)', autocomplete: 'new-password' })));

  sec.appendChild(el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row__info' }),
    el('div', { class: 'settings-row__control' },
      el('button', { class: 'panel__btn panel__btn--primary', onClick: changePassword }, '更新密码'))));
}

function buildAlerts() {
  const sec = $('#sec-alerts'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' }, '全局默认告警参数。已有规则列表见下方。'));

  const fields = [
    { l: '默认 CPU 阈值',   h: '新建 CPU 规则的默认百分比。',   id: 'cfg-alert_cpu',      v: '90',  min: 0, max: 100,  suffix: '%'   },
    { l: '默认内存阈值',   h: '新建内存规则的默认百分比。',      id: 'cfg-alert_mem',      v: '95',  min: 0, max: 100,  suffix: '%'   },
    { l: '默认磁盘阈值',   h: '新建磁盘规则的默认百分比。',      id: 'cfg-alert_disk',     v: '85',  min: 0, max: 100,  suffix: '%'   },
    { l: '默认持续时间',   h: '超过阈值后持续多久才触发。',      id: 'cfg-alert_duration', v: '300', min: 10, max: 3600, suffix: '秒' },
  ];
  fields.forEach(f => {
    sec.appendChild(settingRow(f.l, f.h, () =>
      el('input', { class: 'settings-input settings-input--sm', id: f.id, type: 'number', value: f.v, min: f.min, max: f.max, oninput: markDirty })
    , f.suffix));
  });

  sec.appendChild(settingRow('通知方式', '告警触发后发送渠道。', () =>
    el('select', { class: 'settings-select', id: 'cfg-alert_action', onchange: markDirty },
      el('option', { value: 'browser' }, '浏览器弹窗'),
      el('option', { value: 'webhook' }, 'Webhook'))));

  sec.appendChild(el('div', { class: 'settings-row__label', style: 'padding-top:12px;margin-bottom:8px;border-top:1px solid oklch(1 0 0 / 0.06);' }, '已有告警规则'));
  sec.appendChild(el('div', { id: 'alert-rules-list' }));
}

function buildAudit() {
  const sec = $('#sec-audit'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' }, '数据库审计日志统计与清理操作。'));
  sec.appendChild(el('div', { class: 'settings-stats-grid', id: 'audit-stats' },
    statCard('终端命令', '—', 'terminal_audit'),
    statCard('登录记录', '—', 'login_audit'),
    statCard('告警历史', '—', 'alert_history'),
    statCard('指标历史', '—', 'metrics_history')));
  sec.appendChild(el('div', { class: 'settings-row', style: 'border-bottom:none;' },
    el('div', { class: 'settings-row__info' }),
    el('div', { class: 'settings-row__control', style: 'gap:8px;' },
      el('button', { class: 'panel__btn', onClick: () => notify.info('功能开发中') }, '导出审计日志'),
      el('button', { class: 'panel__btn', onClick: backupDB }, '备份数据库'))));
}

function buildBackgrounds() {
  const sec = $('#sec-backgrounds'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' },
    '管理登录页壁纸。放图到 ', el('code', {}, 'backgrounds/dark/'), ' / ', el('code', {}, 'backgrounds/light/'), ' 目录。'));
  sec.appendChild(settingRow('深色主题壁纸', '', () =>
    el('select', { class: 'settings-select', id: 'bg-dark-select', onchange: markDirty }, el('option', { value: '' }, '无'))));
  sec.appendChild(settingRow('浅色主题壁纸', '', () =>
    el('select', { class: 'settings-select', id: 'bg-light-select', onchange: markDirty }, el('option', { value: '' }, '无'))));
}

function buildAbout() {
  const sec = $('#sec-about'); if (!sec) return;
  sec.appendChild(el('p', { class: 'settings-section__desc' }, 'LingServer Dashboard — 轻量级单页服务器运维面板。'));
  sec.appendChild(el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row__info' },
      el('div', { class: 'settings-row__label' }, '版本信息'),
      el('div', { class: 'settings-row__hint' },
        el('div', {}, 'Version: 2.0.0 · DB v6 · Settings Table'),
        el('div', {}, 'Python: FastAPI · SQLite (WAL)'),
        el('div', {}, 'Frontend: Vanilla JS ES Modules'),
        el('div', {}, 'OKLCH Dark Theme · Fira Code + Fira Sans'))),
    el('div', { class: 'settings-row__control' },
      el('button', { class: 'panel__btn', onClick: backupDB }, '备份数据库'))));
}

// ═══════════════════════════════════════════════════════════
//  Reusable DOM helpers
// ═══════════════════════════════════════════════════════════

function settingRow(label, hint, controlFn, suffix = '') {
  return el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row__info' },
      el('div', { class: 'settings-row__label' }, label),
      hint ? el('div', { class: 'settings-row__hint' }, hint) : null),
    el('div', { class: 'settings-row__control' },
      controlFn(),
      suffix ? el('span', { class: 'settings-row__suffix' }, suffix) : null));
}

function statCard(label, value, id) {
  return el('div', { class: 'settings-stat', id: 'stat-' + id },
    el('div', { class: 'settings-stat__label' }, label),
    el('div', { class: 'settings-stat__value' }, value));
}

// ── Field registry: single source of truth for setting key ↔ DOM mapping ──
const SETTING_FIELDS = {
  refresh_interval:  { sel: '#cfg-refresh_interval', type: 'number'   },
  retention_days:    { sel: '#cfg-retention_days',   type: 'number'   },
  terminal_timeout:  { sel: '#cfg-terminal_timeout', type: 'number'   },
  debug_panel:       { sel: '#cfg-debug_panel',      type: 'checkbox' },
  alert_cpu:         { sel: '#cfg-alert_cpu',        type: 'number'   },
  alert_mem:         { sel: '#cfg-alert_mem',        type: 'number'   },
  alert_disk:        { sel: '#cfg-alert_disk',       type: 'number'   },
  alert_duration:    { sel: '#cfg-alert_duration',   type: 'number'   },
  alert_action:      { sel: '#cfg-alert_action',     type: 'select'   },
  dark_background:   { sel: '#bg-dark-select',       type: 'select'   },
  light_background:  { sel: '#bg-light-select',      type: 'select'   },
};

function populateField(key, value) {
  const field = SETTING_FIELDS[key];
  if (!field || value === undefined || value === null) return;
  const el = $(field.sel);
  if (!el) return;
  if (field.type === 'checkbox') el.checked = value === 'true' || value === true;
  else el.value = value;
}

function collectField(key) {
  const field = SETTING_FIELDS[key];
  if (!field) return null;
  const el = $(field.sel);
  if (!el) return null;
  return field.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
}

// ═══════════════════════════════════════════════════════════
//  Data loading — parallel settings + backgrounds, then stats + rules
// ═══════════════════════════════════════════════════════════

async function loadAllData() {
  try {
    // 1. Fetch settings and backgrounds in parallel
    const [cfg, bg] = await Promise.all([
      get('/api/settings').catch(() => null),
      get('/api/system/backgrounds').catch(() => null),
    ]);

    // Populate settings fields from registry
    if (cfg) {
      for (const key of Object.keys(SETTING_FIELDS)) {
        populateField(key, cfg[key]);
      }
    }

    // Populate background dropdowns, then select saved values
    if (bg) {
      fillSelect('bg-dark-select', bg.dark || []);
      fillSelect('bg-light-select', bg.light || []);
      if (cfg) {
        populateField('dark_background', cfg.dark_background);
        populateField('light_background', cfg.light_background);
      }
    }

    // 2. Load audit stats + alert rules in parallel
    await Promise.all([
      loadAuditStats(),
      loadAlertRules(),
    ]);
  } catch (e) {
    console.debug('Settings load failed, using defaults:', e);
  }
}

function fillSelect(selId, items) {
  const selectEl = $('#' + selId);
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">无</option>';
  if (!Array.isArray(items)) return;
  items.forEach(f => selectEl.appendChild(el('option', { value: f }, f)));
}

async function loadAuditStats() {
  try {
    const data = await get('/api/settings/stats');
    for (const [table, info] of Object.entries(data)) {
      const card = $('#stat-' + table);
      if (card) {
        const v = card.querySelector('.settings-stat__value');
        if (v) v.textContent = info.count.toLocaleString();
      }
    }
  } catch (_) { /* stats unavailable */ }
}

async function loadAlertRules() {
  try {
    const data = await get('/api/alerts/rules');
    _alertRules = data.rules || [];
    const list = $('#alert-rules-list');
    if (!list) return;
    clear(list);

    if (_alertRules.length === 0) {
      list.innerHTML = '<p style="color:var(--t-muted);font-size:13px;padding:16px 0;">暂无告警规则 — 请在告警 Tab 中创建</p>';
      return;
    }

    _alertRules.forEach(rule => {
      list.appendChild(el('div', { class: 'settings-row' },
        el('div', { class: 'settings-row__info' },
          el('div', { class: 'settings-row__label' }, escapeHtml(rule.name)),
          el('div', { class: 'settings-row__hint' }, `${rule.metric} ${rule.condition} ${rule.threshold} · ${rule.duration_seconds}s`)),
        el('div', { class: 'settings-row__control' },
          el('label', { class: 'toggle', style: 'margin-right:12px;' },
            el('input', { type: 'checkbox', checked: rule.enabled ? 'true' : false, onchange: () => toggleRule(rule.id) }),
            el('span', { class: 'toggle__slider' })),
          el('button', { class: 'panel__btn', style: 'font-size:11px;', onClick: () => deleteRule(rule.id, rule.name) }, '删除'))));
    });
  } catch (_) { /* rules unavailable */ }
}

// ═══════════════════════════════════════════════════════════
//  Alert rule actions
// ═══════════════════════════════════════════════════════════

async function toggleRule(id) {
  const rule = _alertRules.find(r => r.id === id);
  if (!rule) return;
  try {
    await put(`/api/alerts/rules/${id}`, { enabled: !rule.enabled });
    rule.enabled = !rule.enabled;
    notify.success(rule.enabled ? '规则已启用' : '规则已禁用');
  } catch (e) { notify.error('操作失败'); }
}

async function deleteRule(id, name) {
  const ok = await confirm(`确定删除规则 "${name}"？`, '删除告警规则');
  if (!ok) return;
  try {
    await apiDel(`/api/alerts/rules/${id}`);
    _alertRules = _alertRules.filter(r => r.id !== id);
    notify.success('规则已删除');
    loadAlertRules();
  } catch (e) { notify.error('删除失败'); }
}

// ═══════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════

function switchSection(id) {
  document.querySelectorAll('.settings-sidebar__item').forEach(el =>
    el.classList.toggle('active', el.dataset.section === id));
  document.querySelectorAll('.settings-section').forEach(el =>
    el.classList.toggle('visible', el.id === 'sec-' + id));
  const section = SECTIONS.find(s => s.id === id);
  const title = $('#settings-title');
  if (title && section) title.textContent = section.label + '设置';
}

// ═══════════════════════════════════════════════════════════
//  Save
// ═══════════════════════════════════════════════════════════

function markDirty() {
  _dirty = true;
  const btn = $('#settings-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = '保存全部 *'; }
}

async function saveAll() {
  const payload = {};
  for (const key of Object.keys(SETTING_FIELDS)) {
    const val = collectField(key);
    if (val !== null) payload[key] = val;
  }

  try {
    await put('/api/settings', payload);
    _dirty = false;
    const btn = $('#settings-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '保存全部'; }
    notify.success('所有设置已保存');
  } catch (e) {
    notify.error('保存失败: ' + (e.message || '未知错误'));
  }
}

// ═══════════════════════════════════════════════════════════
//  Password change (independent from settings save)
// ═══════════════════════════════════════════════════════════

async function changePassword() {
  const oldPw = $('#old-pw')?.value || '';
  const newPw = $('#new-pw')?.value || '';
  if (!oldPw || !newPw) return notify.error('请填写当前密码和新密码');
  if (newPw.length < 8) return notify.error('新密码长度至少 8 位');

  try {
    await post('/api/auth/change-password', { old_password: oldPw, new_password: newPw });
    notify.success('密码已更新');
    const o = $('#old-pw'); if (o) o.value = '';
    const n = $('#new-pw'); if (n) n.value = '';
  } catch (e) { notify.error(e.message || '密码修改失败'); }
}

async function backupDB() {
  notify.info('数据库备份功能将在后续版本中实现');
}

// ═══════════════════════════════════════════════════════════
//  Cleanup
// ═══════════════════════════════════════════════════════════

export function cleanup() {
  // Settings tab is purely REST-driven — no WS subscriptions to clean up
}
