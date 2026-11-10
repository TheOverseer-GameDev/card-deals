/**
 * Close-ups of the four corners and four edges on a straightened 500x700 photo.
 * Scores describe what is visible. They are not a grade.
 */
const CORNERS = [
  { id: 'corner-tl', label: 'Top left corner', x: 0, y: 0 },
  { id: 'corner-tr', label: 'Top right corner', x: 500 - 90, y: 0 },
  { id: 'corner-br', label: 'Bottom right corner', x: 500 - 90, y: 700 - 90 },
  { id: 'corner-bl', label: 'Bottom left corner', x: 0, y: 700 - 90 },
];
const EDGES = [
  { id: 'edge-top', label: 'Top edge', x: 120, y: 0, w: 260, h: 36 },
  { id: 'edge-right', label: 'Right edge', x: 500 - 36, y: 180, w: 36, h: 340 },
  { id: 'edge-bottom', label: 'Bottom edge', x: 120, y: 700 - 36, w: 260, h: 36 },
  { id: 'edge-left', label: 'Left edge', x: 0, y: 180, w: 36, h: 340 },
];

function crop(rgba, width, height, box) {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const sx = box.x + x;
      const sy = box.y + y;
      const si = (sy * width + sx) * 4;
      const di = (y * box.w + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

function grayAt(rgba, i) {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

function stats(rgba) {
  const n = rgba.length / 4;
  let sum = 0;
  let clip = 0;
  let dark = 0;
  const values = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const v = grayAt(rgba, p * 4);
    values[p] = v;
    sum += v;
    if (v >= 248) clip += 1;
    if (v < 28) dark += 1;
  }
  values.sort();
  const mean = n ? sum / n : 0;
  const median = n ? values[Math.floor(n / 2)] : 0;
  return { mean, median, clipped: n ? clip / n : 0, dark: n ? dark / n : 0, values };
}

function lighting(sample) {
  if (sample.mean < 38 || sample.dark > 0.55) {
    return { trust: false, note: 'Lighting is too poor to trust this close-up.' };
  }
  if (sample.clipped > 0.18 || sample.mean > 235) {
    return { trust: false, note: 'Glare is too strong to trust this close-up.' };
  }
  return { trust: true, note: '' };
}

function borderGap(rgba, width, height, id) {
  const positions = [];
  const across = id.includes('top') || id.includes('bottom');
  const fromStart = id.includes('top') || id.includes('left');
  const outer = across ? width : height;
  const depth = across ? height : width;
  for (let i = 0; i < outer; i++) {
    let pos = 0;
    for (let j = 0; j < depth; j++) {
      const x = across ? i : (fromStart ? j : width - 1 - j);
      const y = across ? (fromStart ? j : height - 1 - j) : i;
      if (grayAt(rgba, (y * width + x) * 4) > 80) {
        pos = j;
        break;
      }
    }
    positions.push(pos);
  }
  const mid = positions.slice().sort((a, b) => a - b)[Math.floor(positions.length / 2)] || 0;
  let dips = 0;
  let run = 0;
  for (const pos of positions) {
    if (pos > mid + 3) {
      run += 1;
      if (run === 4) dips += 1;
    } else run = 0;
  }
  return dips;
}

function rounding(rgba, width, height, corner) {
  const isLeft = corner.endsWith('l');
  const isTop = corner.includes('tl') || corner.includes('tr');
  const ox = isLeft ? 0 : width - 1;
  const oy = isTop ? 0 : height - 1;
  const ix = isLeft ? 1 : -1;
  const iy = isTop ? 1 : -1;
  const inset = Math.floor(Math.min(width, height) * 0.45);
  const refX = Math.max(0, Math.min(width - 1, ox + ix * inset));
  const refY = Math.max(0, Math.min(height - 1, oy + iy * inset));
  const border = grayAt(rgba, (refY * width + refX) * 4);
  const gapFrom = (x, y, dx, dy) => {
    let gap = 0;
    const limit = Math.min(width, height);
    for (let step = 0; step < limit; step++) {
      const sx = x + dx * step;
      const sy = y + dy * step;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) break;
      if (Math.abs(grayAt(rgba, (sy * width + sx) * 4) - border) < 35) break;
      gap = step;
    }
    return gap;
  };
  const cornerGap = gapFrom(ox, oy, ix, iy);
  const sideX = isLeft ? Math.floor(width * 0.75) : Math.floor(width * 0.25);
  const sideGap = gapFrom(sideX, oy, 0, iy);
  return cornerGap > sideGap + Math.min(width, height) * 0.12;
}

function onCardPaper(box, x, y, cardW, cardH) {
  const cx = box.x + x;
  const cy = box.y + y;
  const band = 16;
  return cx < band || cy < band || cx >= cardW - band || cy >= cardH - band;
}

function whitening(rgba, width, height, paper) {
  const vals = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!paper(x, y)) continue;
      const v = grayAt(rgba, (y * width + x) * 4);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length < 20) return false;
  vals.sort((a, b) => a - b);
  const mid = vals[Math.floor(vals.length / 2)];
  let hot = 0;
  for (const v of vals) if (v > mid + 42 && v > 180) hot += 1;
  const frac = hot / vals.length;
  return frac > 0.08 && frac < 0.6;
}

function chips(rgba, width, height, median, paper) {
  let blobs = 0;
  const seen = new Uint8Array(width * height);
  const lightBorder = median > 140;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (seen[i] || (paper && !paper(x, y))) continue;
      const v = grayAt(rgba, i * 4);
      if (!Number.isFinite(v)) continue;
      const chip = lightBorder ? v < median - 50 : v > median + 50 && v > 170;
      if (!chip) continue;
      const stack = [i];
      seen[i] = 1;
      let count = 0;
      while (stack.length) {
        const cur = stack.pop();
        count += 1;
        const cx = cur % width;
        const cy = (cur - cx) / width;
        const next = [cur - 1, cur + 1, cur - width, cur + width];
        for (const n of next) {
          if (n < 0 || n >= seen.length || seen[n]) continue;
          const nx = n % width;
          const ny = (n - nx) / width;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (paper && !paper(nx, ny)) continue;
          const nv = grayAt(rgba, n * 4);
          const same = lightBorder ? nv < median - 50 : nv > median + 50 && nv > 170;
          if (!same) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (count >= 6 && count <= 80) blobs += 1;
    }
  }
  return blobs;
}

function findingFor(kind, sample, rgba, width, height, id, paper) {
  const light = lighting(sample);
  if (!light.trust) {
    return { flag: 'unchecked', text: light.note, trusted: false };
  }
  if (kind === 'corner' && rounding(rgba, width, height, id)) {
    return { flag: 'rounding', text: 'The corner looks rounded in this photo. This is not a grade.', trusted: true };
  }
  if (kind === 'edge' && borderGap(rgba, width, height, id) > 0) {
    return { flag: 'ding', text: 'A nick breaks the edge line in this photo. This is not a grade.', trusted: true };
  }
  if (chips(rgba, width, height, sample.median, paper) > 0) {
    return { flag: 'chip', text: 'A small chip is visible on this crop. This is not a grade.', trusted: true };
  }
  if (whitening(rgba, width, height, paper)) {
    return { flag: 'whitening', text: 'Part of this border is lighter than the rest. Whitening is only a visual note.', trusted: true };
  }
  return { flag: 'clear', text: 'No whitening, ding, rounding, or chip stood out on this crop.', trusted: true };
}

export function inspectSide(rgba, width, height, side) {
  if (width !== 500 || height !== 700 || !rgba || rgba.length < width * height * 4) {
    return {
      side,
      trusted: false,
      note: 'Edge close-ups need the straightened 500 by 700 photo. This one was not straightened, so they were not scored.',
      crops: [],
    };
  }
  const crops = [];
  for (const box of [...CORNERS.map((item) => ({ ...item, w: 90, h: 90, kind: 'corner' })), ...EDGES.map((item) => ({ ...item, kind: 'edge' }))]) {
    const pixels = crop(rgba, width, height, box);
    const sample = stats(pixels);
    const paper = (x, y) => onCardPaper(box, x, y, width, height);
    const found = findingFor(box.kind, sample, pixels, box.w, box.h, box.id, paper);
    crops.push({
      id: `${side}-${box.id}`,
      side,
      label: `${side === 'back' ? 'Back' : 'Front'} ${box.label.toLowerCase()}`,
      kind: box.kind,
      x: box.x / width,
      y: box.y / height,
      w: box.w / width,
      h: box.h / height,
      rgba: pixels,
      width: box.w,
      height: box.h,
      flag: found.flag,
      text: found.text,
      trusted: found.trusted,
    });
  }
  const unchecked = crops.filter((crop) => !crop.trusted).length;
  return {
    side,
    trusted: unchecked < crops.length,
    note: unchecked === crops.length
      ? 'Lighting is too poor to trust the corner and edge check.'
      : 'Close-ups show only what is visible. A photo cannot guarantee a grade or that the card is genuine.',
    crops,
  };
}
