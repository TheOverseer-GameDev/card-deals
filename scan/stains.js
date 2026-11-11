/**
 * Stains, dirt, and fingerprints on a straightened photo.
 * A darker patch is reported as a possible mark. The cause is not named as fact.
 */

function luminance(rgba, i) {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

export function findStains(rgba, width, height) {
  if (!rgba || rgba.length < width * height * 4 || width < 40 || height < 40) {
    return { status: 'unchecked', findings: [], note: 'The photo is too small to check for stains.' };
  }
  let varySum = 0;
  let varyN = 0;
  let varySq = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const v = luminance(rgba, (y * width + x) * 4);
      varySum += v;
      varySq += v * v;
      varyN += 1;
    }
  }
  const varyMean = varyN ? varySum / varyN : 0;
  const vary = varyN ? Math.sqrt(Math.max(0, varySq / varyN - varyMean * varyMean)) : 0;
  if (vary > 40) {
    return {
      status: 'clear',
      findings: [],
      note: 'The picture is too detailed to separate a stain from the printing. Fine marks can still be missed.',
    };
  }
  const x0 = Math.round(width * 0.08);
  const y0 = Math.round(height * 0.22);
  const x1 = Math.round(width * 0.92);
  const y1 = Math.round(height * 0.9);
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      sum += luminance(rgba, (y * width + x) * 4);
      n += 1;
    }
  }
  const mid = n ? sum / n : 0;
  if (mid < 40) {
    return {
      status: 'unchecked',
      findings: [],
      note: 'The photo is too dark or too uneven to separate a stain from the lighting.',
    };
  }
  const dark = new Uint8Array(width * height);
  let darkCount = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (luminance(rgba, (y * width + x) * 4) < mid - 35) {
        dark[y * width + x] = 1;
        darkCount += 1;
      }
    }
  }
  if (darkCount > (x1 - x0) * (y1 - y0) * 0.4) {
    return {
      status: 'unchecked',
      findings: [],
      note: 'The photo is too dark or too uneven to separate a stain from the lighting.',
    };
  }
  const seen = new Uint8Array(width * height);
  let compact = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const start = y * width + x;
      if (!dark[start] || seen[start]) continue;
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
        for (const next of [cur - 1, cur + 1, cur - width, cur + width]) {
          if (next < 0 || next >= dark.length || seen[next] || !dark[next]) continue;
          const nx = next % width;
          if (Math.abs(nx - cx) > 1) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      const bw = maxX - minX;
      const bh = maxY - minY;
      if (count >= 40 && count <= width * height * 0.04 && bw < width * 0.28 && bh < height * 0.22) compact += 1;
    }
  }
  if (!compact) {
    return {
      status: 'clear',
      findings: [],
      note: 'No stain, dirt, or fingerprint stood out in this photo. Fine marks can still be missed.',
    };
  }
  return {
    status: 'marked',
    findings: [{
      kind: 'stain',
      text: 'A darker patch is visible. It could be dirt, a fingerprint, or print shading. The photo does not say which.',
    }],
    note: 'A darker patch is visible. It could be dirt, a fingerprint, or print shading. The photo does not say which.',
  };
}
