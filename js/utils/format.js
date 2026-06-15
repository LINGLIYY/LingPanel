/**
 * LingServer Dashboard — Format Utilities
 *
 * Number/byte/time formatting for display.
 * All functions are pure, no DOM, no side effects.
 */

/**
 * Format bytes to human-readable string.
 * e.g. 1536 → "1.5 KB", 1073741824 → "1.0 GB"
 */
export function bytes(n) {
  if (n == null || isNaN(n)) return '--';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  return (n / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
}

/**
 * Format bytes per second.
 * e.g. 102400 → "100.0 KB/s"
 */
export function bytesPerSec(n) {
  if (n == null || isNaN(n)) return '--';
  return bytes(n) + '/s';
}

/**
 * Format seconds to human-readable duration.
 * e.g. 3661 → "1h 1m", 125 → "2m 5s"
 */
export function duration(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Format uptime in human-readable form.
 * e.g. 90061 → "1d 1h 1m"
 */
export function uptime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Format a percentage value.
 * e.g. 45.678 → "45.7%"
 */
export function percent(n, decimals = 1) {
  if (n == null || isNaN(n)) return '--';
  return n.toFixed(decimals) + '%';
}

/**
 * Format a number with thousand separators.
 * e.g. 1234567 → "1,234,567"
 */
export function number(n) {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('en-US');
}

/**
 * Format a Unix timestamp to local time string.
 */
export function time(ts) {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * Format a date string to short form.
 */
export function dateShort(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
