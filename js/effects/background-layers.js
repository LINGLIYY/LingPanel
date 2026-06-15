/**
 * Background Layer System (L0-L5) — Debug panel toggles, image cycling, theme sync.
 *
 * @module effects/background-layers
 */

// Default image pools (can be overridden)
const IMG_DARK  = ['bg-image.jpg', '初音未来2.jpg', '初音未来4.jpg', '初音未来5.jpg', '初音未来7.jpg'];
const IMG_LIGHT = ['bg-image-light.png', '初音未来3.jpg', '初音未来8.jpg', '深海少女.jpg', '初音未来6.jpg'];

let darkIdx = 0;
let lightIdx = 0;
let imgPrefix = '../登录页/';

let _panel = null;
let _restoreBtn = null;
let _imgLabel = null;
let _bgImg = null;
let _bgImgWrap = null;

/**
 * Initialize the debug control panel and background layer toggles.
 * @param {Object} [opts]
 * @param {string} [opts.imgPrefix] — path prefix for background images
 * @param {string[]} [opts.imgDark] — dark theme image pool
 * @param {string[]} [opts.imgLight] — light theme image pool
 */
export function init(opts = {}) {
  if (opts.imgPrefix) imgPrefix = opts.imgPrefix;
  if (opts.imgDark) IMG_DARK.splice(0, IMG_DARK.length, ...opts.imgDark);
  if (opts.imgLight) IMG_LIGHT.splice(0, IMG_LIGHT.length, ...opts.imgLight);

  _panel = document.getElementById('debug-panel');
  _restoreBtn = document.getElementById('debug-restore');

  // Layer elements
  const codeBg = document.querySelector('.code-bg');
  const ribbonCanvas = document.getElementById('ribbon-canvas');
  const blobs = document.querySelectorAll('.blob');
  const grid = document.querySelector('.grid-overlay');
  _bgImgWrap = document.querySelector('.bg-image-wrap');
  _bgImg = _bgImgWrap ? _bgImgWrap.querySelector('img') : null;
  _imgLabel = document.querySelector('.ctrl-img-label');

  function toggle(el, show) {
    if (!el) return;
    el.style.display = show ? '' : 'none';
  }

  // Bind chip toggles
  function bindChip(id, targets) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const show = chip.classList.contains('active');
      (Array.isArray(targets) ? targets : [targets]).forEach(t => toggle(t, show));
    });
  }

  bindChip('ctrl-bg', codeBg);
  bindChip('ctrl-ribbons', ribbonCanvas);
  bindChip('ctrl-blobs', [...blobs]);
  bindChip('ctrl-grid', grid);

  // Image chip toggle
  const imgChip = document.getElementById('ctrl-img');
  if (imgChip && _bgImgWrap) {
    imgChip.addEventListener('click', () => {
      imgChip.classList.toggle('active');
      _bgImgWrap.style.display = imgChip.classList.contains('active') ? '' : 'none';
    });
  }

  // Panel hide/restore + click-outside
  const hideBtn = document.getElementById('ctrl-hide');
  if (_panel && hideBtn && _restoreBtn) {
    hideBtn.addEventListener('click', () => {
      _panel.classList.add('hidden');
      _restoreBtn.classList.add('visible');
    });
    _restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _panel.classList.remove('hidden');
      _restoreBtn.classList.remove('visible');
    });
    // Click outside to auto-hide
    document.addEventListener('click', (e) => {
      if (_panel.classList.contains('hidden')) return;
      if (!_panel.contains(e.target) && e.target !== _restoreBtn && !_restoreBtn.contains(e.target)) {
        _panel.classList.add('hidden');
        _restoreBtn.classList.add('visible');
      }
    });
  }

  // Image cycling
  function getPool() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return { pool: isLight ? IMG_LIGHT : IMG_DARK, idx: isLight ? lightIdx : darkIdx };
  }

  function updateImageLabel() {
    const { pool, idx } = getPool();
    if (_imgLabel) _imgLabel.textContent = `${idx + 1}/${pool.length}`;
  }

  function applyImage() {
    const { pool, idx } = getPool();
    if (_bgImg) _bgImg.src = imgPrefix + pool[idx];
    updateImageLabel();
  }

  const prevBtn = document.getElementById('ctrl-img-prev');
  const nextBtn = document.getElementById('ctrl-img-next');

  if (prevBtn) prevBtn.addEventListener('click', () => {
    const { pool } = getPool();
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) lightIdx = (lightIdx - 1 + pool.length) % pool.length;
    else darkIdx = (darkIdx - 1 + pool.length) % pool.length;
    applyImage();
  });

  if (nextBtn) nextBtn.addEventListener('click', () => {
    const { pool } = getPool();
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) lightIdx = (lightIdx + 1) % pool.length;
    else darkIdx = (darkIdx + 1) % pool.length;
    applyImage();
  });

  // Initial label
  applyImage();

  // Theme button via control bar
  const ctrlLight = document.getElementById('ctrl-light');
  if (ctrlLight) {
    ctrlLight.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      ctrlLight.classList.toggle('active', next === 'light');
      // Theme toggle is handled externally — just emit event
      document.documentElement.setAttribute('data-theme', next);
      updateImageForTheme();
    });
  }

  return { applyImage, updateImageLabel };
}

/**
 * Call when theme changes to sync the image to the current theme's pool.
 */
export function updateImageForTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const pool = isLight ? IMG_LIGHT : IMG_DARK;
  const idx = isLight ? lightIdx : darkIdx;
  if (_bgImg) _bgImg.src = imgPrefix + pool[idx];
  if (_imgLabel) _imgLabel.textContent = `${idx + 1}/${pool.length}`;
}
