/**
 * LingServer Dashboard — Canvas CPU Waveform
 *
 * 60fps ring-buffer CPU usage visualization.
 * Renders a scrolling line chart on a Canvas 2D context.
 * No external dependencies.
 */

const BUFFER_SIZE = 60; // 60 seconds of data at 1 sample/sec
const LINE_WIDTH = 2;
const GRID_COLOR_DARK = 'oklch(0.18 0.01 260)';
const GRID_COLOR_LIGHT = 'oklch(0.85 0.01 260)';
const LINE_COLOR = 'oklch(0.55 0.18 255)';   // blue
const LINE_GLOW = 'oklch(0.55 0.18 255 / 0.3)';
const FILL_COLOR = 'oklch(0.55 0.18 255 / 0.05)';
const TEXT_COLOR_DARK = 'oklch(0.40 0.02 260)';
const TEXT_COLOR_LIGHT = 'oklch(0.50 0.01 260)';

/** @type {Float32Array} */
let _buffer = new Float32Array(BUFFER_SIZE);
let _writeIdx = 0;
let _count = 0; // how many samples have been written (< BUFFER_SIZE initially)
let _canvas = null;
let _ctx = null;
let _rafId = null;
let _animFrame = 0;

/**
 * Initialize the waveform on a canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function initWave(canvas) {
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _buffer = new Float32Array(BUFFER_SIZE);
  _writeIdx = 0;
  _count = 0;
  _animFrame = 0;

  // Start render loop
  if (_rafId) cancelAnimationFrame(_rafId);
  _render();
}

/**
 * Push a new CPU percentage value into the ring buffer.
 *
 * @param {number} cpuPercent — 0-100
 */
export function pushCpu(cpuPercent) {
  _buffer[_writeIdx] = cpuPercent;
  _writeIdx = (_writeIdx + 1) % BUFFER_SIZE;
  if (_count < BUFFER_SIZE) _count++;
}

/**
 * Stop the render loop.
 */
export function stopWave() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

/**
 * Resize canvas to match its display size.
 */
export function resizeWave() {
  if (!_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  _canvas.width = rect.width * dpr;
  _canvas.height = rect.height * dpr;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Internal render ──

function _render() {
  if (!_ctx || !_canvas) {
    _rafId = requestAnimationFrame(_render);
    return;
  }

  _animFrame++;
  // Only do full redraw every 3 frames to save GPU (still looks smooth at 20fps draw)
  if (_animFrame % 3 !== 0 && _count > 0) {
    _rafId = requestAnimationFrame(_render);
    return;
  }

  const w = _canvas.clientWidth;
  const h = _canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  // Only resize backing store when dimensions change — avoids GPU buffer clear
  const targetW = w * dpr;
  const targetH = h * dpr;
  if (_canvas.width !== targetW || _canvas.height !== targetH) {
    _canvas.width = targetW;
    _canvas.height = targetH;
  }
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? GRID_COLOR_DARK : GRID_COLOR_LIGHT;
  const textColor = isDark ? TEXT_COLOR_DARK : TEXT_COLOR_LIGHT;

  const pad = { top: 4, right: 4, bottom: 16, left: 36 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  // Clear
  _ctx.clearRect(0, 0, w, h);

  if (_count < 2) {
    _ctx.fillStyle = textColor;
    _ctx.font = '12px "Fira Code", monospace';
    _ctx.textAlign = 'center';
    _ctx.fillText('等待数据...', w / 2, h / 2);
    _rafId = requestAnimationFrame(_render);
    return;
  }

  // ── Grid ──
  _ctx.strokeStyle = gridColor;
  _ctx.lineWidth = 0.5;
  for (let pct = 0; pct <= 100; pct += 25) {
    const y = pad.top + ph - (pct / 100) * ph;
    _ctx.beginPath();
    _ctx.moveTo(pad.left, y);
    _ctx.lineTo(w - pad.right, y);
    _ctx.stroke();
  }

  // Y-axis labels
  _ctx.fillStyle = textColor;
  _ctx.font = '9px "Fira Code", monospace';
  _ctx.textAlign = 'right';
  for (let pct = 0; pct <= 100; pct += 25) {
    const y = pad.top + ph - (pct / 100) * ph;
    _ctx.fillText(`${pct}%`, pad.left - 6, y + 3);
  }

  // ── Build points from ring buffer ──
  const points = [];
  for (let i = 0; i < _count; i++) {
    const idx = (_writeIdx - _count + i + BUFFER_SIZE) % BUFFER_SIZE;
    const x = pad.left + (i / (BUFFER_SIZE - 1)) * pw;
    const val = Math.min(100, Math.max(0, _buffer[idx]));
    const y = pad.top + ph - (val / 100) * ph;
    points.push({ x, y, val });
  }

  // ── Fill area under curve ──
  _ctx.beginPath();
  if (points.length > 0) {
    _ctx.moveTo(points[0].x, pad.top + ph);
    for (const p of points) _ctx.lineTo(p.x, p.y);
    _ctx.lineTo(points[points.length - 1].x, pad.top + ph);
    _ctx.closePath();
    _ctx.fillStyle = FILL_COLOR;
    _ctx.fill();
  }

  // ── Glow line (wider, transparent) ──
  _ctx.beginPath();
  _ctx.strokeStyle = LINE_GLOW;
  _ctx.lineWidth = LINE_WIDTH + 4;
  _ctx.lineJoin = 'round';
  for (let i = 0; i < points.length; i++) {
    if (i === 0) _ctx.moveTo(points[i].x, points[i].y);
    else _ctx.lineTo(points[i].x, points[i].y);
  }
  _ctx.stroke();

  // ── Main line ──
  _ctx.beginPath();
  _ctx.strokeStyle = LINE_COLOR;
  _ctx.lineWidth = LINE_WIDTH;
  _ctx.lineJoin = 'round';
  for (let i = 0; i < points.length; i++) {
    if (i === 0) _ctx.moveTo(points[i].x, points[i].y);
    else _ctx.lineTo(points[i].x, points[i].y);
  }
  _ctx.stroke();

  // ── Current value label ──
  if (points.length > 0) {
    const last = points[points.length - 1];
    _ctx.fillStyle = LINE_COLOR;
    _ctx.font = 'bold 11px "Fira Code", monospace';
    _ctx.textAlign = 'left';
    _ctx.fillText(`${last.val.toFixed(1)}%`, last.x + 4, last.y - 4);
  }

  _rafId = requestAnimationFrame(_render);
}
