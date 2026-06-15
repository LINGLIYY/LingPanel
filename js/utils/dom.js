/**
 * LingServer Dashboard — DOM Utilities
 *
 * Minimal helper for creating elements. No framework — just sugar over document.createElement.
 */

/**
 * Create an element with attributes, classes, and children.
 *
 * Usage:
 *   el('div', { class: 'panel', 'data-id': '1' },
 *     el('h3', {}, 'Title'),
 *     el('p', {}, 'Body'),
 *   )
 */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'class' || key === 'className') {
      e.className = val;
    } else if (key === 'html') {
      e.innerHTML = val;
    } else if (key.startsWith('on') && typeof val === 'function') {
      e.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (val !== undefined && val !== null && val !== false) {
      e.setAttribute(key, val);
    }
  }

  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      e.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      e.appendChild(child);
    } else if (Array.isArray(child)) {
      for (const c of child) {
        if (c instanceof Node) e.appendChild(c);
        else if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      }
    }
  }

  return e;
}

/**
 * Query selector shorthand. Returns single element or null.
 */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Query selector all. Returns array (not NodeList).
 */
export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

/**
 * Clear all children from an element.
 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Set text content safely.
 */
export function setText(el, text) {
  if (el) el.textContent = text;
}

/**
 * Toggle a class.
 */
export function toggleClass(el, cls, force) {
  if (el) el.classList.toggle(cls, force);
}

/**
 * Set multiple CSS properties at once.
 */
export function setStyles(el, styles) {
  if (!el) return;
  Object.assign(el.style, styles);
}
