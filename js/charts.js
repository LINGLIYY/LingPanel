/**
 * LingServer Dashboard — Chart.js Configuration
 *
 * Dark-theme defaults for Chart.js instances.
 * Creates consistently styled charts across the dashboard.
 */

const DARK_THEME = {
  color: 'oklch(0.85 0.02 260)',
  gridColor: 'oklch(0.18 0.01 260)',
  tickColor: 'oklch(0.40 0.02 260)',
};

const LIGHT_THEME = {
  color: 'oklch(0.25 0.01 260)',
  gridColor: 'oklch(0.85 0.01 260)',
  tickColor: 'oklch(0.50 0.01 260)',
};

/**
 * Get the current theme colors.
 */
export function themeColors() {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? LIGHT_THEME : DARK_THEME;
}

/**
 * Create a Chart.js line chart with dark defaults.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} options — merged with defaults
 * @returns {Chart}
 */
export function createLineChart(canvas, options = {}) {
  const tc = themeColors();

  const defaults = {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          grid: { color: tc.gridColor, drawBorder: false },
          ticks: { color: tc.tickColor, font: { size: 10, family: 'Fira Code' }, maxTicksLimit: 6 },
        },
        y: {
          display: true,
          beginAtZero: false,
          grid: { color: tc.gridColor, drawBorder: false },
          ticks: { color: tc.tickColor, font: { size: 10, family: 'Fira Code' } },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: 'oklch(0.12 0.01 260)',
          titleFont: { family: 'Fira Code', size: 12 },
          bodyFont: { family: 'Fira Code', size: 11 },
          borderColor: 'oklch(0.25 0.01 260)',
          borderWidth: 1,
        },
      },
    },
  };

  // Recursive deep merge — handles any nesting depth without manual wiring
  const _deepMerge = (base, overrides) => {
    const out = { ...base, ...overrides };
    for (const k of Object.keys(overrides)) {
      if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k])) {
        out[k] = _deepMerge(base[k] || {}, overrides[k]);
      }
    }
    return out;
  };
  const merged = _deepMerge(defaults, options);

  return new Chart(canvas, merged);
}

/**
 * Returns default dataset style for the given index.
 */
export function datasetStyle(index = 0) {
  const colors = [
    { border: 'oklch(0.55 0.18 255)', bg: 'oklch(0.55 0.18 255 / 0.1)' },
    { border: 'oklch(0.65 0.20 145)', bg: 'oklch(0.65 0.20 145 / 0.1)' },
    { border: 'oklch(0.75 0.15 85)',  bg: 'oklch(0.75 0.15 85 / 0.1)' },
    { border: 'oklch(0.65 0.10 195)', bg: 'oklch(0.65 0.10 195 / 0.1)' },
    { border: 'oklch(0.55 0.22 25)',  bg: 'oklch(0.55 0.22 25 / 0.1)' },
  ];
  const c = colors[index % colors.length];
  return {
    borderColor: c.border,
    backgroundColor: c.bg,
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.3,
    fill: true,
  };
}
