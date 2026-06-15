/**
 * LingServer Dashboard — SVG Icons
 *
 * Professional SVG icon set for server operations dashboard.
 * Each icon returns an inline SVG string with currentColor for theming.
 * Size controlled via CSS font-size on parent.
 *
 * Usage:
 *   import { icon } from '../utils/icons.js';
 *   el('button', {}, icon('cpu'), 'CPU')
 *   // Renders: <svg ...>...</svg> CPU
 */
const NS = 'http://www.w3.org/2000/svg';

/** Helper: wrap paths in a standard 24x24 SVG. */
const svg = (d, opts = {}) => {
  const { stroke = 'currentColor', fill = 'none', sw = 1.5 } = opts;
  const paths = Array.isArray(d) ? d : [d];
  const pathEls = paths.map(p =>
    `<path d="${p}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('');
  return `<svg xmlns="${NS}" width="1em" height="1em" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pathEls}</svg>`;
};

// ── Status (solid circles) ──
const svgSolid = (d, color = 'currentColor') =>
  `<svg xmlns="${NS}" width="1em" height="1em" viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><path d="${d}" fill="${color}"/></svg>`;

// ═══════════════════════════════════════════════════════════
//  System Metrics
// ═══════════════════════════════════════════════════════════

const cpu          = () => svg(['M9 2h6v4H9zM9 18h6v4H9z','M5 6h4v12H5zM15 6h4v12h-4z','M2 10h4v4H2zM18 10h4v4h-4z']);
const memory       = () => svg(['M4 4h16v16H4z','M8 8v8M12 8v8M16 8v8'], { sw: 2 });
const disk         = () => svg(['M22 12H2M5.45 5.11l-2 1.64M18.55 5.11l2 1.64M12 2v4M12 18v4','M5.45 18.89l-2-1.64M18.55 18.89l2-1.64','M4 12a8 8 0 0116 0']);
const network      = () => svg(['M12 2a10 10 0 0110 10M12 2a10 10 0 00-10 10M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10M12 2a15.3 15.3 0 00-4 10 15.3 15.3 0 004 10']);
const clock        = () => svg(['M12 22a10 10 0 100-20 10 10 0 000 20z','M12 6v6l4 2']);
const barChart     = () => svg(['M18 20V10M12 20V4M6 20v-6']);
const activity     = () => svg(['M22 12h-4l-3 9L9 3l-3 9H2']);

// ═══════════════════════════════════════════════════════════
//  Actions
// ═══════════════════════════════════════════════════════════

const search       = () => svg(['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z']);
const refresh      = () => svg(['M1 4v6h6M23 20v-6h-6','M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15']);
const upload       = () => svg(['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4','M17 8l-5-5-5 5','M12 3v12']);
const plus         = () => svg(['M12 5v14M5 12h14']);
const xMark        = () => svg(['M18 6L6 18M6 6l12 12']);
const check        = () => svg(['M20 6L9 17l-5-5']);
const chevronRight = () => svg(['M9 18l6-6-6-6']);
const chevronLeft  = () => svg(['M15 18l-6-6 6-6']);
const chevronUp    = () => svg(['M18 15l-6-6-6 6']);
const chevronDown  = () => svg(['M6 9l6 6 6-6']);
const copy         = () => svg(['M8 4h8a2 2 0 012 2v10M16 8H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2z']);
const paste        = () => svg(['M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2','M9 2h6v4H9z']);
const clearFormat  = () => svg(['M3 6h18M8 6V4h8v2M10 11v6M14 11v6M5 6l1 14h12l1-14']);
const terminal     = () => svg(['M4 17l5-5-5-5M12 19h8']);
const eye          = () => svg(['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z','M12 15a3 3 0 100-6 3 3 0 000 6z']);
const bell         = () => svg(['M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9','M13.73 21a2 2 0 01-3.46 0']);

// ═══════════════════════════════════════════════════════════
//  Files & Folders
// ═══════════════════════════════════════════════════════════

const folder       = () => svg(['M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z']);
const file         = () => svg(['M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z','M14 2v6h6']);
const folderPlus   = () => svg(['M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z','M12 11v6M9 14h6']);

// ═══════════════════════════════════════════════════════════
//  Services
// ═══════════════════════════════════════════════════════════

const serverSvg    = () => svg(['M5 2h14a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z','M5 14h14a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4a2 2 0 012-2z','M7 5h.01M7 17h.01']);
const database     = () => svg(['M4 6c0 1.66 3.58 3 8 3s8-1.34 8-3M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6','M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3']);
const shield       = () => svg(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']);
const box          = () => svg(['M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z','M3.27 6.96L12 12.01l8.73-5.05','M12 22.08V12']);
const settings     = () => svg(['M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z','M12 15a3 3 0 100-6 3 3 0 000 6z']);
const globe        = () => svg(['M12 22a10 10 0 100-20 10 10 0 000 20z','M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10M12 2a15.3 15.3 0 00-4 10 15.3 15.3 0 004 10']);
const dockerIcon   = () => svg(['M4 9h2v2H4zM7 9h2v2H7zM10 9h2v2h-2zM13 9h2v2h-2zM7 6h2v2H7zM10 6h2v2h-2zM13 6h2v2h-2zM4 12h2v2H4zM7 12h2v2H7zM10 12h2v2h-2zM13 12h2v2h-2zM1 15l1.5-1.5h17L21 15M3 16h16v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3z']);

// ═══════════════════════════════════════════════════════════
//  Status indicators (solid circles)
// ═══════════════════════════════════════════════════════════

const circleGreen  = () => svgSolid('M12 2a10 10 0 100 20 10 10 0 000-20z', 'var(--color-success, #22c55e)');
const circleRed    = () => svgSolid('M12 2a10 10 0 100 20 10 10 0 000-20z', 'var(--color-error, #ef4444)');
const circleYellow = () => svgSolid('M12 2a10 10 0 100 20 10 10 0 000-20z', 'var(--color-warning, #eab308)');

// ═══════════════════════════════════════════════════════════
//  Theme
// ═══════════════════════════════════════════════════════════

const moon   = () => svg(['M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z']);
const sun    = () => svg(['M12 17a5 5 0 100-10 5 5 0 000 10z','M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42']);
const logoutIcon = () => svg(['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4','M16 17l5-5-5-5','M21 12H9']);

// ═══════════════════════════════════════════════════════════
//  Data & Empty states
// ═══════════════════════════════════════════════════════════

const emptyBox    = () => svg(['M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z','M3.27 6.96L12 12.01l8.73-5.05M12 21.35V12'], { sw: 2 });
const emptySearch = () => svg(['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z','M11 8v4l3 2'], { sw: 2 });

// ═══════════════════════════════════════════════════════════
//  Icon map — used by icon() helper
// ═══════════════════════════════════════════════════════════

const icons = {
  cpu, memory, disk, network, clock, 'bar-chart': barChart, activity,
  search, refresh, upload, plus, 'x': xMark, check, 'chevron-right': chevronRight,
  'chevron-left': chevronLeft, 'chevron-up': chevronUp, 'chevron-down': chevronDown,
  copy, paste, 'clear-format': clearFormat, terminal, eye, bell,
  folder, file, 'folder-plus': folderPlus,
  server: serverSvg, database, shield, box, settings, globe, docker: dockerIcon,
  'circle-green': circleGreen, 'circle-red': circleRed, 'circle-yellow': circleYellow,
  moon, sun, logout: logoutIcon,
  'empty-box': emptyBox, 'empty-search': emptySearch,
};

/**
 * Get an SVG icon by name. Returns HTML string.
 * @param {string} name — icon name (see list above)
 * @returns {string} SVG HTML string, or '' if icon not found
 */
export function icon(name) {
  const fn = icons[name];
  return fn ? fn() : '';
}

/**
 * Icon + text label — shorthand for the common `icon('x') + ' label'` pattern.
 * @param {string} name — icon name
 * @param {string} label — display text
 * @returns {string} SVG HTML + space + label
 */
export function iconLabel(name, label) {
  return icon(name) + ' ' + label;
}

/**
 * List all available icon names.
 */
export function iconNames() {
  return Object.keys(icons);
}
