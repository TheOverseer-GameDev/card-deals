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
  const across = id.includes('top') || id.includes('bottom');
  const fromStart = id.includes('top') || id.includes('left');
  const outer = across ? width : height;
  const depth = Math.min(16, across ? height : width);
  const line = [];
  for (let i = 0; i < outer; i++) {
    const vals = [];
    for (let j = 0; j < depth; j++) {
      const x = across ? i : (fromStart ? j : width - 1 - j);
      const y = across ? (fromStart ? j : height - 1 - j) : i;
      vals.push(grayAt(rgba, (y * width + x) * 4));
    }
    line.push(vals);
  }
  const flat = line.flat().filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!flat.length) return 0;
  const mid = flat[Math.floor(flat.length / 2)];
  // A nick is a short run of pixels far from the border color. A printed fade is not.
  let dips = 0;
  let run = 0;
  const closeRun = () => {
    if (run >= 4 && run <= 48) dips += 1;
    run = 0;
  };
  for (const vals of line) {
    const odd = vals.filter((v) => Math.abs(v - mid) >= 55).length >= Math.ceil(depth * 0.45);
    if (odd) run += 1;
    else closeRun();
  }
  closeRun();
  return dips;
}

function rounding(rgba, width, height, corner) {
  const isLeft = corner.endsWith('l');
  const isTop = corner.includes('tl') || corner.includes('tr');
  const ox = isLeft ? 0 : width - 1;
  const oy = isTop ? 0 : height - 1;
  const ax = isLeft ? 1 : -1;
  const ay = isTop ? 1 : -1;
  const at = (x, y) => grayAt(rgba, (y * width + x) * 4);
  const cornerPx = at(ox, oy);
  const alongX = at(Math.max(0, Math.min(width - 1, ox + ax * 40)), oy);
  const alongY = at(ox, Math.max(0, Math.min(height - 1, oy + ay * 40)));
  const diag = at(
    Math.max(0, Math.min(width - 1, ox + ax * 14)),
    Math.max(0, Math.min(height - 1, oy + ay * 14)),
  );
  const backX = at(Math.max(0, Math.min(width - 1, ox + ax * 36)), oy);
  const backY = at(ox, Math.max(0, Math.min(height - 1, oy + ay * 36)));
  // Missing paper stays gone along the diagonal, while both edges have recovered
  // to the border color. A soft printed corner pixel does not do both.
  const missing = Math.abs(cornerPx - alongX) > 40 && Math.abs(cornerPx - alongY) > 40;
  const stillGone = Math.abs(diag - cornerPx) < 32;
  const edgesBack = Math.abs(backX - alongX) < 36 && Math.abs(backY - alongY) < 36;
  return missing && stillGone && edgesBack;
}

function cornerScuff(rgba, width, height, corner) {
  const isLeft = corner.endsWith('l');
  const isTop = corner.includes('tl') || corner.includes('tr');
  const ox = isLeft ? 0 : width - 1;
  const oy = isTop ? 0 : height - 1;
  const ax = isLeft ? 1 : -1;
  const ay = isTop ? 1 : -1;
  const at = (x, y) => grayAt(rgba, (y * width + x) * 4);
  const start = at(ox, oy);
  if (start < 200) return false;
  function reach(dx, dy) {
    let run = 0;
    const limit = Math.min(86, dx ? width - 1 : height - 1);
    for (let step = 1; step <= limit; step++) {
      const x = ox + dx * step;
      const y = oy + dy * step;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (start - at(x, y) < 18) run = step;
      else break;
    }
    return run;
  }
  const near = Math.min(reach(ax, 0), reach(0, ay));
  // A corner scuff is lighter than the border beside it. A highlight of a few
  // pixels, and a border that stays light across the whole crop, are not.
  return near >= 24 && near <= 80;
}

function onCardPaper(box, x, y, cardW, cardH) {
  const cx = box.x + x;
  const cy = box.y + y;
  const band = 8;
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
  const hot = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!paper(x, y)) continue;
      const v = grayAt(rgba, (y * width + x) * 4);
      if (v > mid + 42 && v > 180) hot[y * width + x] = 1;
    }
  }
  const seen = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (!hot[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let count = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length) {
        const cur = stack.pop();
        count += 1;
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
      const span = Math.max(maxX - minX, maxY - minY);
      if (count >= 8 && count <= 70 && span < Math.max(width, height) * 0.45) return true;
    }
  }
  return false;
}

function chips(rgba, width, height, median, paper, tip) {
  let blobs = 0;
  const seen = new Uint8Array(width * height);
  const lightBorder = median > 140;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (seen[i] || (paper && !paper(x, y)) || (tip && tip(x, y))) continue;
      const v = grayAt(rgba, i * 4);
      if (!Number.isFinite(v)) continue;
      const chip = lightBorder ? v < median - 50 : v > median + 50 && v > 170 && !(tip && tip(x, y));
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
          if (tip && tip(nx, ny)) continue;
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
  if (light.note.startsWith('Glare')) {
    return { flag: 'unchecked', text: light.note, trusted: false };
  }
  if (kind === 'corner' && rounding(rgba, width, height, id)) {
    return { flag: 'rounding', text: 'The corner looks rounded in this photo. This is not a grade.', trusted: true };
  }
  if (kind === 'corner' && cornerScuff(rgba, width, height, id)) {
    return { flag: 'whitening', text: 'This corner is lighter than the border beside it. Whitening is only a visual note.', trusted: true };
  }
  if (kind === 'edge' && borderGap(rgba, width, height, id) > 0) {
    return { flag: 'ding', text: 'A nick breaks the edge line in this photo. This is not a grade.', trusted: true };
  }
  const isLeft = id.endsWith('l');
  const isTop = id.includes('tl') || id.includes('tr');
  const tip = kind === 'corner'
    ? (x, y) => (isLeft ? x < 12 : x >= width - 12) && (isTop ? y < 12 : y >= height - 12)
    : null;
  if (chips(rgba, width, height, sample.median, paper, tip) > 0) {
    return { flag: 'chip', text: 'A small chip is visible on this crop. This is not a grade.', trusted: true };
  }
  if (kind !== 'corner' && whitening(rgba, width, height, paper)) {
    return { flag: 'whitening', text: 'Part of this border is lighter than the rest. Whitening is only a visual note.', trusted: true };
  }
  if (!light.trust) {
    return { flag: 'unchecked', text: light.note, trusted: false };
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
  const cornerCrops = crops.filter((crop) => crop.kind === 'corner');
  // The same small bright speck on every corner is the printed corner, not four chips.
  if (cornerCrops.length === 4 && cornerCrops.every((crop) => crop.flag === 'chip')) {
    for (const crop of cornerCrops) {
      crop.flag = 'clear';
      crop.text = 'No whitening, ding, rounding, or chip stood out on this crop.';
      crop.trusted = true;
    }
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
