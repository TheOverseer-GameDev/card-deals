/**
 * Left/right border share from a photo.
 * A reading is returned only when the border is straight and the same on each sample.
 * A tilted, full-bleed, or uneven edge stays unchecked.
 */

function pixel(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

function colorDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function luma(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function unchecked() {
  return { state: 'unchecked', lr: null, tb: null };
}

export function readCentering(rgba, width, height) {
  if (!rgba || width < 48 || height < 48 || rgba.length < width * height * 4) return unchecked();
  const background = pixel(rgba, width, 2, 2);
  const inside = pixel(rgba, width, Math.floor(width * 0.5), Math.floor(height * 0.12));
  if (colorDist(background, inside) < 28) return unchecked();

  function outerAt(horizontal, fromStart, fixed) {
    const span = horizontal ? width : height;
    const step = fromStart ? 1 : -1;
    const begin = fromStart ? 0 : span - 1;
    const end = fromStart ? span : -1;
    for (let i = begin; i !== end; i += step) {
      const x = horizontal ? i : fixed;
      const y = horizontal ? fixed : i;
      if (colorDist(pixel(rgba, width, x, y), background) >= 30) return i;
    }
    return null;
  }

  const leftHigh = outerAt(true, true, Math.round(height * 0.3));
  const leftLow = outerAt(true, true, Math.round(height * 0.7));
  if (leftHigh == null || leftLow == null || Math.abs(leftHigh - leftLow) > 3) return unchecked();

  function thickness(horizontal, fromStart, fixed) {
    const span = horizontal ? width : height;
    const outer = outerAt(horizontal, fromStart, fixed);
    if (outer == null) return null;
    const step = fromStart ? 1 : -1;
    const edge = pixel(rgba, width, horizontal ? outer : fixed, horizontal ? fixed : outer);
    const edgeLum = luma(edge);
    const room = Math.floor((horizontal ? width : height) * 0.22);
    for (let n = 2; n < room; n += 1) {
      const i = outer + step * n;
      if (i < 0 || i >= span) return null;
      const sample = pixel(rgba, width, horizontal ? i : fixed, horizontal ? fixed : i);
      if (luma(sample) > edgeLum + 36) return n;
    }
    return null;
  }

  function share(horizontal) {
    const fracs = [0.32, 0.42, 0.5, 0.58, 0.68];
    const first = [];
    const second = [];
    const span = horizontal ? height : width;
    for (const frac of fracs) {
      const fixed = Math.min(span - 2, Math.max(1, Math.round(span * frac)));
      const a = thickness(horizontal, true, fixed);
      const b = thickness(horizontal, false, fixed);
      if (a != null) first.push(a);
      if (b != null) second.push(b);
    }
    if (first.length < 4 || second.length < 4) return null;
    if (Math.max(...first) - Math.min(...first) > 4) return null;
    if (Math.max(...second) - Math.min(...second) > 4) return null;
    const a = median(first);
    const b = median(second);
    if (a < 4 || b < 4) return null;
    return (a / (a + b)) * 100;
  }

  const lr = share(true);
  if (lr == null || !Number.isFinite(lr)) return unchecked();
  const tb = share(false);
  return { state: 'ok', lr, tb: tb == null ? null : tb };
}
