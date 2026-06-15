/**
 * LingServer Dashboard — UI Factory
 *
 * Reusable DOM component factories. Each returns a DOM element.
 * No framework, no state — just functions that create elements.
 */
import { el, clear } from './utils/dom.js';
import { icon } from './utils/icons.js';

// ═══════════════════════════════════════════════════════════
//  KPI Card
// ═══════════════════════════════════════════════════════════

/**
 * Create a KPI card element.
 *
 * @param {Object} opts
 * @param {string} opts.id       — unique ID
 * @param {string} opts.label    — display label
 * @param {string} opts.value    — initial value
 * @param {string} [opts.sub]    — subtitle
 * @param {string} [opts.color]  — accent color CSS var
 * @param {string} [opts.icon]   — SVG icon name from icons.js
 */
export function KpiCard({ id, label, value, sub, color, icon: iconName } = {}) {
  const card = el('div', { class: 'kpi-card', 'data-kpi': id });

  const header = el('div', { class: 'kpi-card__header' },
    iconName ? el('span', { class: 'kpi-card__icon', html: icon(iconName) }) : null,
    el('span', { class: 'kpi-card__label' }, label),
  );

  const val = el('div', { class: 'kpi-card__value', id: `kpi-${id}-val`, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, value || '--');
  if (color) val.style.color = `var(--${color})`;

  const footer = el('div', { class: 'kpi-card__sub', id: `kpi-${id}-sub` }, sub || '');

  card.append(header, val, footer);
  return card;
}

/**
 * Update a KPI card's values.
 */
export function updateKpi(id, { value, sub, color } = {}) {
  const valEl = document.getElementById(`kpi-${id}-val`);
  const subEl = document.getElementById(`kpi-${id}-sub`);
  if (valEl && value !== undefined) valEl.textContent = value;
  if (subEl && sub !== undefined) subEl.textContent = sub;
  if (valEl && color) valEl.style.color = `var(--${color})`;
}

// ═══════════════════════════════════════════════════════════
//  Panel (generic container)
// ═══════════════════════════════════════════════════════════

/**
 * Create a panel container with optional title.
 */
export function Panel({ title, className = '', id } = {}) {
  const panel = el('div', { class: `panel ${className}`, id });
  if (title) {
    panel.appendChild(el('div', { class: 'panel__header' },
      el('h3', { class: 'panel__title' }, title),
    ));
  }
  panel.appendChild(el('div', { class: 'panel__body' }));
  return panel;
}

/**
 * Get the panel body where content goes.
 */
export function panelBody(panel) {
  return panel.querySelector('.panel__body') || panel;
}

// ═══════════════════════════════════════════════════════════
//  Data Table
// ═══════════════════════════════════════════════════════════

/**
 * Create a data table.
 *
 * @param {Object} opts
 * @param {string[]} opts.columns — column keys
 * @param {Object[]}  opts.labels  — {key: 'Display Name'}
 * @param {Object[][]} opts.rows   — array of row objects
 * @param {Function} [opts.format] — (key, value) => display string
 * @param {Function} [opts.onClick] — (row) => void
 */
export function DataTable({ columns, labels = {}, rows = [], format, onClick } = {}) {
  const table = el('table', { class: 'data-table' });

  // Header
  const thead = el('thead', {},
    el('tr', {},
      columns.map(col => el('th', {}, labels[col] || col)),
    ),
  );

  // Body
  const tbody = el('tbody', {});
  for (const row of rows) {
    const tr = el('tr', {});
    if (onClick) tr.addEventListener('click', () => onClick(row));

    for (const col of columns) {
      let val = row[col] ?? '';
      if (format) val = format(col, val, row);
      tr.appendChild(el('td', {}, String(val)));
    }
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  return table;
}

/**
 * Update table rows efficiently (clears and rebuilds).
 */
export function updateTable(table, { columns, rows, format }) {
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  // Update header if needed
  if (columns && thead) {
    clear(thead);
    thead.appendChild(el('tr', {},
      columns.map(col => el('th', {}, col)),
    ));
  }

  // Update body
  clear(tbody);
  for (const row of rows) {
    const tr = el('tr', {});
    for (const col of columns) {
      let val = row[col] ?? '';
      if (format) val = format(col, val, row);
      tr.appendChild(el('td', {}, String(val)));
    }
    tbody.appendChild(tr);
  }
}

// ═══════════════════════════════════════════════════════════
//  Modal — Double-glass modal dialog
// ═══════════════════════════════════════════════════════════

let _modalFocusRestore = null;

/**
 * Create and show a modal. Matches CSS structure:
 *   .modal-backdrop > .modal-shell > .modal-card
 *     .modal-title (with $ prompt)
 *     body content
 *     .modal-actions with .modal-btn buttons
 *
 * @param {string}          opts.title   - Modal title (plain text or HTML)
 * @param {string|Node}     opts.body    - Body content (string → innerHTML, Node → appended)
 * @param {string|Node|null} opts.footer - Actions: Node → used as-is; string → shown as text + close btn
 * @param {function}        opts.onClose - Callback after close
 */
export function Modal({ title, body, footer, onClose } = {}) {
  _modalFocusRestore = document.activeElement;

  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', onClick: (e) => {
    if (e.target === backdrop) _close();
  }});

  const shell = el('div', { class: 'modal-shell' });
  const card = el('div', { class: 'modal-card' });

  // Title with $ prompt prefix
  const titleEl = el('h2', { class: 'modal-title', id: 'modal-title' },
    el('span', { class: 'prompt' }, '$'),
    ' ' + (title || ''),
  );
  card.appendChild(titleEl);

  // Body — support both string HTML and Node
  if (typeof body === 'string') {
    card.appendChild(el('div', { html: body }));
  } else if (body instanceof Node) {
    card.appendChild(body);
  }

  // Footer → modal-actions row
  if (footer != null) {
    let actionsEl;
    if (footer instanceof Node) {
      // If footer is a DOM node, wrap it with modal-actions
      actionsEl = el('div', { class: 'modal-actions' });
      actionsEl.appendChild(footer);
      // If footer contains buttons, add modal-btn classes
      actionsEl.querySelectorAll('button').forEach((btn, i, arr) => {
        btn.classList.add('modal-btn');
        if (arr.length > 1) {
          // First button → cancel style, last → submit style
          if (i === 0) btn.classList.add('modal-btn--cancel');
          else btn.classList.add('modal-btn--submit');
        } else {
          btn.classList.add('modal-btn--submit');
        }
      });
    } else {
      // String footer → show text with close button
      actionsEl = el('div', { class: 'modal-actions' },
        el('span', { style: 'flex:1;display:flex;align-items:center;font-size:12px;color:var(--t-muted);' }, String(footer)),
        el('button', { class: 'modal-btn modal-btn--submit', onClick: _close }, '关闭'),
      );
    }
    card.appendChild(actionsEl);
  }

  shell.appendChild(card);
  backdrop.appendChild(shell);
  document.body.appendChild(backdrop);

  // Focus first focusable element
  const firstFocusable = card.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
  if (firstFocusable) firstFocusable.focus();

  // Focus trap — Tab cycles within modal
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { _close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = card.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKeyDown);

  function _close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.classList.add('closing');
    const onAnimEnd = () => {
      backdrop.remove();
      if (_modalFocusRestore && typeof _modalFocusRestore.focus === 'function') {
        try { _modalFocusRestore.focus(); } catch (_) { /* element may be detached */ }
      }
      _modalFocusRestore = null;
    };
    backdrop.addEventListener('animationend', onAnimEnd, { once: true });
    setTimeout(onAnimEnd, 200); // fallback if animation doesn't fire
    if (onClose) onClose();
  }

  return { backdrop, close: _close };
}

// ═══════════════════════════════════════════════════════════
//  Skeleton (loading placeholder)
// ═══════════════════════════════════════════════════════════

export function Skeleton({ width = '100%', height = '1rem', style = '' } = {}) {
  return el('div', {
    class: 'skeleton',
    style: `width:${width};height:${height};${style}`,
  });
}

// ═══════════════════════════════════════════════════════════
//  Empty State
// ═══════════════════════════════════════════════════════════

export function EmptyState({ icon: iconName = 'empty-box', message = '暂无数据' } = {}) {
  return el('div', { class: 'status-msg' },
    el('span', { class: 'empty-state__icon', html: icon(iconName) }),
    el('p', {}, message),
  );
}
