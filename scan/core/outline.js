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

export function outermostQuad(rgba, width, height) {
  if (!rgba || width < 8 || height < 8) return null;
  const corner = colorAt(rgba, width, 2, 2);
  const fullBleed = corner[2] < 50 && corner[0] < 45 && Math.abs(corner[0] - corner[1]) < 16;
  if (fullBleed) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }
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
  const lines = sides.map((points) => {
    if (points.length < 12) return null;
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cut = Math.floor(points.length * 0.08);
    const used = points.slice(cut, points.length - cut);
    if (used.length < 8) return null;
    return nudgeOut(fitLine(used), cx, cy);
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
