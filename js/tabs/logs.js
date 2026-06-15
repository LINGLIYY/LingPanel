/**
 * LingServer Dashboard — Logs Tab
 *
 * Log source selector, level filter, regex search, line display
 * with highlighting, pagination, and export.
 */
import { el, clear, $, setText } from '../utils/dom.js';
import { get } from '../api.js';
import { notify } from '../utils/notify.js';
import { icon } from '../utils/icons.js';

const PAGE_SIZE = 500;
let _currentSource = null;
let _currentOffset = 0;
let _allSources = [];

/**
 * Render the logs tab.
 */
export async function renderLogs(container) {
  clear(container);

  // ── Toolbar ──
  const toolbar = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap;' },
    // Source selector
    el('select', { id: 'log-source-select', class: 'input', style: 'height:32px;min-width:160px;', onChange: loadLogs },
      el('option', { value: '' }, '-- 选择日志源 --'),
    ),
    // Level filter
    el('select', { id: 'log-level-select', class: 'input', style: 'height:32px;width:100px;', onChange: loadLogs },
      el('option', { value: '' }, '全部级别'),
      el('option', { value: 'error' }, 'ERROR+'),
      el('option', { value: 'warning' }, 'WARN+'),
      el('option', { value: 'info' }, 'INFO+'),
      el('option', { value: 'debug' }, 'DEBUG+'),
    ),
    // Search
    el('input', { id: 'log-search', class: 'input', placeholder: '正则搜索...', style: 'height:32px;width:180px;',
      onKeydown: (e) => { if (e.key === 'Enter') loadLogs(); },
    }),
    el('button', { class: 'btn btn-secondary btn-sm', onClick: loadLogs, html: icon('search') + ' 搜索' }),
    el('button', { class: 'btn btn-ghost btn-sm', onClick: exportLog }, '⬇ 导出'),
    // Pagination
    el('div', { style: 'flex:1;' }),
    el('span', { id: 'log-page-info', style: 'font-size:12px;color:var(--color-text-muted);' }, ''),
    el('button', { class: 'btn btn-ghost btn-sm', id: 'btn-log-prev', onClick: () => { _currentOffset = Math.max(0, _currentOffset - PAGE_SIZE); loadLogs(); } }, '◀ 上页'),
    el('button', { class: 'btn btn-ghost btn-sm', id: 'btn-log-next', onClick: () => { _currentOffset += PAGE_SIZE; loadLogs(); } }, '下页 ▶'),
  );
  container.appendChild(toolbar);

  // ── Content ──
  const content = el('div', { id: 'log-content', style: 'background:var(--abyss-950);border:1px solid var(--color-border);border-radius:4px;padding:8px;font-family:var(--font-mono);font-size:12px;line-height:1.6;max-height:calc(100vh - 180px);overflow:auto;white-space:pre-wrap;word-break:break-all;' });
  container.appendChild(content);

  // Load sources
  await loadSources();
}

// ═══════════════════════════════════════════════════════════
//  Load sources
// ═══════════════════════════════════════════════════════════

async function loadSources() {
  try {
    const data = await get('/api/logs/sources');
    _allSources = data.sources || [];

    const select = $('#log-source-select');
    if (select) {
      // Keep first option (placeholder)
      select.innerHTML = '<option value="">-- 选择日志源 --</option>';
      for (const src of _allSources) {
        const opt = el('option', { value: src.id },
          `${src.available ? icon('file') : icon('x')} ${src.label} (${src.size_human || '--'})`,
        );
        if (!src.available) opt.disabled = true;
        select.appendChild(opt);
      }
    }
  } catch (e) {
    notify.error(`加载日志源失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Load logs
// ═══════════════════════════════════════════════════════════

async function loadLogs() {
  const sourceId = $('#log-source-select')?.value;
  if (!sourceId) {
    $('#log-content').innerHTML = '<div class="status-msg">请选择日志源</div>';
    return;
  }

  const level = $('#log-level-select')?.value || null;
  const regex = $('#log-search')?.value || null;

  _currentSource = sourceId;

  const params = new URLSearchParams();
  params.set('source_id', sourceId);
  params.set('lines', String(PAGE_SIZE));
  params.set('offset', String(_currentOffset));
  if (level) params.set('filter_level', level);
  if (regex) params.set('filter_regex', regex);

  $('#log-content').innerHTML = '<div class="status-msg">加载中...</div>';

  try {
    const data = await get(`/api/logs/read?${params.toString()}`);
    renderLines(data);
  } catch (e) {
    $('#log-content').innerHTML = `<div class="status-msg" style="color:var(--red);">加载失败: ${e.message}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
//  Render lines
// ═══════════════════════════════════════════════════════════

function renderLines(data) {
  const content = $('#log-content');
  if (!content) return;

  const searchTerm = $('#log-search')?.value || '';

  if (!data.lines || data.lines.length === 0) {
    content.innerHTML = '<div class="status-msg">没有匹配的日志行</div>';
    updatePageInfo(0, 0, 0);
    return;
  }

  const fragments = data.lines.map((line, i) => {
    const lineNum = data.offset + i + 1;
    const escaped = escapeHtml(line);
    let html = `<span style="color:var(--color-text-dim);user-select:none;margin-right:8px;">${String(lineNum).padStart(5)}</span>`;

    // Color by level
    let colorClass = '';
    if (/\b(error|fail|fatal|crit|emerg)\b/i.test(line)) {
      colorClass = 'color:var(--red);';
    } else if (/\b(warn|warning)\b/i.test(line)) {
      colorClass = 'color:var(--yellow);';
    } else if (/\b(info|notice)\b/i.test(line)) {
      colorClass = 'color:var(--color-text-body);';
    }

    // Highlight search term (escape regex special chars)
    let displayText = escaped;
    if (searchTerm) {
      try {
        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(${escapedTerm})`, 'gi');
        displayText = escaped.replace(re, '<mark style="background:var(--yellow);color:#000;padding:0 2px;border-radius:2px;">$1</mark>');
      } catch (e) { /* fallback: show unhighlighted */ }
    }

    html += `<span style="${colorClass}">${displayText}</span>`;
    return `<div style="min-height:1.4em;">${html}</div>`;
  });

  content.innerHTML = fragments.join('');

  updatePageInfo(data.total, data.offset, data.limit);

  // Pagination buttons
  const btnPrev = $('#btn-log-prev');
  const btnNext = $('#btn-log-next');
  if (btnPrev) btnPrev.disabled = data.offset === 0;
  if (btnNext) btnNext.disabled = !data.has_more;
}

function updatePageInfo(total, offset, limit) {
  const el = $('#log-page-info');
  if (!el) return;
  const start = total > 0 ? offset + 1 : 0;
  const end = Math.min(offset + limit, total);
  setText(el, `${start}-${end} / ${total} 行`);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════

async function exportLog() {
  const sourceId = $('#log-source-select')?.value;
  if (!sourceId) {
    notify.warn('请先选择日志源');
    return;
  }

  const regex = $('#log-search')?.value || '';
  const params = new URLSearchParams();
  params.set('source_id', sourceId);
  if (regex) params.set('filter_regex', regex);

  // Download via direct link
  const url = `/api/logs/export?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sourceId}.log`;
  a.click();

  notify.success(`导出中: ${sourceId}.log`);
}
