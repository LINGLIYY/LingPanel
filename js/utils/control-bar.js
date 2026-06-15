/**
 * LingServer Dashboard — Control Bar (Debug Panel)
 *
 * Background layer toggles, image cycling, light/dark image pools.
 * This module wires up the control bar HTML that exists in index.html.
 */
import { $, $$ } from './dom.js';

/** Initialize the debug panel layer toggles and image cycling. */
export function initControlBar() {
  const codeBg = document.querySelector('.code-bg');
  const ribbonCanvas = document.getElementById('ribbon-canvas');
  const blobs = document.querySelectorAll('.blob');
  const grid = document.querySelector('.grid-overlay');
  const bgImgWrap = document.querySelector('.bg-image-wrap');

  function bind(btnId, elOrList) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const show = btn.classList.contains('active');
      const targets = elOrList instanceof NodeList || Array.isArray(elOrList) ? elOrList : [elOrList];
      targets.forEach(el => { if (el) el.style.display = show ? '' : 'none'; });
    });
  }

  bind('ctrl-bg', codeBg);
  bind('ctrl-ribbons', ribbonCanvas);
  bind('ctrl-blobs', blobs);
  bind('ctrl-grid', grid);

  // Image chip toggles background visibility
  const imgChip = document.getElementById('ctrl-img');
  if (imgChip && bgImgWrap) {
    imgChip.addEventListener('click', () => {
      imgChip.classList.toggle('active');
      const show = imgChip.classList.contains('active');
      bgImgWrap.style.display = show ? '' : 'none';
    });
  }

  // Panel hide/restore
  const panel = document.getElementById('debug-panel');
  const hideBtn = document.getElementById('ctrl-hide');
  const restoreBtn = document.getElementById('debug-restore');
  if (panel && hideBtn && restoreBtn) {
    hideBtn.addEventListener('click', () => {
      panel.classList.add('hidden');
      restoreBtn.classList.add('visible');
    });
    restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.remove('hidden');
      restoreBtn.classList.remove('visible');
    });
    // Click outside to auto-hide
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('hidden')) return;
      if (!panel.contains(e.target) && e.target !== restoreBtn && !restoreBtn.contains(e.target)) {
        panel.classList.add('hidden');
        restoreBtn.classList.add('visible');
      }
    });
  }

  // ── Image cycling (dark/light pools) ──
  const IMG_DARK = ['bg-image.jpg', '初音未来2.jpg', '初音未来4.jpg', '初音未来5.jpg', '初音未来7.jpg'];
  const IMG_LIGHT = ['bg-image-light.png', '初音未来3.jpg', '初音未来8.jpg', '深海少女.jpg', '初音未来6.jpg'];
  let darkIdx = 0, lightIdx = 0;
  const imgLabel = document.querySelector('.ctrl-img-label');
  const prevBtn = document.getElementById('ctrl-img-prev');
  const nextBtn = document.getElementById('ctrl-img-next');
  const bgImgDark = bgImgWrap ? bgImgWrap.querySelector('.bg-img-dark') : null;
  const bgImgLight = bgImgWrap ? bgImgWrap.querySelector('.bg-img-light') : null;

  function getPool() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return { pool: isLight ? IMG_LIGHT : IMG_DARK, idx: isLight ? lightIdx : darkIdx };
  }

  function updateImageLabel() {
    const { pool, idx } = getPool();
    if (imgLabel) imgLabel.textContent = `${idx + 1}/${pool.length}`;
  }

  function applyImage() {
    const { pool, idx } = getPool();
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const src = pool[idx];
    if (isLight && bgImgLight) bgImgLight.src = `dame/登录页/${src}`;
    else if (!isLight && bgImgDark) bgImgDark.src = `dame/登录页/${src}`;
    updateImageLabel();
  }

  function navigate(delta) {
    const { pool } = getPool();
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) lightIdx = (lightIdx + delta + pool.length) % pool.length;
    else darkIdx = (darkIdx + delta + pool.length) % pool.length;
    applyImage();
  }

  if (prevBtn) prevBtn.addEventListener('click', () => navigate(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => navigate(1));

  // Expose so theme switch syncs image
  window._updateImageForTheme = () => applyImage();
  updateImageLabel();
}
