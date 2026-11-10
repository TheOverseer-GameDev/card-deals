/**
 * On-device straighten, centering, and photo grade. No network.
 * A zero guide is null. CAD is never implied from a USD figure.
 */

export const NAMES = {
  10: 'Gem Mint',
  9: 'Mint',
  8: 'NM-MT',
  7: 'NM',
  6: 'EX-MT',
  5: 'EX',
  4: 'VG-EX',
  3: 'VG',
  2: 'Good',
  1: 'Poor',
};

export function positiveGuide(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function guideDisplay(usd, rate, rateDate) {
  const amount = positiveGuide(usd);
  if (amount == null) {
    return { cad: null, usd: null, rateDate: null, note: '' };
  }
  const fx = positiveGuide(rate);
  if (fx == null) {
    return {
      cad: null,
      usd: amount,
      rateDate: null,
      note: 'CAD rate unavailable. USD is not labeled as CAD.',
    };
  }
  return { cad: Math.round(amount * fx * 100) / 100, usd: amount, rateDate: rateDate || null, note: '' };
}

export function formatGuide(usd, rate, rateDate) {
  const row = guideDisplay(usd, rate, rateDate);
  const usdText = row.usd == null ? 'Unavailable' : `USD ${row.usd.toFixed(2)}`;
  const cadText = row.cad == null ? 'Unavailable' : `CAD ${row.cad.toFixed(2)}`;
  return { cadText, usdText, note: row.note, rateDate: row.rateDate };
}

export function normalizeSetCode(text) {
  const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!raw) return '';
  if (/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/.test(raw)) return raw;
  const glued = raw.match(/^([A-Z]{2,5})(\d{3,4})$/);
  if (glued) return `${glued[1]}-${glued[2]}`;
  return '';
}

export function grayOf(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    out[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return out;
}

function scaleToLong(rgba, width, height, longEdge) {
  const long = Math.max(width, height);
  if (long <= longEdge) return { rgba, width, height, scale: 1 };
  const scale = longEdge / long;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, y / scale);
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, x / scale);
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = rgba[(y0 * width + x0) * 4 + c];
        const b = rgba[(y0 * width + x1) * 4 + c];
        const d = rgba[(y1 * width + x0) * 4 + c];
        const e = rgba[(y1 * width + x1) * 4 + c];
        out[i + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  return { rgba: out, width: w, height: h, scale };
}

function blur5(src, width, height) {
  const k = [1, 4, 6, 4, 1];
  const div = 16;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = Math.min(width - 1, Math.max(0, x + i));
        s += src[y * width + xx] * k[i + 2];
      }
      tmp[y * width + x] = s / div;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = Math.min(height - 1, Math.max(0, y + i));
        s += tmp[yy * width + x] * k[i + 2];
      }
      out[y * width + x] = s / div;
    }
  }
  return out;
}

function sobelMag(src, width, height) {
  const mag = new Float32Array(src.length);
  let max = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = -src[i - width - 1] + src[i - width + 1] - 2 * src[i - 1] + 2 * src[i + 1] - src[i + width - 1] + src[i + width + 1];
      const gy = -src[i - width - 1] - 2 * src[i - width] - src[i - width + 1] + src[i + width - 1] + 2 * src[i + width] + src[i + width + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  return { mag, max };
}

function edgeMask(mag, width, height, max) {
  const keep = new Uint8Array(mag.length);
  const hi = max * 0.28;
  const lo = max * 0.12;
  for (let i = 0; i < mag.length; i++) if (mag[i] >= hi) keep[i] = 1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (keep[i] || mag[i] < lo) continue;
      if (keep[i - 1] || keep[i + 1] || keep[i - width] || keep[i + width]) keep[i] = 1;
    }
  }
  const dil = new Uint8Array(keep);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (keep[i] || keep[i - 1] || keep[i + 1] || keep[i - width] || keep[i + width]) dil[i] = 1;
    }
  }
  return dil;
}

function largestComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  let best = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const comp = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % width;
      const y = (i - x) / width;
      const nbr = [];
      if (x > 0) nbr.push(i - 1);
      if (x + 1 < width) nbr.push(i + 1);
      if (y > 0) nbr.push(i - width);
      if (y + 1 < height) nbr.push(i + width);
      for (const n of nbr) {
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

function hull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function dpOpen(points, epsilon) {
  if (points.length < 3) return points.slice();
  function rec(a, b, out) {
    let max = 0;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const bx = points[b].x;
    const by = points[b].y;
    const dx = bx - ax;
    const dy = by - ay;
    const den = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const dist = Math.abs(dy * points[i].x - dx * points[i].y + bx * ay - by * ax) / den;
      if (dist > max) {
        max = dist;
        idx = i;
      }
    }
    if (max > epsilon && idx > a) {
      rec(a, idx, out);
      rec(idx, b, out);
    } else out.push(points[a]);
  }
  const out = [];
  rec(0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

function dp(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let far = 1;
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const left = dpOpen(points.slice(0, far + 1), epsilon);
  const right = dpOpen(points.slice(far).concat([points[0]]), epsilon);
  return left.concat(right.slice(1, -1));
}

function axisDelta(deg) {
  let d = Math.abs(deg % 180);
  if (d > 90) d = 180 - d;
  return Math.min(d, 90 - d);
}

// The simplified four-point outline can replace a card corner with a nick.
// The long sides of the convex hull are the card edges. Their angle is the tilt.
export function tiltFromPoints(points) {
  if (!points || points.length < 2) return null;
  const ring = points.length > 4 ? hull(points) : points;
  if (ring.length < 2) return null;
  const edges = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    edges.push({ len, axis: axisDelta(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) });
  }
  if (!edges.length) return null;
  const longest = Math.max(...edges.map((edge) => edge.len));
  const kept = edges.filter((edge) => edge.len >= longest * 0.35);
  const use = (kept.length ? kept : edges).slice().sort((a, b) => a.axis - b.axis);
  let seen = 0;
  const total = use.reduce((sum, edge) => sum + edge.len, 0);
  for (const edge of use) {
    seen += edge.len;
    if (seen >= total / 2) return edge.axis;
  }
  return use[0].axis;
}

function lineFit(pts) {
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  const vx = sxx / n - mx * mx;
  const vy = syy / n - my * my;
  const vxy = sxy / n - mx * my;
  const ang = 0.5 * Math.atan2(2 * vxy, vx - vy);
  return { x: mx, y: my, ang };
}

function fittedQuad(points) {
  const ring = points.length > 4 ? hull(points) : points.slice();
  if (ring.length < 4) return null;
  const seeds = [
    ring.reduce((a, p) => (p.x + p.y < a.x + a.y ? p : a)),
    ring.reduce((a, p) => (p.x - p.y > a.x - a.y ? p : a)),
    ring.reduce((a, p) => (p.x + p.y > a.x + a.y ? p : a)),
    ring.reduce((a, p) => (p.x - p.y < a.x - a.y ? p : a)),
  ];
  if (new Set(seeds.map((p) => `${p.x},${p.y}`)).size < 4) return null;
  const sides = [[], [], [], []];
  for (let i = 0; i < 4; i++) sides[i].push(seeds[i], seeds[(i + 1) % 4]);
  for (const p of ring) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < 4; i++) {
      const a = seeds[i];
      const b = seeds[(i + 1) % 4];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const den = dx * dx + dy * dy || 1;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / den;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    sides[best].push(p);
  }
  if (sides.some((side) => side.length < 2)) return { tilt: null, corners: seeds };
  const lines = sides.map((side) => lineFit(side));
  const axes = lines.map((line) => axisDelta(line.ang * 180 / Math.PI)).sort((a, b) => a - b);
  // The tilt comes from the fitted sides. The corners stay the extreme pixels:
  // replacing them with the line crossings fixed one warp and broke another.
  return { tilt: (axes[1] + axes[2]) / 2, corners: seeds };
}

function orderQuad(pts) {
  const tl = pts.slice().sort((a, b) => a.x + a.y - (b.x + b.y))[0];
  const br = pts.slice().sort((a, b) => b.x + b.y - (a.x + a.y))[0];
  const tr = pts.slice().sort((a, b) => (b.x - b.y) - (a.x - a.y))[0];
  const bl = pts.slice().sort((a, b) => (a.x - a.y) - (b.x - b.y))[0];
  return [tl, tr, br, bl];
}

function solve8(a, b) {
  const n = 8;
  const m = a.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-8) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const div = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function homography(dest, src) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const x = dest[i].x;
    const y = dest[i].y;
    const u = src[i].x;
    const v = src[i].y;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve8(a, b);
  if (!h) return null;
  return h.concat([1]);
}

function sample(rgba, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [0, 0, 0, 255];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = rgba[(y0 * width + x0) * 4 + c];
    const b = rgba[(y0 * width + x1) * 4 + c];
    const d = rgba[(y1 * width + x0) * 4 + c];
    const e = rgba[(y1 * width + x1) * 4 + c];
    out[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
  }
  return out;
}

function warp(rgba, width, height, quad) {
  const dw = 500;
  const dh = 700;
  const dest = [{ x: 0, y: 0 }, { x: dw - 1, y: 0 }, { x: dw - 1, y: dh - 1 }, { x: 0, y: dh - 1 }];
  const h = homography(dest, quad);
  if (!h) return null;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const den = h[6] * x + h[7] * y + h[8];
      if (Math.abs(den) < 1e-8) return null;
      const sx = (h[0] * x + h[1] * y + h[2]) / den;
      const sy = (h[3] * x + h[4] * y + h[5]) / den;
      const px = sample(rgba, width, height, sx, sy);
      const i = (y * dw + x) * 4;
      out[i] = px[0];
      out[i + 1] = px[1];
      out[i + 2] = px[2];
      out[i + 3] = 255;
    }
  }
  return { width: dw, height: dh, rgba: out };
}

export function findQuad(rgba, width, height, longEdge = 480, minArea = 0.18, minBox = 0.12) {
  const scaled = scaleToLong(rgba, width, height, longEdge);
  const gray = blur5(grayOf(scaled.rgba, scaled.width, scaled.height), scaled.width, scaled.height);
  const frame = { gray, width: scaled.width, height: scaled.height, scale: scaled.scale };
  const { mag, max } = sobelMag(gray, scaled.width, scaled.height);
  if (max <= 0) return { found: false, reason: 'max', ...frame };
  const mask = edgeMask(mag, scaled.width, scaled.height, max);
  const comp = largestComponent(mask, scaled.width, scaled.height);
  if (comp.length < 80) return { found: false, reason: 'comp '+comp.length+' max '+max, ...frame };
  let minX = scaled.width;
  let minY = scaled.height;
  let maxX = 0;
  let maxY = 0;
  const pts = [];
  for (let n = 0; n < comp.length; n += 2) {
    const i = comp[n];
    const x = i % scaled.width;
    const y = (i - x) / scaled.width;
    pts.push({ x, y });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const box = (maxX - minX + 1) * (maxY - minY + 1);
  if (box < minBox * scaled.width * scaled.height) return { found: false, reason: 'box', ...frame };
  const ring = hull(pts);
  const fitted = fittedQuad(ring);
  let poly = fitted ? fitted.corners : ring;
  if (!fitted) {
    poly = ring;
    let epsilon = 2;
    for (let attempt = 0; attempt < 10 && poly.length !== 4; attempt++) {
      poly = dp(ring, epsilon);
      epsilon *= 1.55;
    }
  }
  if (poly.length !== 4) return { found: false, reason: 'poly '+poly.length, ...frame };
  let ordered = orderQuad(poly);
  const area = Math.abs(
    ordered.reduce((sum, p, i) => {
      const q = ordered[(i + 1) % 4];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );
  let spanW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  let spanH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  if (spanW > spanH) {
    ordered = [ordered[3], ordered[0], ordered[1], ordered[2]];
    spanW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
    spanH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  }
  const shape = Math.min(spanW, spanH) / (Math.max(spanW, spanH) || 1);
  const ratio = spanW / (spanH || 1);
  const quad = ordered.map((p) => ({ x: p.x / scaled.scale, y: p.y / scaled.scale }));
  const areaFrac = area / (scaled.width * scaled.height);
  const tilt = fitted ? fitted.tilt : null;
  if (area < minArea * scaled.width * scaled.height || shape < 0.5 || shape > 0.95) {
    return { found: false, reason: 'geom '+area+' '+shape, candidate: quad, areaFrac, ratio, tilt, ...frame };
  }
  return { found: true, quad, areaFrac, ratio, tilt, reason: '', ...frame };
}

function outerQuad(gray, width, height, scale) {
  const samples = [];
  for (let i = 2; i < 12; i++) {
    samples.push(gray[i * width + i]);
    samples.push(gray[i * width + (width - 1 - i)]);
    samples.push(gray[(height - 1 - i) * width + i]);
    samples.push(gray[(height - 1 - i) * width + (width - 1 - i)]);
  }
  const finite = samples.filter((n) => Number.isFinite(n));
  if (finite.length < 8) return null;
  finite.sort((a, b) => a - b);
  const bg = finite[finite.length >> 1];
  if (finite[finite.length - 1] - finite[0] > 36) return null;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - bg) >= 28) mask[i] = 1;
  const comp = largestComponent(mask, width, height);
  const area = comp.length;
  if (area < width * height * 0.05 || area > width * height * 0.9) return null;
  const pts = [];
  for (let n = 0; n < comp.length; n++) {
    const i = comp[n];
    const x = i % width;
    const y = (i - x) / width;
    const outside = x === 0 || y === 0 || x === width - 1 || y === height - 1
      || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width];
    if (outside) pts.push({ x, y });
  }
  if (pts.length < 16) return null;
  const fitted = fittedQuad(pts);
  const extreme = [
    pts.reduce((a, p) => (p.x + p.y < a.x + a.y ? p : a)),
    pts.reduce((a, p) => (p.x - p.y > a.x - a.y ? p : a)),
    pts.reduce((a, p) => (p.x + p.y > a.x + a.y ? p : a)),
    pts.reduce((a, p) => (p.x - p.y < a.x - a.y ? p : a)),
  ];
  let ordered = extreme;
  const edgeLen = (a, b) => Math.hypot(ordered[a].x - ordered[b].x, ordered[a].y - ordered[b].y);
  const top = edgeLen(1, 0);
  const right = edgeLen(2, 1);
  const bottom = edgeLen(3, 2);
  const left = edgeLen(0, 3);
  const sidesDiffer = Math.abs(top - bottom) / Math.max(top, bottom) > 0.2
    || Math.abs(left - right) / Math.max(left, right) > 0.2;
  let spanW = top;
  let spanH = left;
  if (spanW > spanH) {
    ordered = [ordered[3], ordered[0], ordered[1], ordered[2]];
    spanW = edgeLen(1, 0);
    spanH = edgeLen(0, 3);
  }
  const shape = Math.min(spanW, spanH) / (Math.max(spanW, spanH) || 1);
  if (shape < 0.55 || shape > 0.9 || spanW < 40 || spanH < 40 || sidesDiffer) return null;
  return {
    quad: ordered.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    tilt: fitted && Number.isFinite(fitted.tilt) ? fitted.tilt : null,
  };
}

export function quadPose(quad) {
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const edges = [0, 1, 2, 3].map((i) => angle(quad[i], quad[(i + 1) % 4]));
  const toAxis = (deg) => {
    let d = Math.abs(deg % 180);
    if (d > 90) d = 180 - d;
    return Math.min(d, 90 - d);
  };
  const parallelDelta = (a, b) => {
    let d = Math.abs(a - b) % 180;
    if (d > 90) d = 180 - d;
    return d;
  };
  const len = (i) => Math.hypot(quad[(i + 1) % 4].x - quad[i].x, quad[(i + 1) % 4].y - quad[i].y);
  const width = (len(0) + len(2)) / 2;
  const height = (len(1) + len(3)) / 2;
  const ratio = Math.min(width, height) / (Math.max(width, height) || 1);
  const tilts = edges.map(toAxis).slice().sort((a, b) => a - b);
  const opposite = Math.max(parallelDelta(edges[0], edges[2]), parallelDelta(edges[1], edges[3]));
  return {
    // The middle of the four edge angles. The straightest edge hides a real
    // rotation, and the worst edge is often a nicked corner, not the card.
    tilt: (tilts[1] + tilts[2]) / 2,
    minTilt: tilts[0],
    parallelDelta: opposite,
    parallel: opposite <= 3,
    ratio,
    aspectOk: Math.abs(ratio - 63 / 88) <= 0.08,
  };
}

export function straighten(rgba, width, height) {
  const located = findQuad(rgba, width, height, 480, 0.18);
  let paper = located.gray ? outerQuad(located.gray, located.width, located.height, located.scale) : null;
  if (paper && located.found && located.quad) {
    const mid = (pts) => ({
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
    });
    const a = mid(paper.quad);
    const b = mid(located.quad);
    const span = Math.hypot(located.quad[1].x - located.quad[0].x, located.quad[1].y - located.quad[0].y) || 1;
    if (Math.hypot(a.x - b.x, a.y - b.y) > span * 0.2) paper = null;
  }
  const quad = paper ? paper.quad : (located.found ? located.quad : null);
  const tiltHint = paper && paper.tilt != null ? paper.tilt : located.tilt;
  // A scan that already fills a portrait frame is the card. The printed frame
  // inside it is not a second outline, and stretching that line invents nicks.
  // A photo with a margin, or a landscape frame, is not this case: the card is
  // warped out of the picture instead. Centering still has to pass the same
  // pose checks as a warp. Scaling the picture does not make it flat.
  const outline = quad ? quadPose(quad) : null;
  if (outline && Number.isFinite(tiltHint)) outline.tilt = tiltHint;
  const bowed = borderBows(rgba, width, height);
  const marginBox = contentBounds(rgba, width, height);
  if (frameFilled(rgba, width, height)) {
    const pose = outline;
    let centeringOk = Boolean(pose) && pose.tilt <= 0.4 && centeringAllowed(pose) && !bowed;
    // A square or 3:4 frame is the card already. Stretching it to 500 by 700
    // bends the border into chips. Fit it and repeat the edge color instead.
    // Portrait scans stay on the plain scale. Letterboxing those hid planted
    // corner defects. A square or landscape frame is fitted so the border is
    // not stretched into a chip.
    const picture = maskRim(width >= height
      ? fitCard(rgba, width, height)
      : scaleToSize(rgba, width, height, 500, 700));
    return commitFlat(picture, pose, centeringOk, { paper: !!paper, quad, edgesOk: edgesReliable(pose, picture) });
  }
  // Gate on the chosen outline, not the first quad. On a Yu-Gi-Oh scan that
  // first quad is the inner print, a couple of degrees off and too small.
  const bounds = marginBox && outline && outline.tilt <= 1.5 && outline.parallel
    ? marginBox
    : null;
  if (bounds) {
    const bw = bounds.maxX - bounds.minX + 1;
    const bh = bounds.maxY - bounds.minY + 1;
    const ratio = Math.min(bw, bh) / Math.max(bw, bh);
    const pose = {
      tilt: outline.tilt,
      minTilt: outline.minTilt,
      parallelDelta: outline.parallelDelta,
      parallel: outline.parallel,
      ratio,
      aspectOk: Math.abs(ratio - 63 / 88) <= 0.08 && outline.aspectOk,
    };
    const centeringOk = pose.tilt <= 0.4 && centeringAllowed(pose) && !bowed;
    const picture = maskRim(scaleToSize(cropRect(rgba, width, height, bounds), bw, bh, 500, 700));
    return commitFlat(picture, pose, centeringOk, { paper: false, quad, edgesOk: edgesReliable(pose, picture) });
  }
  if (!quad) return { flattened: false, reason: located.reason || 'no card edge' };
  const pose = quadPose(quad);
  if (Number.isFinite(tiltHint)) pose.tilt = tiltHint;
  const warped = warp(rgba, width, height, quad);
  if (!warped) return { flattened: false, reason: 'warp', pose };
  // Corners, edges, and surface still use this straightened picture.
  // A centering number is refused when the card is rotated, the sides are not
  // parallel, or the outline's aspect is not the card's.
  const centeringOk = centeringAllowed(pose) && !bowed;
  let picture = maskRim(warped.rgba);
  const trimmed = contentBounds(picture, 500, 700);
  if (trimmed) {
    const tw = trimmed.maxX - trimmed.minX + 1;
    const th = trimmed.maxY - trimmed.minY + 1;
    picture = scaleToSize(cropRect(picture, 500, 700, trimmed), tw, th, 500, 700);
  }
  return commitFlat(picture, pose, centeringOk, {
    paper: !!paper,
    quad,
    edgesOk: edgesReliable(pose, picture),
  });
}

function edgesReliable(pose, picture) {
  // A resampled border grows a wedge that reads as a chip. Parallel sides can
  // still be a degree off, and that is enough to invent the wedge.
  if (pose && pose.parallel === false) return false;
  if (pose && pose.tilt > 1.2) return false;
  return !borderSlant(picture);
}

function borderSlant(rgba) {
  const grayAt = (x, y) => {
    const i = (y * 500 + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  function hit(edge, at) {
    const vertical = edge === 'left' || edge === 'right';
    const span = vertical ? 700 : 500;
    const t = Math.min(span - 2, Math.max(1, Math.round(span * at)));
    const edgeGray = vertical ? grayAt(edge === 'left' ? 1 : 498, t) : grayAt(t, edge === 'top' ? 1 : 698);
    for (let d = 2; d < 36; d++) {
      const x = edge === 'left' ? d : edge === 'right' ? 499 - d : t;
      const y = edge === 'top' ? d : edge === 'bottom' ? 699 - d : t;
      if (Math.abs(grayAt(x, y) - edgeGray) > 28) return d;
    }
    return 36;
  }
  return ['top', 'bottom', 'left', 'right'].some((edge) => Math.abs(hit(edge, 0.2) - hit(edge, 0.8)) > 6);
}

function refusingPose(pose) {
  return {
    tilt: 90,
    minTilt: 90,
    parallelDelta: 90,
    parallel: false,
    ratio: pose && Number.isFinite(pose.ratio) ? pose.ratio : 0,
    aspectOk: false,
  };
}

function commitFlat(rgba, pose, centeringOk, extra) {
  rememberPose(grayOf(rgba, 500, 700), centeringOk ? pose : refusingPose(pose));
  return {
    flattened: true,
    width: 500,
    height: 700,
    rgba,
    pose,
    centeringOk,
    reason: centeringOk ? '' : 'rotated',
    ...extra,
  };
}

// A barrel bend bows the middle of an edge away from the straight line
// through its ends. Four corners can still look flat. That bend is refused.
function borderBows(rgba, width, height) {
  const grayAt = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  function bow(edge) {
    const vertical = edge === 'left' || edge === 'right';
    const span = vertical ? height : width;
    const depth = vertical ? width : height;
    const samples = [];
    for (let f = 0.12; f <= 0.88; f += 0.08) {
      const t = Math.min(span - 2, Math.max(1, Math.round(span * f)));
      const ex = edge === 'left' ? 1 : edge === 'right' ? width - 2 : t;
      const ey = edge === 'top' ? 1 : edge === 'bottom' ? height - 2 : t;
      const edgeGray = vertical ? grayAt(ex, t) : grayAt(t, ey);
      let hit = Math.max(4, Math.round(depth * 0.12));
      for (let d = 2; d < hit; d++) {
        const x = edge === 'left' ? d : edge === 'right' ? width - 1 - d : t;
        const y = edge === 'top' ? d : edge === 'bottom' ? height - 1 - d : t;
        if (Math.abs(grayAt(x, y) - edgeGray) > 22) {
          hit = d;
          break;
        }
      }
      samples.push(hit);
    }
    if (samples.length < 5) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    let max = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      const expected = first + (last - first) * (i / (samples.length - 1));
      max = Math.max(max, Math.abs(samples[i] - expected));
    }
    return max / depth;
  }
  return ['left', 'right', 'top', 'bottom'].some((edge) => bow(edge) > 0.012);
}

function maskRim(rgba) {
  const width = 500;
  const height = 700;
  const rim = 3;
  const out = new Uint8ClampedArray(rgba);
  const gray = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const copyRow = (y, sy) => {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      const si = (sy * width + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  };
  const copyCol = (x, sx) => {
    for (let y = 0; y < height; y++) {
      const di = (y * width + x) * 4;
      const si = (y * width + sx) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  };
  // A scanner rim is dark along the whole side. A chip or white corner is not.
  for (let y = 0; y < rim; y++) {
    const edge = [];
    const inner = [];
    for (let x = 0; x < width; x += 4) {
      edge.push(gray(x, y));
      inner.push(gray(x, rim));
    }
    if (median(edge) < median(inner) - 28) copyRow(y, rim);
  }
  for (let y = height - rim; y < height; y++) {
    const edge = [];
    const inner = [];
    for (let x = 0; x < width; x += 4) {
      edge.push(gray(x, y));
      inner.push(gray(x, height - 1 - rim));
    }
    if (median(edge) < median(inner) - 28) copyRow(y, height - 1 - rim);
  }
  for (let x = 0; x < rim; x++) {
    const edge = [];
    const inner = [];
    for (let y = 0; y < height; y += 4) {
      edge.push(gray(x, y));
      inner.push(gray(rim, y));
    }
    if (median(edge) < median(inner) - 28) copyCol(x, rim);
  }
  for (let x = width - rim; x < width; x++) {
    const edge = [];
    const inner = [];
    for (let y = 0; y < height; y += 4) {
      edge.push(gray(x, y));
      inner.push(gray(width - 1 - rim, y));
    }
    if (median(edge) < median(inner) - 28) copyCol(x, width - 1 - rim);
  }
  return out;
}

// How far the middle of one side stays the edge color, as a fraction of that
// side's depth. A real card border is short on at least three sides. A margin
// around the card pushes the change inward on the sides it covers.
function sideInset(rgba, width, height, edge) {
  const grayAt = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  const vertical = edge === 'left' || edge === 'right';
  const span = vertical ? height : width;
  const depth = vertical ? width : height;
  const hits = [];
  const start = Math.floor(span * 0.4);
  const end = Math.floor(span * 0.6);
  const limit = Math.max(4, Math.round(depth * 0.15));
  for (let t = start; t < end; t += 3) {
    const ex = edge === 'left' ? 1 : edge === 'right' ? width - 2 : t;
    const ey = edge === 'top' ? 1 : edge === 'bottom' ? height - 2 : t;
    const edgeGray = vertical ? grayAt(ex, t) : grayAt(t, ey);
    let hit = limit;
    for (let d = 2; d < limit; d++) {
      const x = edge === 'left' ? d : edge === 'right' ? width - 1 - d : t;
      const y = edge === 'top' ? d : edge === 'bottom' ? height - 1 - d : t;
      if (Math.abs(grayAt(x, y) - edgeGray) > 22) {
        hit = d;
        break;
      }
    }
    hits.push(hit / depth);
  }
  if (!hits.length) return 1;
  hits.sort((a, b) => a - b);
  return hits[Math.floor(hits.length / 2)];
}

function frameFilled(rgba, width, height) {
  if (width < 40 || height < 40) return false;
  const sides = ['left', 'right', 'top', 'bottom'].map((edge) => sideInset(rgba, width, height, edge));
  if (sides.some((value) => value >= 0.08)) return false;
  const near = sides.filter((value) => value <= 0.045).length;
  // A printed border is a couple of percent. Four percent of padding was still
  // accepted, and scaling that padding invented edge chips. A real scan can
  // have one deeper side, so three sides have to be this close. Landscape and
  // square photos count too: the card is the frame, it is just not portrait.
  if (height > width) return near >= 3;
  return near >= 4;
}

function fitCard(rgba, width, height) {
  const scale = Math.min(500 / width, 700 / height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const fitted = scaleToSize(rgba, width, height, dw, dh);
  const out = new Uint8ClampedArray(500 * 700 * 4);
  const ox = Math.floor((500 - dw) / 2);
  const oy = Math.floor((700 - dh) / 2);
  for (let y = 0; y < 700; y++) {
    const sy = Math.min(dh - 1, Math.max(0, y - oy));
    for (let x = 0; x < 500; x++) {
      const sx = Math.min(dw - 1, Math.max(0, x - ox));
      const di = (y * 500 + x) * 4;
      const si = (sy * dw + sx) * 4;
      out[di] = fitted[si];
      out[di + 1] = fitted[si + 1];
      out[di + 2] = fitted[si + 2];
      out[di + 3] = fitted[si + 3];
    }
  }
  return out;
}

function cropRect(rgba, width, height, box) {
  const bw = box.maxX - box.minX + 1;
  const bh = box.maxY - box.minY + 1;
  const out = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    out.set(rgba.subarray(((box.minY + y) * width + box.minX) * 4, ((box.minY + y) * width + box.minX) * 4 + bw * 4), y * bw * 4);
  }
  return out;
}

function contentBounds(rgba, width, height) {
  const grayAt = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  const corners = [grayAt(1, 1), grayAt(width - 2, 1), grayAt(1, height - 2), grayAt(width - 2, height - 2)];
  if (Math.max(...corners) - Math.min(...corners) > 24) return null;
  const bg = corners.slice().sort((a, b) => a - b)[1];
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 100));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (Math.abs(grayAt(x, y) - bg) < 18) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 30) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < width * 0.45 || bh < height * 0.45) return null;
  if (minX <= 1 && minY <= 1 && maxX >= width - 2 && maxY >= height - 2) return null;
  const margins = [minX, minY, width - 1 - maxX, height - 1 - maxY];
  if (Math.max(...margins) - Math.min(...margins) > Math.max(12, 0.03 * Math.min(width, height))) return null;
  function fill(edge) {
    let hit = 0;
    let total = 0;
    const vertical = edge === 'left' || edge === 'right';
    const span = vertical ? bh : bw;
    for (let t = 0; t < span; t += Math.max(1, Math.floor(span / 24))) {
      const x = edge === 'left' ? minX : edge === 'right' ? maxX : minX + t;
      const y = edge === 'top' ? minY : edge === 'bottom' ? maxY : minY + t;
      total += 1;
      if (Math.abs(grayAt(Math.min(width - 1, x), Math.min(height - 1, y)) - bg) > 18) hit += 1;
    }
    return total ? hit / total : 0;
  }
  const fills = ['left', 'right', 'top', 'bottom'].map(fill);
  let box = { minX, minY, maxX, maxY };
  if (fills.filter((value) => value < 0.5).length >= 3) {
    const growX = Math.min(Math.round(bw * 0.035), Math.max(0, Math.min(minX, width - 1 - maxX) - 2));
    const growY = Math.min(Math.round(bh * 0.035), Math.max(0, Math.min(minY, height - 1 - maxY) - 2));
    box = { minX: minX - growX, minY: minY - growY, maxX: maxX + growX, maxY: maxY + growY };
  }
  return box;
}

function scaleToSize(rgba, width, height, dw, dh) {
  if (width === dw && height === dh) return rgba;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(height - 1, (y + 0.5) * height / dh - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(width - 1, (x + 0.5) * width / dw - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const i = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = rgba[(y0 * width + x0) * 4 + c];
        const b = rgba[(y0 * width + x1) * 4 + c];
        const d = rgba[(y1 * width + x0) * 4 + c];
        const e = rgba[(y1 * width + x1) * 4 + c];
        out[i + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  return out;
}

// A 2° quad on an official card still invented a top/bottom number the flat
// read did not have. Anything steeper stays unreadable. Opposite edges that
// diverge by more than 3°, or a quad whose shape is not a trading card, are
// the same kind of bad outline.
function centeringAllowed(pose) {
  if (!pose) return false;
  // At 0.8° an official card still grew a top/bottom number the flat scan did
  // not have. A perspective warp that changes the outline's aspect does the
  // same thing, so that shape is not forced into a card rectangle.
  const aspectChanged = Math.abs(pose.ratio - 63 / 88) > 0.04;
  return pose.tilt <= 0.75 && pose.parallel && pose.aspectOk && !aspectChanged;
}

const poseByPrint = new Map();

function printOf(gray) {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < gray.length; i += 64) {
    const v = gray[i] | 0;
    h1 ^= v;
    h1 = Math.imul(h1, 16777619);
    h2 ^= v + i;
    h2 = Math.imul(h2, 2246822519);
  }
  return `${h1}:${h2}:${gray.length}`;
}

function rememberPose(gray, pose) {
  poseByPrint.set(printOf(gray), pose);
}

function median(nums) {
  const sorted = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

function borderRun(gray, width, height, side, fixed) {
  const limit = 64;
  const at = (step) => {
    if (side === 'left') return gray[fixed * width + step];
    if (side === 'right') return gray[fixed * width + (width - 1 - step)];
    if (side === 'top') return gray[step * width + fixed];
    return gray[(height - 1 - step) * width + fixed];
  };
  const samples = [];
  for (let step = 0; step < limit; step++) {
    const v = at(step);
    if (!Number.isFinite(v)) return null;
    samples.push(v);
  }
  const blur = samples.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= samples.length) continue;
      sum += samples[j];
      n += 1;
    }
    return sum / n;
  });
  // A light paper border ends where the artwork drops away. Its width is the
  // printed margin, whether or not a sliver of table is still inside the outline.
  let bandStart = null;
  for (let step = 0; step < 8; step++) if (blur[step] > 175) { bandStart = step; break; }
  if (bandStart != null) {
    const level = blur[bandStart];
    for (let step = bandStart + 6; step < blur.length - 1; step++) {
      if (blur[step] < level - 45 && blur[step + 1] < level - 35) return step - bandStart;
    }
  }
  const start = blur[2];
  let trough = null;
  let troughVal = start;
  for (let step = 6; step < 34; step++) {
    if (blur[step] < troughVal) {
      troughVal = blur[step];
      trough = step;
    }
  }
  const rose = trough != null && blur[Math.min(blur.length - 1, trough + 5)] - troughVal >= 20;
  const head = blur.slice(0, 8);
  const flatTable = Math.max(...head) - Math.min(...head) < 28 && start < 150;
  // A table photo is flat and darker than the card, then a light paper band, then the art.
  // The printed border is the band. A scanned card fades instead, and its trough is the edge.
  if (flatTable) {
    let bandStart = null;
    for (let step = 4; step < 24; step++) if (blur[step] > 170) { bandStart = step; break; }
    if (bandStart != null) {
      let bandEnd = null;
      for (let step = bandStart + 8; step < blur.length - 1; step++) {
        if (blur[step] < 90 && blur[Math.min(blur.length - 1, step + 2)] < 70) { bandEnd = step; break; }
      }
      if (bandEnd != null && bandEnd - bandStart >= 10 && bandEnd - bandStart <= 56) return bandEnd - bandStart;
    }
  }
  if (trough != null && trough >= 8 && start - troughVal >= 30 && rose) return trough;
  const jumps = [];
  for (let step = 5; step < blur.length - 4; step++) {
    const before = blur[step - 3];
    const after = blur[step + 2];
    const delta = after - before;
    if (Math.abs(delta) < 26) continue;
    if (Math.abs(blur[step + 4] - after) > 16) continue;
    if (jumps.length && step < jumps[jumps.length - 1] + 6) continue;
    jumps.push(step);
    if (jumps.length === 2) break;
  }
  const first = jumps[0];
  const second = jumps[1];
  if (first != null && second != null && second - first >= 10 && second - first <= 56) {
    const mid = blur[(first + second) >> 1];
    const before = blur[Math.max(0, first - 3)];
    const after = blur[Math.min(blur.length - 1, second + 3)];
    // Table, then a light paper band, then the art. Report the band, which is the
    // printed border. A fade into the card does not look like this.
    if (mid > 160 && mid > before + 25 && mid > after + 25 && Math.abs(start - before) < 22) {
      return second - first;
    }
  }
  return first ?? null;
}

export function measureCentering(gray, width, height) {
  if (!gray || width !== 500 || height !== 700 || gray.length < width * height) return null;
  const pose = poseByPrint.get(printOf(gray));
  if (pose && !centeringAllowed(pose)) return null;
  const strict = !!pose;
  function axis(sideA, sideB, horizontal) {
    const fracs = [0.2, 0.35, 0.5, 0.65, 0.8];
    const lefts = [];
    const rights = [];
    const pairs = [];
    for (const frac of fracs) {
      const fixed = Math.round((horizontal ? height : width) * frac);
      const a = borderRun(gray, width, height, sideA, Math.min(fixed, (horizontal ? height : width) - 1));
      const b = borderRun(gray, width, height, sideB, Math.min(fixed, (horizontal ? height : width) - 1));
      if (a != null) lefts.push(a);
      if (b != null) rights.push(b);
      if (a != null && b != null && a + b > 0) pairs.push({ a, b, pct: (a / (a + b)) * 100 });
    }
    if (lefts.length < 3 || rights.length < 3) return null;
    const leftSpread = Math.max(...lefts) - Math.min(...lefts);
    const rightSpread = Math.max(...rights) - Math.min(...rights);
    // Warp noise is a few pixels. A border that wanders by more than 12 is unreadable.
    if (leftSpread > 12 || rightSpread > 12) return null;
    let chosen = pairs;
    // After a warp, four of the five lines have to agree within 3 points.
    // Three lines can agree on a border the other two do not see.
    if (strict) {
      if (pairs.length < 4) return null;
      const sorted = pairs.slice().sort((p, q) => p.pct - q.pct);
      let best = [];
      for (let i = 0; i < sorted.length; i++) {
        const group = [];
        for (let j = i; j < sorted.length; j++) {
          if (sorted[j].pct - sorted[i].pct <= 3) group.push(sorted[j]);
          else break;
        }
        if (group.length > best.length) best = group;
      }
      if (best.length < 4) return null;
      chosen = best;
    }
    const left = median(strict ? chosen.map((pair) => pair.a) : lefts);
    const right = median(strict ? chosen.map((pair) => pair.b) : rights);
    if (left == null || right == null || left < 3 || right < 3) return null;
    const sum = left + right;
    return [(left / sum) * 100, (right / sum) * 100];
  }
  const lr = axis('left', 'right', true);
  let tb = axis('top', 'bottom', false);
  const frame = printedFrame(gray, width, height);
  if (frame) tb = null;
  if (!lr && !tb && !frame) return null;
  const bits = [];
  if (lr) bits.push(`${lr[0].toFixed(1)}/${lr[1].toFixed(1)} left/right`);
  if (tb) bits.push(`${tb[0].toFixed(1)}/${tb[1].toFixed(1)} top/bottom`);
  const note = frame ? ' Top/bottom is the printed frame in this picture, so it is not measured.' : '';
  if (!bits.length) return `Centering:${note}`;
  return `Centering: ${bits.join('. ')}.${note}`;
}

export function estimateBorders(gray, width, height) {
  if (!gray || width < 40 || height < 40 || gray.length < width * height) return null;
  function side(name, horizontal) {
    const span = horizontal ? height : width;
    const vals = [];
    for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const found = borderRun(gray, width, height, name, Math.min(span - 1, Math.round(span * frac)));
      if (found != null) vals.push(found);
    }
    if (vals.length < 3) return null;
    if (Math.max(...vals) - Math.min(...vals) > 12) return null;
    return median(vals);
  }
  const left = side('left', true);
  const right = side('right', true);
  const top = side('top', false);
  const bottom = side('bottom', false);
  if (left == null || right == null || top == null || bottom == null) return null;
  return { left, right, top, bottom };
}

function printedFrame(gray, width, height) {
  const x = Math.floor(width / 2);
  const top = gray[width + x] - gray[12 * width + x];
  const bottom = gray[(height - 2) * width + x] - gray[(height - 13) * width + x];
  // The picture is cropped to the card, so the number is the shared printed
  // frame, not a separate physical edge photographed on a table.
  return top > 28 && bottom > 28;
}

function offCenter(text, axis) {
  const re = axis === 'lr'
    ? /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/
    : /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/;
  const m = String(text || '').match(re);
  if (!m) return null;
  return Math.max(Number(m[1]), Number(m[2]));
}

function centeringScore(off, back) {
  if (off == null) return null;
  const cuts = back ? [[75, 10], [90, 9]] : [[55, 10], [60, 9], [65, 8], [70, 7], [80, 6], [85, 5], [90, 3]];
  for (const [max, score] of cuts) if (off <= max) return score;
  return back ? 3 : 1;
}

function stddev(vals) {
  if (!vals.length) return 0;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}

function unavailableMarks(note) {
  return {
    centering: { score: null, note },
    corners: { score: null, note },
    edges: { score: null, note },
    surface: { score: null, note },
  };
}

export function gradeSide(gray, width, height, centeringText, flattened, back = false) {
  if (!flattened) {
    return {
      centering: { score: null, note: centeringText ? centeringText.replace(/^Centering: /, '').replace(/\.$/, '') : 'Tilted. Not checked.' },
      corners: { score: null, note: 'Tilted. Not checked.' },
      edges: { score: null, note: 'Tilted. Not checked.' },
      surface: { score: null, note: 'Tilted. Not checked.' },
    };
  }
  if (!gray || width < 40 || height < 40 || gray.length < width * height) return unavailableMarks('Unavailable.');
  for (let i = 0; i < gray.length; i += 47) {
    if (!Number.isFinite(gray[i])) return unavailableMarks('Unavailable.');
  }
  const lr = offCenter(centeringText, 'lr');
  const tb = offCenter(centeringText, 'tb');
  const worse = lr == null && tb == null ? null : Math.max(lr || 0, tb || 0);
  const centering = worse == null
    ? { score: null, note: 'Centering could not be read.' }
    : { score: centeringScore(worse, back), note: `Left/right ${lr == null ? '—' : `${Math.min(100 - lr, lr).toFixed(1)}/${Math.max(lr, 100 - lr).toFixed(1)}`} · Top/bottom ${tb == null ? '—' : `${Math.min(100 - tb, tb).toFixed(1)}/${Math.max(tb, 100 - tb).toFixed(1)}`}` };
  // The note must use the measured pair, larger number second is not required.
  // Rebuild from the raw text when both pairs exist.
  if (lr != null && tb != null) {
    const lm = centeringText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/);
    const tm = centeringText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/);
    centering.note = `Left/right ${lm[1]}/${lm[2]} · Top/bottom ${tm[1]}/${tm[2]}`;
    centering.score = centeringScore(Math.max(lr, tb), back);
  }
  const side = Math.min(width, height);
  const box = Math.max(8, Math.round(side * 0.04));
  function mean(x0, y0) {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y0 + box && y < height; y++) {
      for (let x = x0; x < x0 + box && x < width; x++) {
        s += gray[y * width + x];
        n++;
      }
    }
    return n ? s / n : 0;
  }
  const corners = {
    'top-left': mean(0, 0),
    'top-right': mean(width - box, 0),
    'bottom-left': mean(0, height - box),
    'bottom-right': mean(width - box, height - box),
  };
  const edgesM = [
    mean(Math.floor(width / 2) - box / 2, 0),
    mean(Math.floor(width / 2) - box / 2, height - box),
    mean(0, Math.floor(height / 2) - box / 2),
    mean(width - box, Math.floor(height / 2) - box / 2),
  ];
  const edgeMed = edgesM.slice().sort((a, b) => a - b)[Math.floor(edgesM.length / 2)];
  let lost = 'top-left';
  let lightest = -1;
  for (const [name, value] of Object.entries(corners)) {
    if (value > lightest) {
      lightest = value;
      lost = name;
    }
  }
  const cornerValues = Object.values(corners).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const second = cornerValues.length > 1 ? cornerValues[cornerValues.length - 2] : lightest;
  const standsOut = Number.isFinite(lightest) && lightest - second >= 18;
  const lift = lightest - edgeMed;
  const cornerCuts = [[6, 10], [12, 9], [20, 8], [30, 7], [42, 6]];
  let cornerScore = 10;
  let cornerNote = 'No corner whitening seen.';
  if (standsOut) {
    cornerScore = 5;
    for (const [max, score] of cornerCuts) if (lift <= max) { cornerScore = score; break; }
    cornerNote = lift <= 6 ? 'No corner whitening seen.' : `Whitening on the ${lost} corner.`;
  }
  const cornersMark = { score: cornerScore, note: cornerNote };
  const band = Math.max(6, Math.round(side * 0.025));
  const skip = Math.round(side * 0.06);
  function edgeStd(name) {
    const vals = [];
    if (name === 'top' || name === 'bottom') {
      const y0 = name === 'top' ? 0 : height - band;
      for (let y = y0; y < y0 + band; y++) {
        for (let x = skip; x < width - skip; x++) vals.push(gray[y * width + x]);
      }
    } else {
      const x0 = name === 'left' ? 0 : width - band;
      for (let y = skip; y < height - skip; y++) {
        for (let x = x0; x < x0 + band; x++) vals.push(gray[y * width + x]);
      }
    }
    return stddev(vals);
  }
  const edgeNames = ['top', 'bottom', 'left', 'right'];
  const noises = edgeNames.map((name) => edgeStd(name));
  const noiseOrder = noises.slice().sort((a, b) => a - b);
  const noiseMid = noiseOrder[Math.floor(noiseOrder.length / 2)] || 0;
  let noisy = 'top';
  let noise = -1;
  for (let i = 0; i < edgeNames.length; i++) {
    if (noises[i] > noise) {
      noise = noises[i];
      noisy = edgeNames[i];
    }
  }
  const edgeCuts = [[10, 10], [16, 9], [24, 8], [34, 7], [48, 6]];
  let edgeScore = 10;
  let edgeNote = 'Edges look clean.';
  // A printed border is noisy on every side. Whitening is one side standing out.
  if (noise - noiseMid >= 14) {
    edgeScore = 5;
    for (const [max, score] of edgeCuts) if (noise <= max) { edgeScore = score; break; }
    edgeNote = `Possible whitening on the ${noisy} edge.`;
  }
  const edgesMark = { score: edgeScore, note: edgeNote };
  const crease = thinCrease(gray, width, height);
  let surface;
  if (crease) surface = { score: 6, note: `Possible crease on the ${crease}` };
  else if (specularGlare(gray, width, height)) surface = { score: 8, note: 'Glare. Surface is partly hidden.' };
  else surface = { score: 10, note: 'Surface looks clear. Fine scratches can be missed.' };
  return { centering, corners: cornersMark, edges: edgesMark, surface };
}

function thinCrease(gray, width, height) {
  const x0 = Math.floor(width * 0.08);
  const x1 = Math.floor(width * 0.92);
  const y0 = Math.floor(height * 0.18);
  const y1 = Math.floor(height * 0.45);
  if (x1 - x0 < 40 || y1 <= y0 + 8) return null;
  for (let y = y0; y < y1; y++) {
    let run = 0;
    let best = 0;
    let start = 0;
    let bestStart = 0;
    for (let x = x0; x < x1; x++) {
      if (gray[y * width + x] < 32) {
        if (!run) start = x;
        run += 1;
        if (run > best) {
          best = run;
          bestStart = start;
        }
      } else run = 0;
    }
    // A crease is a long thin bar that stops before the card edge. A printed
    // frame line runs into the border, so it has no lighter margin on both sides.
    if (best < width * 0.4 || best > width * 0.72) continue;
    const left = gray[y * width + Math.max(0, bestStart - 6)];
    const right = gray[y * width + Math.min(width - 1, bestStart + best + 6)];
    if (left < 48 || right < 48) continue;
    const cx = bestStart + (best >> 1);
    const mid = gray[y * width + cx];
    const up = gray[(y - 6) * width + cx];
    const down = gray[(y + 6) * width + cx];
    // One side of a thin bar is the picture. Both sides of a dark picture are dark.
    if (Math.max(up, down) - mid < 8) continue;
    return 'middle';
  }
  return null;
}

function specularGlare(gray, width, height) {
  const x0 = Math.floor(width * 0.12);
  const x1 = Math.floor(width * 0.88);
  const y0 = Math.floor(height * 0.12);
  const y1 = Math.floor(height * 0.88);
  const hot = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (gray[y * width + x] > 242) hot[y * width + x] = 1;
  }
  const seen = new Uint8Array(hot.length);
  const minCount = Math.floor(width * height * 0.02);
  const maxCount = Math.floor(width * height * 0.22);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const start = y * width + x;
      if (!hot[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let count = 0;
      let bright = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length) {
        const cur = stack.pop();
        count += 1;
        bright += gray[cur];
        const cx = cur % width;
        const cy = (cur - cx) / width;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const n of [cur - 1, cur + 1, cur - width, cur + width]) {
          if (n < 0 || n >= hot.length || seen[n] || !hot[n]) continue;
          const nx = n % width;
          if (Math.abs(nx - cx) > 1) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const boxW = maxX - minX + 1;
      const boxH = maxY - minY + 1;
      const fill = count / (boxW * boxH);
      // Printed art is an irregular bright shape. A glare wash fills its own box.
      if (count < minCount || count > maxCount || fill < 0.72) continue;
      let around = 0;
      let aroundN = 0;
      const yA = Math.max(0, minY - 8);
      const yB = Math.min(height - 1, maxY + 8);
      const xA = Math.max(0, minX - 8);
      const xB = Math.min(width - 1, maxX + 8);
      for (let yy = yA; yy <= yB; yy += 2) {
        for (let xx = xA; xx <= xB; xx += 2) {
          if (xx >= minX && xx <= maxX && yy >= minY && yy <= maxY) continue;
          around += gray[yy * width + xx];
          aroundN += 1;
        }
      }
      if (aroundN && bright / count - around / aroundN > 50) return true;
    }
  }
  return false;
}

export function gradePhoto({ front, back, frontBack }) {
  const marks = { front: front.marks, back: back ? back.marks : null };
  const nums = [];
  for (const side of [front.marks, back && back.marks]) {
    if (!side) continue;
    for (const key of ['centering', 'corners', 'edges', 'surface']) {
      if (side[key] && side[key].score != null) nums.push({ key, score: side[key].score, side: side === front.marks ? 'front' : 'back' });
    }
  }
  const notes = [];
  if (!front.flattened) notes.push('Front is tilted, so centering may be off');
  if (frontBack && !back) notes.push('No back photo. Back centering is not checked');
  if (front.marks.surface && front.marks.surface.note.startsWith('Possible crease')) notes.push(`Front: ${front.marks.surface.note}`);
  if (front.marks.centering && front.marks.centering.score == null && front.flattened) notes.push('Front centering could not be read');
  if (!notes.length) notes.push('Photo looks clean enough to grade.');
  if (!nums.length) {
    return { headline: '', detail: 'Photo estimate only, not a PSA grade.', notes, marks, range: null };
  }
  const top = Math.min(...nums.map((n) => n.score));
  const missing = !back || ['centering', 'corners', 'edges', 'surface'].some((key) => {
    const mark = (back && back.marks[key]) || front.marks[key];
    return !mark || mark.score == null;
  });
  const bottom = Math.max(1, top - (missing ? 2 : 1));
  const high = Math.max(bottom, top);
  const low = Math.min(bottom, top);
  const headline = `Estimate: PSA ${low}–${high} (${NAMES[low]} to ${NAMES[high]}).`;
  const limiters = nums.filter((n) => n.score === top).slice(0, 2).map((n) => `${n.side} ${n.key}`);
  const detail = `Limited by ${limiters.join(' and ') || 'the photo'}. Photo estimate only, not a PSA grade.`;
  const half = low !== high && high - low === 1 ? `About ${(low + high) / 2}. PSA has no half grades.` : '';
  return { headline, half, detail, notes, marks, range: [low, high] };
}

export function catalogImage(url) {
  const value = String(url || '').trim();
  if (!value || /icon-192\.png|icon-512\.png/i.test(value)) return null;
  if (value.includes('fixture-art')) return value;
  let host = '';
  try { host = new URL(value).hostname; } catch { return null; }
  if (host === 'images.ygoprodeck.com' || host.endsWith('.ygoprodeck.com') || host.endsWith('scryfall.io')) return value;
  return null;
}

export function rowsFromCardInfo(code, info) {
  const want = String(code || '').replace(/\s+/g, '').toLowerCase();
  const rows = [];
  const cards = Array.isArray(info) ? info : (info && info.data ? info.data : [info]);
  for (const card of cards) {
    if (!card || !Array.isArray(card.card_sets)) continue;
    for (const set of card.card_sets) {
      const got = String(set.set_code || '').replace(/\s+/g, '').toLowerCase();
      if (got !== want) continue;
      rows.push({
        name: card.name,
        setName: set.set_name,
        code: set.set_code,
        number: set.set_code,
        text: card.desc || '',
        rarity: set.set_rarity,
        price: positiveGuide(set.set_price),
        id: card.id,
        image: catalogImage(card.card_images && card.card_images[0] ? card.card_images[0].image_url : null),
      });
    }
  }
  return rows;
}
