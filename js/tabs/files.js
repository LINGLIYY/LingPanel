/**
 * LingServer Dashboard — Files Tab
 *
 * Breadcrumb navigation, file table, text preview, drag-drop upload,
 * delete, and new folder.
 */
import { el, clear, $ } from '../utils/dom.js';
import { DataTable, Modal, EmptyState } from '../ui.js';
import { get, post, del as apiDel } from '../api.js';
import { notify } from '../utils/notify.js';
import { bytes, dateShort } from '../utils/format.js';
import { icon, iconLabel } from '../utils/icons.js';

// Default root: C:\ on Windows, /home on Unix
const _rootPath = navigator.platform?.includes('Win') ? 'C:\\' : '/home';
let _currentPath = _rootPath;

/**
 * Render the files tab.
 */
export async function renderFiles(container) {
  clear(container);

  // Breadcrumb
  const breadcrumb = el('div', { class: 'panel__header', id: 'files-breadcrumb', style: 'padding:0 12px;height:36px;display:flex;align-items:center;gap:4px;font-size:12px;overflow-x:auto;' });
  container.appendChild(breadcrumb);

  // Toolbar
  const toolbar = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;' },
    el('button', { class: 'btn btn-secondary btn-sm', id: 'btn-upload', onClick: triggerUpload, html: iconLabel('upload', '上传')}),
    el('button', { class: 'btn btn-secondary btn-sm', id: 'btn-mkdir', onClick: promptMkdir, html: iconLabel('folder-plus', '新建目录')}),
    el('button', { class: 'btn btn-ghost btn-sm', id: 'btn-refresh', onClick: () => loadDir(_currentPath), html: iconLabel('refresh', '刷新')}),
    el('input', { type: 'file', id: 'file-input', multiple: 'true', style: 'display:none;', onChange: handleUpload }),
  );
  container.appendChild(toolbar);

  // File table container
  const tableWrap = el('div', { id: 'files-table-wrap' });
  container.appendChild(tableWrap);

  // Load root (C:\ on Windows, /home on Unix)
  await loadDir(_currentPath);
}

// ═══════════════════════════════════════════════════════════
//  Load directory
// ═══════════════════════════════════════════════════════════

async function loadDir(path) {
  _currentPath = path;

  try {
    const data = await get(`/api/files?path=${encodeURIComponent(path)}`);
    renderBreadcrumb(data.current_path, data.parent_path);
    renderTable(data.items);
    notify.info(`${data.items.length} 个项目`);
  } catch (e) {
    notify.error(`加载目录失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Breadcrumb
// ═══════════════════════════════════════════════════════════

function renderBreadcrumb(currentPath, parentPath) {
  const bc = $('#files-breadcrumb');
  if (!bc) return;
  clear(bc);

  // Parent directory button (..)
  if (parentPath) {
    bc.appendChild(el('span', {
      class: 'breadcrumb-item',
      style: 'cursor:pointer;color:var(--color-primary);font-weight:600;margin-right:4px;',
      onClick: () => loadDir(parentPath),
      title: parentPath,
    }, '⬆ 上级'));
    bc.appendChild(el('span', { style: 'color:var(--color-text-dim);margin:0 2px;' }, '|'));
  }

  const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  // Root
  bc.appendChild(el('span', { class: 'breadcrumb-item', style: 'cursor:pointer;color:var(--color-primary);', onClick: () => loadDir(_rootPath) }, '/'));

  let accumulated = '';
  for (const part of parts) {
    accumulated += '/' + part;
    bc.appendChild(el('span', { style: 'color:var(--color-text-dim);margin:0 2px;' }, '/'));
    bc.appendChild(el('span', {
      class: 'breadcrumb-item',
      style: 'cursor:pointer;color:var(--color-text-body);',
      onClick: () => loadDir(accumulated),
    }, part));
  }
}

// ═══════════════════════════════════════════════════════════
//  File table
// ═══════════════════════════════════════════════════════════

function renderTable(items) {
  const wrap = $('#files-table-wrap');
  if (!wrap) return;
  clear(wrap);

  if (!items.length) {
    wrap.appendChild(EmptyState({ icon: 'folder', message: '目录为空' }));
    return;
  }

  const table = DataTable({
    columns: ['icon', 'name', 'size_human', 'modified', 'permissions', 'actions'],
    labels: { icon: '', name: '名称', size_human: '大小', modified: '修改时间', permissions: '权限', actions: '' },
    rows: items.map(item => ({
      ...item,
      icon: item.is_dir ? icon('folder') : icon('file'),
    })),
    format: (col, val, row) => {
      if (col === 'icon') return val;
      if (col === 'name') return val;
      if (col === 'size_human') return row.is_dir ? '--' : (val || '--');
      if (col === 'modified') return val ? dateShort(val) : '--';
      if (col === 'permissions') return val || '--';
      if (col === 'actions') return row.is_dir ? '' : icon('eye');
      return val || '';
    },
  });

  // Click handlers
  table.querySelectorAll('tbody tr').forEach((tr, i) => {
    const item = items[i];
    tr.style.cursor = 'pointer';

    tr.addEventListener('click', (e) => {
      // Don't trigger on action buttons
      if (e.target.closest('[data-action]')) return;

      if (item.is_dir) {
        loadDir(item.path);
      } else {
        previewFile(item);
      }
    });
  });

  wrap.appendChild(table);
}

// ═══════════════════════════════════════════════════════════
//  File preview
// ═══════════════════════════════════════════════════════════

async function previewFile(item) {
  try {
    const data = await get(`/api/files/read?path=${encodeURIComponent(item.path)}`);
    if (data.binary) {
      notify.warn('二进制文件无法预览');
      return;
    }
    if (data.too_large) {
      notify.warn(data.content);
      return;
    }

    const content = data.content || '';
    const lang = detectLang(item.name);

    Modal({
      title: `📄 ${item.name} (${data.total_lines || 0} 行)`,
      body: el('pre', {
        style: 'background:var(--abyss-950);color:var(--abyss-100);padding:12px;border-radius:4px;font-family:var(--font-mono);font-size:12px;line-height:1.6;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-all;',
      }, content),
      footer: `${data.size_human || bytes(item.size_bytes)} · ${data.truncated ? '已截断' : '完整'}`,
    });
  } catch (e) {
    notify.error(`读取失败: ${e.message}`);
  }
}

function detectLang(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { py: 'python', js: 'javascript', ts: 'typescript', html: 'html', css: 'css', json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml', md: 'markdown', sql: 'sql', sh: 'bash', bat: 'batch', ps1: 'powershell', conf: 'ini', ini: 'ini', log: '', txt: '' };
  return map[ext] || '';
}

// ═══════════════════════════════════════════════════════════
//  Upload
// ═══════════════════════════════════════════════════════════

function triggerUpload() {
  $('#file-input')?.click();
}

async function handleUpload(e) {
  const input = e.target;
  const files = input.files;
  if (!files.length) return;

  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }

  notify.info(`正在上传 ${files.length} 个文件...`);

  try {
    const res = await fetch(`/api/files/upload?path=${encodeURIComponent(_currentPath)}`, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      notify.error(err.detail || '上传失败');
      return;
    }

    const data = await res.json();
    const ok = data.uploaded.filter(u => u.success).length;
    const fail = data.uploaded.filter(u => !u.success).length;

    if (fail > 0) {
      notify.warn(`上传: ${ok} 成功, ${fail} 失败`);
      for (const u of data.uploaded) {
        if (!u.success) notify.error(`${u.name}: ${u.error}`);
      }
    } else {
      notify.success(`上传完成: ${ok} 个文件`);
    }

    loadDir(_currentPath);
  } catch (e) {
    notify.error(`上传失败: ${e.message}`);
  }

  input.value = '';
}

// ═══════════════════════════════════════════════════════════
//  Mkdir & Delete
// ═══════════════════════════════════════════════════════════

async function promptMkdir() {
  const name = prompt('新目录名称:');
  if (!name) return;

  try {
    await post(`/api/files/mkdir?path=${encodeURIComponent(_currentPath)}&name=${encodeURIComponent(name)}`);
    notify.success(`已创建: ${name}`);
    loadDir(_currentPath);
  } catch (e) {
    notify.error(`创建失败: ${e.message}`);
  }
}

// Delete is triggered from a data-action button (add later or use right-click)
export async function deleteFile(path) {
  if (!confirm(`确定删除 ${path}?`)) return;
  try {
    await apiDel(`/api/files?path=${encodeURIComponent(path)}`);
    notify.success('已删除');
    loadDir(_currentPath);
  } catch (e) {
    notify.error(`删除失败: ${e.message}`);
  }
}
