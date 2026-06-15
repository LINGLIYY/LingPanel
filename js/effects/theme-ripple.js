/**
 * Theme Ripple Ring — Expanding circle portal animation on theme toggle.
 * Used by both the header theme button and the debug panel theme button.
 *
 * @module effects/theme-ripple
 */

const REVEAL_ID = 'theme-reveal';

/**
 * Toggle between dark/light theme with a ripple animation originating from a button.
 * @param {'dark'|'light'} targetTheme
 * @param {HTMLElement} originEl — the button element the ripple grows from
 * @param {Function} [onThemeChanged] — callback after theme attribute is set
 */
export function toggleTheme(targetTheme, originEl, onThemeChanged) {
  let reveal = document.getElementById(REVEAL_ID);
  if (!reveal) {
    reveal = document.createElement('div');
    reveal.id = REVEAL_ID;
    reveal.className = 'theme-reveal';
    document.body.appendChild(reveal);
  }

  const rect = originEl.getBoundingClientRect();
  const size = 16;
  reveal.style.left = (rect.left + rect.width / 2) + 'px';
  reveal.style.top = (rect.top + rect.height / 2) + 'px';
  reveal.style.width = size + 'px';
  reveal.style.height = size + 'px';
  reveal.style.marginLeft = -(size / 2) + 'px';
  reveal.style.marginTop = -(size / 2) + 'px';

  const isLight = targetTheme === 'light';
  reveal.className = 'theme-reveal ' + (isLight ? 'theme-reveal--light' : 'theme-reveal--dark');
  // Force reflow so the transition fires
  reveal.offsetHeight;
  reveal.classList.add('active');

  setTimeout(() => {
    document.documentElement.setAttribute('data-theme', targetTheme);
    if (onThemeChanged) onThemeChanged(targetTheme);
  }, 150);

  setTimeout(() => reveal.classList.remove('active'), 600);
}

/**
 * Get the current theme (falls back to prefers-color-scheme, then dark).
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
