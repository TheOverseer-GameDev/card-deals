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

export function straighten(rgba, width, height) {
  const scaled = scaleToLong(rgba, width, height, 480);
  const gray = blur5(grayOf(scaled.rgba, scaled.width, scaled.height), scaled.width, scaled.height);
  const { mag, max } = sobelMag(gray, scaled.width, scaled.height);
  if (max <= 0) return { flattened: false, reason: 'max' };
  const mask = edgeMask(mag, scaled.width, scaled.height, max);
  const comp = largestComponent(mask, scaled.width, scaled.height);
  if (comp.length < 80) return { flattened: false, reason: 'comp '+comp.length+' max '+max };
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
  if (box < 0.12 * scaled.width * scaled.height) return { flattened: false, reason: 'box' };
  const ring = hull(pts);
  let poly = ring;
  let epsilon = 2;
  for (let attempt = 0; attempt < 10 && poly.length !== 4; attempt++) {
    poly = dp(ring, epsilon);
    epsilon *= 1.55;
  }
  if (poly.length !== 4) return { flattened: false, reason: 'poly '+poly.length };
  const ordered = orderQuad(poly);
  const area = Math.abs(
    ordered.reduce((sum, p, i) => {
      const q = ordered[(i + 1) % 4];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );
  const spanW = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const spanH = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const ratio = spanW / (spanH || 1);
  if (area < 0.18 * scaled.width * scaled.height || ratio < 0.5 || ratio > 0.95) return { flattened: false, reason: 'geom '+area+' '+ratio };
  const full = ordered.map((p) => ({ x: p.x / scaled.scale, y: p.y / scaled.scale }));
  const warped = warp(rgba, width, height, full);
  if (!warped) return { flattened: false, reason: 'warp' };
  return { flattened: true, width: 500, height: 700, rgba: warped.rgba };
}

export function measureCentering(gray, width, height) {
  if (width !== 500 || height !== 700) return null;
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] > 60 ? 255 : 0;
  function walk(horizontal) {
    const mid = horizontal ? Math.floor(height / 2) : Math.floor(width / 2);
    const limit = horizontal ? Math.floor(width / 2) : Math.floor(height / 2);
    const edge = horizontal ? bin[mid * width] : bin[mid];
    let left = 0;
    for (let i = 0; i < limit; i++) {
      const v = horizontal ? bin[mid * width + i] : bin[i * width + mid];
      if (v !== edge) {
        left = i;
        break;
      }
    }
    let right = 0;
    for (let i = 0; i < limit; i++) {
      const v = horizontal ? bin[mid * width + (width - 1 - i)] : bin[(height - 1 - i) * width + mid];
      if (v !== edge) {
        right = i;
        break;
      }
    }
    if (left < 5 || left > 80 || right < 5 || right > 80) return null;
    return [left, right];
  }
  const lr = walk(true);
  const tb = walk(false);
  if (!lr && !tb) return null;
  const part = (pair) => {
    if (!pair) return null;
    const sum = pair[0] + pair[1];
    return [((pair[0] / sum) * 100), ((pair[1] / sum) * 100)];
  };
  const a = part(lr);
  const b = part(tb);
  const bits = [];
  if (a) bits.push(`${a[0].toFixed(1)}/${a[1].toFixed(1)} left/right`);
  if (b) bits.push(`${b[0].toFixed(1)}/${b[1].toFixed(1)} top/bottom`);
  return `Centering: ${bits.join('. ')}.`;
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

export function gradeSide(gray, width, height, centeringText, flattened, back = false) {
  if (!flattened) {
    return {
      centering: { score: null, note: centeringText ? centeringText.replace(/^Centering: /, '').replace(/\.$/, '') : 'Tilted. Not checked.' },
      corners: { score: null, note: 'Tilted. Not checked.' },
      edges: { score: null, note: 'Tilted. Not checked.' },
      surface: { score: null, note: 'Tilted. Not checked.' },
    };
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
  const lift = lightest - edgeMed;
  const cornerCuts = [[6, 10], [12, 9], [20, 8], [30, 7], [42, 6]];
  let cornerScore = 5;
  for (const [max, score] of cornerCuts) if (lift <= max) { cornerScore = score; break; }
  const cornersMark = {
    score: cornerScore,
    note: lift <= 6 ? 'No corner whitening seen.' : `Whitening on the ${lost} corner.`,
  };
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
  let noisy = 'top';
  let noise = -1;
  for (const name of edgeNames) {
    const v = edgeStd(name);
    if (v > noise) {
      noise = v;
      noisy = name;
    }
  }
  const edgeCuts = [[10, 10], [16, 9], [24, 8], [34, 7], [48, 6]];
  let edgeScore = 5;
  for (const [max, score] of edgeCuts) if (noise <= max) { edgeScore = score; break; }
  const edgesMark = {
    score: edgeScore,
    note: noise <= 16 ? 'Edges look clean.' : `Possible whitening on the ${noisy} edge.`,
  };
  const x0 = Math.floor(width * 0.18);
  const x1 = Math.floor(width * 0.82);
  const y0 = Math.floor(height * 0.18);
  const y1 = Math.floor(height * 0.82);
  let crease = null;
  let hot = 0;
  let inner = 0;
  for (let y = y0; y < y1; y++) {
    const row = [];
    for (let x = x0; x < x1; x++) row.push(gray[y * width + x]);
    const med = row.slice().sort((a, b) => a - b)[Math.floor(row.length / 2)];
    let run = 0;
    for (const v of row) {
      if (v < med - 28) run++;
      else run = 0;
      if (run > row.length * 0.18) {
        crease = y < height * 0.33 ? 'top of the card' : y > height * 0.66 ? 'bottom of the card' : 'middle of the card';
      }
      if (v > 242) hot++;
      inner++;
    }
  }
  let surface;
  if (crease) surface = { score: 6, note: `Possible crease on the ${crease}` };
  else if (inner && hot / inner > 0.015) surface = { score: 8, note: 'Glare. Surface is partly hidden.' };
  else surface = { score: 10, note: 'No crease or glare. Fine scratches can be missed.' };
  return { centering, corners: cornersMark, edges: edgesMark, surface };
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
        image: card.card_images && card.card_images[0] ? card.card_images[0].image_url : null,
      });
    }
  }
  return rows;
}
