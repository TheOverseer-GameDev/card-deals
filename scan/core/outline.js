/**
 * Outermost card quad.
 * The border is a thin dark frame. The artwork inside it is not the card edge.
 * Corners may fall just outside the photo; the side lines are extended to meet.
 */

function colorAt(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

function colorDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function fitLine(points) {
  let n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    sx += point.x;
    sy += point.y;
    sxx += point.x * point.x;
    syy += point.y * point.y;
    sxy += point.x * point.y;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  const vx = sxx / n - meanX * meanX;
  const vy = syy / n - meanY * meanY;
  if (vx < vy) {
    const den = n * syy - sy * sy || 1;
    const a = (n * sxy - sx * sy) / den;
    const b = (sx - a * sy) / n;
    return { vertical: true, a, b };
  }
  const den = n * sxx - sx * sx || 1;
  const a = (n * sxy - sx * sy) / den;
  const b = (sy - a * sx) / n;
  return { vertical: false, a, b };
}

function lineAbc(line) {
  return line.vertical
    ? { a: 1, b: -line.a, c: line.b }
    : { a: -line.a, b: 1, c: line.b };
}

function intersect(p, q) {
  const A = lineAbc(p);
  const B = lineAbc(q);
  const det = A.a * B.b - B.a * A.b;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (A.c * B.b - B.c * A.b) / det,
    y: (A.a * B.c - B.a * A.c) / det,
  };
}

function nudgeOut(line, cx, cy) {
  const amount = 0.35;
  if (line.vertical) {
    const x = line.a * cy + line.b;
    return { ...line, b: line.b + (x < cx ? -amount : amount) };
  }
  const y = line.a * cx + line.b;
  return { ...line, b: line.b + (y < cy ? -amount : amount) };
}

function lumAt(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lineThrough(p, q) {
  return cross3([p.x, p.y, 1], [q.x, q.y, 1]);
}

function lineMeet(p, q, r, s) {
  const hit = cross3(lineThrough(p, q), lineThrough(r, s));
  if (Math.abs(hit[2]) < 1e-6) return null;
  return { x: hit[0] / hit[2], y: hit[1] / hit[2] };
}

function solve8(matrix, target) {
  const rows = matrix.map((row, index) => row.concat([target[index]]));
  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    const swap = rows[col];
    rows[col] = rows[pivot];
    rows[pivot] = swap;
    const div = rows[col][col];
    for (let j = col; j <= n; j += 1) rows[col][j] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = rows[r][col];
      for (let j = col; j <= n; j += 1) rows[r][j] -= factor * rows[col][j];
    }
  }
  return rows.map((row) => row[n]);
}

function edgeAspect(quad) {
  const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = (span(quad[0], quad[1]) + span(quad[3], quad[2])) / 2;
  const height = (span(quad[0], quad[3]) + span(quad[1], quad[2])) / 2;
  if (height < 1) return null;
  return width / height;
}

function aspectFit(quad, cx, cy, focal, ratio) {
  const src = [[0, 0], [ratio, 0], [ratio, 1], [0, 1]];
  const dst = quad.map((point) => [(point.x - cx) / focal, (point.y - cy) / focal]);
  const matrix = [];
  const target = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    target.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    target.push(v);
  }
  const h = solve8(matrix, target);
  if (!h) return null;
  const h1 = [h[0], h[3], h[6]];
  const h2 = [h[1], h[4], h[7]];
  const n1 = Math.hypot(h1[0], h1[1], h1[2]);
  const n2 = Math.hypot(h2[0], h2[1], h2[2]);
  if (n1 < 1e-8 || n2 < 1e-8) return null;
  return Math.abs(n1 - n2) / (n1 + n2);
}

/**
 * Aspect of the card after undoing a camera tilt.
 * A tapered quad is the image of a rectangle. Raw edge lengths shrink the far side
 * and make a 63×88 card look like Yu-Gi-Oh. Parallel edges keep the raw ratio.
 */
function oppositeEdgesParallel(quad) {
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const delta = (a, b) => {
    let gap = Math.abs(a - b) % Math.PI;
    if (gap > Math.PI / 2) gap = Math.PI - gap;
    return gap * 180 / Math.PI;
  };
  const edges = [0, 1, 2, 3].map((index) => angle(quad[index], quad[(index + 1) % 4]));
  return delta(edges[0], edges[2]) < 3 && delta(edges[1], edges[3]) < 3;
}

export function rectifiedAspect(quad, width, height) {
  const raw = edgeAspect(quad);
  if (!quad || quad.length !== 4 || raw == null) return raw;
  if (oppositeEdgesParallel(quad)) return raw;
  const [tl, tr, br, bl] = quad;
  const cx = width / 2;
  const cy = height / 2;
  const horizontal = lineMeet(tl, tr, bl, br);
  const vertical = lineMeet(tl, bl, tr, br);
  if (!horizontal || !vertical) return raw;
  const f2 = -((horizontal.x - cx) * (vertical.x - cx) + (horizontal.y - cy) * (vertical.y - cy));
  const focal = Math.sqrt(f2);
  if (!(focal > width * 0.35 && focal < width * 12)) return raw;
  let best = null;
  for (let step = 450; step <= 1100; step += 5) {
    const ratio = step / 1000;
    const score = aspectFit(quad, cx, cy, focal, ratio);
    if (score == null) continue;
    if (!best || score < best.score) best = { ratio, score };
  }
  if (!best || best.score > 0.04) return raw;
  return best.ratio;
}

function quadArea(quad) {
  let sum = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function acceptableQuad(quad, width, height) {
  if (!quad || quad.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const pad = 1.5;
  for (const point of quad) {
    if (point.x <= pad || point.y <= pad || point.x >= width - pad || point.y >= height - pad) return false;
  }
  if (quadArea(quad) > width * height * 0.95) return false;
  return true;
}

function quadFromSides(sides, cx, cy) {
  const lines = sides.map((points) => {
    if (points.length < 12) return null;
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cut = Math.floor(points.length * 0.08);
    const kept = points.slice(cut, points.length - cut);
    if (kept.length < 8) return null;
    return nudgeOut(fitLine(kept), cx, cy);
  });
  if (lines.some((line) => !line)) return null;
  const quad = [
    intersect(lines[0], lines[3]),
    intersect(lines[0], lines[1]),
    intersect(lines[2], lines[1]),
    intersect(lines[2], lines[3]),
  ];
  if (quad.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return quad;
}

function colorQuad(rgba, width, height, corner) {
  const background = (x, y) => x < 0 || y < 0 || x >= width || y >= height
    || colorDist(colorAt(rgba, width, x, y), corner) < 32;
  const sides = [[], [], [], []];
  const used = new Set();
  let cx = 0;
  let cy = 0;
  let seen = 0;
  function consider(x, y) {
    if (x < 0 || y < 0) return;
    const key = y * width + x;
    if (used.has(key)) return;
    const open = [];
    if (background(x, y - 1)) open.push(0);
    if (background(x + 1, y)) open.push(1);
    if (background(x, y + 1)) open.push(2);
    if (background(x - 1, y)) open.push(3);
    if (open.length !== 1) return;
    used.add(key);
    sides[open[0]].push({ x, y });
  }
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) if (!background(x, y)) { left = x; break; }
    if (left < 0) continue;
    for (let x = width - 1; x >= left; x -= 1) if (!background(x, y)) { right = x; break; }
    const span = right - left + 1;
    seen += span;
    cx += ((left + right) / 2) * span;
    cy += y * span;
    consider(left, y);
    consider(right, y);
  }
  for (let x = 0; x < width; x += 1) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) if (!background(x, y)) { top = y; break; }
    if (top < 0) continue;
    for (let y = height - 1; y >= top; y -= 1) if (!background(x, y)) { bottom = y; break; }
    consider(x, top);
    consider(x, bottom);
  }
  if (!seen) return null;
  cx /= seen;
  cy /= seen;
  return quadFromSides(sides, cx, cy);
}

function gradientQuad(rgba, width, height) {
  const smooth = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -2; dx <= 2; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          sum += lumAt(rgba, width, xx, yy);
          count += 1;
        }
      }
      smooth[y * width + x] = sum / count;
    }
  }
  const sides = [[], [], [], []];
  let cx = 0;
  let cy = 0;
  let seen = 0;
  function step(at) {
    const mean = (at[0] + at[1] + at[2]) / 3;
    const limit = 6;
    for (let i = 0; i < at.length - 4; i += 1) {
      if (Math.abs(at[i] - mean) > limit && Math.abs(at[i + 2] - mean) > limit && Math.abs(at[i + 4] - mean) > limit) {
        return Math.max(0, i - 2);
      }
    }
    return -1;
  }
  for (let y = 2; y < height - 2; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(smooth[y * width + x]);
    const left = step(row);
    const rightHit = step(row.slice().reverse());
    if (left >= 0) {
      sides[3].push({ x: left, y });
      seen += 1;
      cx += left;
      cy += y;
    }
    if (rightHit >= 0) sides[1].push({ x: width - 1 - rightHit, y });
  }
  for (let x = 2; x < width - 2; x += 1) {
    const col = [];
    for (let y = 0; y < height; y += 1) col.push(smooth[y * width + x]);
    const top = step(col);
    const bottomHit = step(col.slice().reverse());
    if (top >= 0) sides[0].push({ x, y: top });
    if (bottomHit >= 0) sides[2].push({ x, y: height - 1 - bottomHit });
  }
  if (seen < 12) return null;
  return quadFromSides(sides, cx / seen, cy / seen);
}

export function outermostQuad(rgba, width, height) {
  if (!rgba || width < 8 || height < 8) return null;
  const corner = colorAt(rgba, width, 2, 2);
  const cornerLum = 0.299 * corner[0] + 0.587 * corner[1] + 0.114 * corner[2];
  const colored = colorQuad(rgba, width, height, corner);
  if (cornerLum >= 45 && acceptableQuad(colored, width, height)) return colored;
  const graded = gradientQuad(rgba, width, height);
  if (acceptableQuad(graded, width, height)) return graded;
  if (acceptableQuad(colored, width, height)) return colored;
  return null;
}
