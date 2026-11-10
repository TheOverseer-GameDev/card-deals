/**
 * Stains, dirt, and fingerprints on a straightened photo.
 * A darker patch is reported as a possible mark. The cause is not named as fact.
 */

function luminance(rgba, i) {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

export function findStains(rgba, width, height) {
  if (!rgba || width < 40 || height < 40) {
    return { status: 'unchecked', findings: [], note: 'The photo is too small to check for stains.' };
  }
  const x0 = Math.round(width * 0.12);
  const y0 = Math.round(height * 0.1);
  const x1 = Math.round(width * 0.88);
  const y1 = Math.round(height * 0.9);
  const cols = 8;
  const rows = 8;
  const cw = Math.max(1, Math.floor((x1 - x0) / cols));
  const ch = Math.max(1, Math.floor((y1 - y0) / rows));
  const means = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      let n = 0;
      const sx = x0 + col * cw;
      const sy = y0 + row * ch;
      for (let y = sy; y < sy + ch && y < y1; y++) {
        for (let x = sx; x < sx + cw && x < x1; x++) {
          sum += luminance(rgba, (y * width + x) * 4);
          n += 1;
        }
      }
      means.push({ row, col, mean: n ? sum / n : 0 });
    }
  }
  const sorted = means.map((cell) => cell.mean).sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const darkCells = means.filter((cell) => cell.mean < mid - 35);
  if (darkCells.length > means.length * 0.4 || mid < 40) {
    return {
      status: 'unchecked',
      findings: [],
      note: 'The photo is too dark or too uneven to separate a stain from the lighting.',
    };
  }
  if (!darkCells.length) {
    return {
      status: 'clear',
      findings: [],
      note: 'No stain, dirt, or fingerprint stood out in this photo. Fine marks can still be missed.',
    };
  }
  return {
    status: 'marked',
    findings: darkCells.slice(0, 4).map((cell) => ({
      kind: 'stain',
      text: 'A darker patch is visible. It could be dirt, a fingerprint, or print shading. The photo does not say which.',
      col: cell.col,
      row: cell.row,
    })),
    note: 'A darker patch is visible. It could be dirt, a fingerprint, or print shading. The photo does not say which.',
  };
}
