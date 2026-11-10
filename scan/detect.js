/**
 * Live preview judgment. Photos are not stored or sent.
 * A lined-up card is only a framing check, not a grade.
 */
import { clippedFraction, laplacianVariance } from './engine.js';
import { findQuad } from './pipeline.js';

const HOLD_MS = 700;

function average(gray) {
  if (!gray || !gray.length) return 0;
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

function inside(x, y, quad) {
  let hit = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const yi = quad[i].y;
    const yj = quad[j].y;
    const xi = quad[i].x;
    const xj = quad[j].x;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi) hit = !hit;
  }
  return hit;
}

function regionStats(gray, width, height, quad) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const p of quad) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width - 1, Math.ceil(maxX));
  const y1 = Math.min(height - 1, Math.ceil(maxY));
  let sum = 0;
  let n = 0;
  let clip = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y, quad)) continue;
      const v = gray[y * width + x];
      sum += v;
      n += 1;
      if (v >= 250) clip += 1;
    }
  }
  return { mean: n ? sum / n : 0, clipped: n ? clip / n : 0, count: n };
}

function strideFocus(rgba, width, height) {
  const step = Math.max(2, Math.floor(Math.max(width, height) / 160));
  const cols = Math.floor((width - 1) / step);
  const rows = Math.floor((height - 1) / step);
  if (cols < 4 || rows < 4) return 0;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < rows - 1; y += 2) {
    for (let x = 1; x < cols - 1; x += 2) {
      const px = x * step;
      const py = y * step;
      const v = at(px, py - step) + at(px - step, py) + at(px + step, py) + at(px, py + step) - 4 * at(px, py);
      sum += v;
      sum2 += v * v;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

function cornerAngle(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function result(code, hint, extra) {
  return {
    code,
    hint,
    ready: code === 'lined-up',
    quad: null,
    focus: 0,
    mean: 0,
    clipped: 0,
    ...extra,
  };
}

export function judgePreview(rgba, width, height) {
  if (!rgba || !(width > 0) || !(height > 0) || rgba.length < width * height * 4) {
    return result('too-dark', 'Too dark. Add light.', { mean: 0 });
  }
  const located = findQuad(rgba, width, height, 160, 0.04, 0.02);
  const quad = located.quad || located.candidate || null;
  const meanFrame = average(located.gray);
  if (!quad) {
    if (meanFrame < 32) return result('too-dark', 'Too dark. Add light.', { mean: meanFrame });
    return result('no-card', 'No card outline yet.', { mean: meanFrame });
  }
  const scaledQuad = quad.map((p) => ({ x: p.x * located.scale, y: p.y * located.scale }));
  const stats = regionStats(located.gray, located.width, located.height, scaledQuad);
  const focus = laplacianVariance(located.gray, located.width, located.height);
  const angles = [0, 1, 2, 3].map((i) => cornerAngle(quad[(i + 3) % 4], quad[i], quad[(i + 1) % 4]));
  const skew = Math.max(...angles.map((angle) => Math.abs(angle - 90)));
  const spanW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const spanH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const portrait = spanW < spanH ? spanW / (spanH || 1) : spanH / (spanW || 1);
  const nearEdge = quad.some((p) => p.x < width * 0.03 || p.y < height * 0.03 || p.x > width * 0.97 || p.y > height * 0.97);
  const shared = { quad, focus, mean: stats.mean, clipped: stats.clipped, skew, portrait };
  if (stats.mean < 42) return result('too-dark', 'Too dark. Add light.', shared);
  if (stats.clipped > 0.06 || stats.mean > 230) return result('too-glary', 'Too much glare. Soften the light.', shared);
  // The 160 px preview washes out a blur that is obvious on the photo. A
  // larger copy keeps that blur below the sharp cards without moving the
  // small live sample off the check it already passed.
  let blurred = focus < 12;
  if (!blurred && Math.max(width, height) > 360) {
    blurred = strideFocus(rgba, width, height) < 2200;
  }
  if (blurred) return result('blurry', 'Blurry. Hold still.', shared);
  if (skew > 20 || portrait < 0.56 || portrait > 0.9) return result('tilted', 'Tilted. Hold the phone parallel to the card.', shared);
  if (located.areaFrac < 0.18) return result('too-far', 'Too far. Move closer.', shared);
  if (located.areaFrac > 0.72 || nearEdge) return result('too-close', 'Too close. Move back so the whole card is in frame.', shared);
  // Lined-up photos in the bench sit inside about 6°. The tilted ones are
  // past 12°. The old 3° cut also rejected lined-up frames.
  if (Number.isFinite(located.tilt) && located.tilt > 12) return result('tilted', 'Tilted. Hold the phone parallel to the card.', shared);
  if (!located.found) return result('tilted', 'Tilted. Hold the phone parallel to the card.', shared);
  return result('lined-up', 'Lined up. Hold steady.', shared);
}

export function quadShift(a, b) {
  if (!a || !b || a.length !== 4 || b.length !== 4) return Infinity;
  for (let i = 0; i < 4; i++) {
    if (!Number.isFinite(a[i].x) || !Number.isFinite(a[i].y) || !Number.isFinite(b[i].x) || !Number.isFinite(b[i].y)) return Infinity;
  }
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return sum / 4;
}

export function advanceHold(state, judgment, now, holdMs = HOLD_MS) {
  const prev = state || { since: null, quad: null };
  if (!judgment || !judgment.ready || !judgment.quad) {
    return { since: null, progress: 0, fire: false, quad: judgment && judgment.quad ? judgment.quad : null };
  }
  const shift = prev.quad ? quadShift(prev.quad, judgment.quad) : 0;
  if (shift > 6) return { since: now, progress: 0, fire: false, quad: judgment.quad };
  const since = prev.since == null ? now : prev.since;
  const elapsed = now - since;
  return {
    since,
    progress: Math.max(0, Math.min(1, elapsed / holdMs)),
    fire: elapsed >= holdMs,
    quad: judgment.quad,
  };
}

export { HOLD_MS };
