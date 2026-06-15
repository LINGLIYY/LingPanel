/**
 * LingServer Dashboard — Control Bar (Debug Panel)
 *
 * Background layer toggles, image cycling with dynamic dark/light pools.
 * This module wires up the control bar HTML that exists in index.html.
 */
import { $, $$ } from './dom.js';
import { comm } from '../comm.js';
const { get } = comm.rest;

/** Initialize the debug panel layer toggles and image cycling. */
export async function initControlBar() {
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

  // ── Image cycling (dynamic from backgrounds/ API) ──
  const bgImgDark = bgImgWrap ? bgImgWrap.querySelector('.bg-img-dark') : null;
  const bgImgLight = bgImgWrap ? bgImgWrap.querySelector('.bg-img-light') : null;
  const imgLabel = document.querySelector('.ctrl-img-label');
  const prevBtn = document.getElementById('ctrl-img-prev');
  const nextBtn = document.getElementById('ctrl-img-next');

  let IMG_DARK = [];
  let IMG_LIGHT = [];
  let darkIdx = 0;
  let lightIdx = 0;

  // Fetch available images from the server
  try {
    const data = await get('/api/system/backgrounds');
    IMG_DARK = data.dark || [];
    IMG_LIGHT = data.light || [];
  } catch (_) {
    // No images available — cycling controls do nothing
  }

  // Set initial image if available
  if (IMG_DARK.length && bgImgDark) {
    bgImgDark.src = `backgrounds/dark/${IMG_DARK[0]}`;
    bgImgDark.style.display = '';
  }
  if (IMG_LIGHT.length && bgImgLight) {
    bgImgLight.src = `backgrounds/light/${IMG_LIGHT[0]}`;
  }

  function getPool() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return { pool: isLight ? IMG_LIGHT : IMG_DARK, idx: isLight ? lightIdx : darkIdx };
  }

  function updateImageLabel() {
    const { pool, idx } = getPool();
    if (imgLabel) imgLabel.textContent = pool.length ? `${idx + 1}/${pool.length}` : '0/0';
  }

  function applyImage() {
    const { pool, idx } = getPool();
    if (!pool.length) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const src = `backgrounds/${isLight ? 'light' : 'dark'}/${pool[idx]}`;
    if (isLight && bgImgLight) bgImgLight.src = src;
    else if (!isLight && bgImgDark) bgImgDark.src = src;
    updateImageLabel();
  }

  function navigate(delta) {
    const { pool } = getPool();
    if (!pool.length) return;
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
