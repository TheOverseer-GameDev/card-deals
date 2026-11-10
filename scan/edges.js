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

function whitening(sample) {
  let hot = 0;
  for (let i = 0; i < sample.values.length; i++) {
    if (sample.values[i] > sample.median + 42 && sample.values[i] > 180) hot += 1;
  }
  const frac = sample.values.length ? hot / sample.values.length : 0;
  return frac > 0.08 && frac < 0.6;
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
  const outward = corner.includes('tl') ? [0, 0] : corner.includes('tr') ? [width - 1, 0] : corner.includes('br') ? [width - 1, height - 1] : [0, height - 1];
  const inward = corner.includes('tl') ? [1, 1] : corner.includes('tr') ? [-1, 1] : corner.includes('br') ? [-1, -1] : [1, -1];
  let gap = 0;
  for (let step = 0; step < Math.min(width, height); step++) {
    const x = outward[0] + inward[0] * step;
    const y = outward[1] + inward[1] * step;
    if (grayAt(rgba, (y * width + x) * 4) < 210) break;
    gap = step;
  }
  return gap > Math.min(width, height) * 0.18;
}

function chips(rgba, width, height, median) {
  let blobs = 0;
  const seen = new Uint8Array(width * height);
  const lightBorder = median > 140;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (seen[i]) continue;
      const v = grayAt(rgba, i * 4);
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

function findingFor(kind, sample, rgba, width, height, id) {
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
  if (chips(rgba, width, height, sample.median) > 0) {
    return { flag: 'chip', text: 'A small chip is visible on this crop. This is not a grade.', trusted: true };
  }
  if (whitening(sample)) {
    return { flag: 'whitening', text: 'Part of this border is lighter than the rest. Whitening is only a visual note.', trusted: true };
  }
  return { flag: 'clear', text: 'No whitening, ding, rounding, or chip stood out on this crop.', trusted: true };
}

export function inspectSide(rgba, width, height, side) {
  if (width !== 500 || height !== 700 || !rgba) {
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
    const found = findingFor(box.kind, sample, pixels, box.w, box.h, box.id);
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
