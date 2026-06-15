/**
 * LingServer Dashboard — Logs Tab (dame graft)
 *
 * Log source selector, level/regex filter, expandable messages.
 * Data: GET /api/logs/sources + GET /api/logs/read
 */
import { el, clear, $ } from '../utils/dom.js';
import { comm } from '../comm.js';
const { get } = comm.rest;
import { notify } from '../utils/notify.js';

let _sources = [];

export async function renderLogs(container) {
  clear(container);

  // Load sources first
  try { _sources = (await get('/api/logs/sources')).sources || []; } catch (_) { _sources = []; }

  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' tail -f /var/log/syslog',
      ),
    ),
    el('div', { class: 'log-toolbar' },
      el('select', { class: 'log-filter', id: 'log-source' },
        ..._sources.map(s => el('option', { value: s.id }, s.label)),
      ),
      el('select', { class: 'log-filter', id: 'log-level' },
        el('option', { value: '' }, '全部级别'),
        el('option', { value: 'error' }, 'ERROR'),
        el('option', { value: 'warning' }, 'WARNING'),
        el('option', { value: 'info' }, 'INFO'),
        el('option', { value: 'debug' }, 'DEBUG'),
      ),
      el('div', { class: 'toolbar-search' },
        el('input', { class: 'toolbar-search__input', id: 'log-search', placeholder: '正则搜索...' }),
      ),
      el('button', { class: 'panel__btn', id: 'log-load', onClick: loadLogs }, '查询'),
    ),
    el('div', { class: 'panel__body', id: 'log-body', style: 'flex:1;overflow:auto;' },
      el('div', { class: 'empty-state' }, '选择日志源并点击查询'),
    ),
  );
  container.appendChild(panel);

  document.getElementById('log-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadLogs();
  });
}

async function loadLogs() {
  const body = $('#log-body');
  if (!body) return;
  const source = $('#log-source')?.value || 'syslog';
  const level = $('#log-level')?.value || '';
  const regex = $('#log-search')?.value || '';

  let url = `/api/logs/read?source_id=${encodeURIComponent(source)}&lines=200`;
  if (level) url += `&filter_level=${level}`;
  if (regex) url += `&filter_regex=${encodeURIComponent(regex)}`;

  try {
    const data = await get(url);
    renderLogLines(data, body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
  }
}

function renderLogLines(data, body) {
  clear(body);
  const lines = data.lines || data.entries || [];

  if (!lines.length) { body.innerHTML = '<div class="empty-state">无匹配日志</div>'; return; }

  body.innerHTML = `<table class="log-table">
    <thead><tr><th>时间</th><th>级别</th><th>来源</th><th>消息</th></tr></thead>
    <tbody>${lines.map(l => `<tr>
      <td style="white-space:nowrap">${_esc(l.timestamp || l.time || '--')}</td>
      <td>${_levelBadge(l.level || 'info')}</td>
      <td>${_esc(l.source || l.host || '--')}</td>
      <td><span class="log-msg">${_esc(l.message || l.msg || '')}</span></td>
    </tr>`).join('')}</tbody></table>`;

  // Click to expand
  body.querySelectorAll('.log-msg').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('expanded'));
  });
}

function _levelBadge(level) {
  const l = (level || '').toLowerCase();
  if (l.includes('error') || l.includes('crit') || l.includes('err')) return '<span class="level-badge level-badge--error">ERROR</span>';
  if (l.includes('warn')) return '<span class="level-badge level-badge--warning">WARN</span>';
  if (l.includes('info')) return '<span class="level-badge level-badge--info">INFO</span>';
  if (l.includes('debug')) return '<span class="level-badge level-badge--debug">DEBUG</span>';
  return `<span class="level-badge">${_esc(level)}</span>`;
}

function _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

export function cleanup() {}
