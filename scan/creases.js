/**
 * Creases and dents from a shading change on one straightened photo.
 * A whole-card light gradient is not called a crease.
 */

function gray(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

function groove(rgba, width, height, x) {
  const y0 = Math.round(height * 0.2);
  const y1 = Math.round(height * 0.8);
  let rows = 0;
  let hit = 0;
  for (let y = y0; y < y1; y += 2) {
    const left = gray(rgba, width, x - 10, y);
    const mid = gray(rgba, width, x, y);
    const right = gray(rgba, width, x + 10, y);
    rows += 1;
    if (mid < left - 30 && mid < right - 30 && Math.abs(left - right) < 25) hit += 1;
  }
  return rows ? hit / rows : 0;
}

export function findCreases(rgba, width, height) {
  if (!rgba || rgba.length < width * height * 4 || width < 40 || height < 40) {
    return { status: 'unchecked', findings: [], note: 'The photo is too small to check shading.' };
  }
  let leftSum = 0;
  let rightSum = 0;
  let n = 0;
  const y0 = Math.round(height * 0.2);
  const y1 = Math.round(height * 0.8);
  for (let y = y0; y < y1; y += 3) {
    for (let x = 4; x < width * 0.33; x += 3) {
      leftSum += gray(rgba, width, x, y);
      n += 1;
    }
    for (let x = Math.round(width * 0.67); x < width - 4; x += 3) {
      rightSum += gray(rgba, width, x, y);
    }
  }
  const leftMean = n ? leftSum / n : 0;
  const rightMean = n ? rightSum / n : 0;
  if (Math.abs(leftMean - rightMean) > 30) {
    return {
      status: 'unchecked',
      findings: [],
      note: 'The shading changes across the whole photo, so a crease or dent was not separated from the light.',
    };
  }
  let best = null;
  for (let x = 16; x < width - 16; x += 4) {
    const strong = groove(rgba, width, height, x);
    if (strong > 0.62 && (!best || strong > best.strong)) best = { x, strong };
  }
  if (!best) {
    return {
      status: 'clear',
      findings: [],
      note: 'No crease or dent stood out from the shading. A soft bend can still be missed.',
    };
  }
  return {
    status: 'marked',
    findings: [{
      kind: 'crease',
      x: best.x / width,
      text: 'A straight shading change is visible. It may be a crease or a dent. This is not a measurement of how deep it is.',
    }],
    note: 'A straight shading change is visible. It may be a crease or a dent. This is not a measurement of how deep it is.',
  };
}
