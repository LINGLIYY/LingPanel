/**
 * LingServer Dashboard — Files Tab (dame graft)
 *
 * Breadcrumb navigation, file table, text preview/save,
 * drag-drop upload, delete, mkdir.
 * Data: GET /api/files + PUT /api/files/save + POST upload/mkdir + DELETE
 */
import { el, clear, $ } from '../utils/dom.js';
import { get, post, put, del } from '../api.js';
import { notify } from '../utils/notify.js';
import { confirm } from '../utils/confirm.js';
import { bytes } from '../utils/format.js';

let _currentPath = null;
let _refreshTimer = null;

export async function renderFiles(container) {
  clear(container);

  // Auto-detect a valid default path from the server
  if (!_currentPath) {
    try {
      const rootsData = await get('/api/files/roots');
      _currentPath = rootsData.default || rootsData.roots?.[0] || '/home';
    } catch (_) {
      _currentPath = '/home';  // fallback for older backends
    }
  }

  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel__header' },
      el('h2', { class: 'panel__title' },
        el('span', { class: 'prompt' }, '$'),
        ' ls -la',
      ),
      el('div', { class: 'panel__actions' },
        el('button', { class: 'panel__btn panel__btn--primary', id: 'file-mkdir' }, '+ 新建目录'),
      ),
    ),
    // Breadcrumb
    el('div', { class: 'breadcrumb', id: 'file-breadcrumb' }),
    // File list
    el('div', { class: 'panel__body', id: 'file-body', style: 'overflow:auto;' }),
    // Upload zone
    el('div', { style: 'padding:8px 14px;border-top:1px solid var(--card-inner-border);' },
      el('label', { class: 'panel__btn panel__btn--sm', style: 'cursor:pointer;' },
        '📤 上传文件',
        el('input', { type: 'file', id: 'file-upload-input', multiple: true,
          style: 'display:none;',
          onChange: handleUpload,
        }),
      ),
    ),
  );
  container.appendChild(panel);

  // Inline mkdir input (replaces native prompt())
  let mkdirActive = false;
  $('#file-mkdir')?.addEventListener('click', () => {
    if (mkdirActive) return;
    const btn = $('#file-mkdir');
    if (!btn) return;
    mkdirActive = true;
    btn.style.display = 'none';

    const wrap = el('div', { style: 'display:flex;gap:6px;align-items:center;' });
    const inp = el('input', { type: 'text', placeholder: '目录名...', maxlength: 60,
      style: 'width:160px;height:30px;padding:0 8px;border-radius:6px;border:1px solid var(--color-border);background:oklch(0.06 0.01 260 / 0.6);color:var(--t-body);font-family:var(--font-mono);font-size:12px;' });
    const okBtn = el('button', { class: 'panel__btn panel__btn--primary', style: 'height:30px;' }, '创建');
    const cancelBtn = el('button', { class: 'panel__btn', style: 'height:30px;' }, '取消');

    const reset = () => {
      mkdirActive = false;
      wrap.remove();
      if (btn) btn.style.display = '';
    };

    cancelBtn.addEventListener('click', reset);

    okBtn.addEventListener('click', async () => {
      const name = inp.value.trim();
      if (!name) { notify.error('请输入目录名'); return; }
      okBtn.disabled = true;
      try {
        await post(`/api/files/mkdir?path=${encodeURIComponent(_currentPath)}&name=${encodeURIComponent(name)}`);
        notify.success(`已创建目录 ${name}`);
        loadDirectory();
        reset();
      } catch (e) { notify.error(`创建失败: ${e.message}`); okBtn.disabled = false; }
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') reset();
    });

    wrap.appendChild(inp);
    wrap.appendChild(okBtn);
    wrap.appendChild(cancelBtn);
    btn.parentNode?.appendChild(wrap);
    setTimeout(() => inp.focus(), 50);
  });

  loadDirectory();
  _refreshTimer = setInterval(loadDirectory, 15000);
}

async function loadDirectory() {
  const body = $('#file-body');
  const bread = $('#file-breadcrumb');
  if (!body) return;

  try {
    const data = await get(`/api/files?path=${encodeURIComponent(_currentPath)}`);
    _currentPath = data.current_path || _currentPath;
    renderBreadcrumb(bread);
    renderFileList(data.items || [], body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
  }
}

function renderBreadcrumb(bread) {
  if (!bread) return;
  const parts = _currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const crumbs = [{ label: '/', path: '/' }];
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    if (acc !== '/') crumbs.push({ label: p, path: acc });
  }
  bread.innerHTML = crumbs.map((c, i) =>
    `<span class="breadcrumb__sep">/</span><span class="breadcrumb__item${i === crumbs.length - 1 ? ' active' : ''}" data-path="${_esc(c.path)}">${_esc(c.label)}</span>`
  ).join('');

  bread.querySelectorAll('.breadcrumb__item').forEach(item => {
    item.addEventListener('click', () => {
      _currentPath = item.dataset.path;
      loadDirectory();
    });
  });
}

function renderFileList(items, body) {
  clear(body);
  if (!items.length) { body.innerHTML = '<div class="empty-state">空目录</div>'; return; }

  body.innerHTML = `<table class="data-table">
    <thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th>权限</th><th>操作</th></tr></thead>
    <tbody>${items.map(f => `<tr>
      <td style="font-weight:500;cursor:pointer;" data-path="${_esc(f.path)}" class="file-entry ${f.is_dir ? 'file-dir' : 'file-file'}">
        ${f.is_dir ? '📁' : '📄'} ${_esc(f.name)}${f.is_symlink ? ' ↪' : ''}
      </td>
      <td>${f.is_dir ? '-' : f.size_human || bytes(f.size_bytes || 0)}</td>
      <td>${_esc(f.modified || '--')}</td>
      <td>${f.permissions || '--'}</td>
      <td>
        ${!f.is_dir ? `<button class="panel__btn panel__btn--sm file-edit" data-path="${_esc(f.path)}">编辑</button>` : ''}
        <button class="panel__btn panel__btn--danger panel__btn--sm file-delete" data-path="${_esc(f.path)}">删除</button>
      </td>
    </tr>`).join('')}</tbody></table>`;

  // Click to navigate / read
  body.querySelectorAll('.file-entry').forEach(el => {
    el.addEventListener('click', async () => {
      const p = el.dataset.path;
      if (el.classList.contains('file-dir')) { _currentPath = p; loadDirectory(); }
      else await previewFile(p);
    });
  });

  // Edit (opens save dialog)
  body.querySelectorAll('.file-edit').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); previewFile(btn.dataset.path, true); });
  });

  // Delete
  body.querySelectorAll('.file-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = btn.dataset.path;
      const ok = await confirm(`确定删除 ${p}？`, '删除文件');
      if (!ok) return;
      try {
        await del(`/api/files?path=${encodeURIComponent(p)}`);
        notify.success('已删除');
        loadDirectory();
      } catch (err) { notify.error(`删除失败: ${err.message}`); }
    });
  });
}

async function previewFile(filePath, editMode = false) {
  try {
    const data = await get(`/api/files/read?path=${encodeURIComponent(filePath)}`);
    if (data.binary) { notify.warn('二进制文件无法预览'); return; }
    if (data.too_large) { notify.warn(data.content); return; }

    const content = data.content || '';
    const overlay = el('div', {
      style: 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:oklch(0 0 0 / 0.6);',
      onClick: (e) => { if (e.target === overlay) overlay.remove(); },
    },
      el('div', { class: 'panel', style: 'width:800px;max-width:95vw;max-height:85vh;' },
        el('div', { class: 'panel__header' },
          el('span', { class: 'panel__title' }, filePath),
          el('div', { class: 'panel__actions' },
            editMode ? el('button', { class: 'panel__btn panel__btn--primary', id: 'file-save-btn' }, '保存') : null,
            el('button', { class: 'panel__btn panel__btn--sm', onClick: () => overlay.remove() }, '关闭'),
          ),
        ),
        editMode
          ? el('textarea', { class: 'panel__body', id: 'file-edit-area',
              style: 'flex:1;min-height:400px;background:var(--card-inner-bg);color:var(--t-body);font-family:var(--font-mono);font-size:12px;border:none;resize:none;padding:12px;' },
            content)
          : el('pre', { class: 'panel__body', style: 'flex:1;max-height:60vh;overflow:auto;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;' },
            content),
      ),
    );
    document.body.appendChild(overlay);

    if (editMode) {
      $('#file-save-btn')?.addEventListener('click', async () => {
        const newContent = $('#file-edit-area')?.value || '';
        try {
          await put('/api/files/save', { path: filePath, content: newContent });
          notify.success('文件已保存');
          overlay.remove();
          loadDirectory();
        } catch (e) { notify.error(`保存失败: ${e.message}`); }
      });
    }
  } catch (e) { notify.error(`读取失败: ${e.message}`); }
}

async function handleUpload(e) {
  const files = e.target.files;
  if (!files.length) return;
  const form = new FormData();
  for (const f of files) form.append('files', f);
  try {
    const data = await post(`/api/files/upload?path=${encodeURIComponent(_currentPath)}`, form);
    const results = data.uploaded || [];
    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    if (ok) notify.success(`${ok} 个文件上传成功`);
    if (fail) notify.error(`${fail} 个文件上传失败`);
    loadDirectory();
  } catch (err) { notify.error(`上传失败: ${err.message}`); }
  e.target.value = '';
}

function _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

export function cleanup() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}
