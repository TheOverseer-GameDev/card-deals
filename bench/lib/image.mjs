/** Pixel helpers for the bench. This file does not import scan/. */

export function rgba(width, height) {
  return new Uint8ClampedArray(width * height * 4);
}

export function setPixel(buf, width, x, y, rgb) {
  if (x < 0 || y < 0 || x >= width) return;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 3 >= buf.length) return;
  buf[i] = rgb[0];
  buf[i + 1] = rgb[1];
  buf[i + 2] = rgb[2];
  buf[i + 3] = 255;
}

export function insideRound(x, y, rect, radius) {
  const l = rect.x;
  const t = rect.y;
  const r = rect.x + rect.w - 1;
  const b = rect.y + rect.h - 1;
  if (x < l || y < t || x > r || y > b) return false;
  const rad = Math.max(0, radius);
  const cx = x < l + rad ? l + rad : x > r - rad ? r - rad : x;
  const cy = y < t + rad ? t + rad : y > b - rad ? b - rad : y;
  if (cx === x && cy === y) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

export function rotate(x, y, cx, cy, deg) {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function checksum(buf) {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(buf.length / 4096));
  for (let i = 0; i < buf.length; i += step) {
    h ^= buf[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
