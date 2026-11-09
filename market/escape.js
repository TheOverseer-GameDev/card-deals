const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => MAP[ch]);
}
