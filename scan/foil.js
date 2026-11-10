/**
 * Holo and foil wear from color in the photo.
 * A dull patch inside a reflective area is possible wear, not a wear grade.
 */

function sat(rgba, i) {
  const r = rgba[i];
  const g = rgba[i + 1];
  const b = rgba[i + 2];
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function findFoilWear(rgba, width, height) {
  if (!rgba || width < 20 || height < 20) {
    return { status: 'unchecked', findings: [], note: 'The photo is too small to check foil.' };
  }
  const x0 = Math.round(width * 0.15);
  const y0 = Math.round(height * 0.15);
  const x1 = Math.round(width * 0.85);
  const y1 = Math.round(height * 0.75);
  let shiny = 0;
  let dull = 0;
  let total = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = sat(rgba, (y * width + x) * 4);
      total += 1;
      if (s > 40) {
        shiny += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!total || shiny / total < 0.04) {
    return {
      status: 'clear',
      findings: [],
      note: 'No reflective color shift stood out in this photo. That does not mean the card has no foil.',
    };
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (sat(rgba, (y * width + x) * 4) < 12) dull += 1;
    }
  }
  const box = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  if (dull / box < 0.08) {
    return {
      status: 'clear',
      findings: [],
      note: 'A reflective area is visible. No dull patch stood out inside it.',
    };
  }
  return {
    status: 'marked',
    findings: [{
      kind: 'foil-wear',
      text: 'A dull patch sits inside a reflective area. It may be foil wear. This is not a measure of how worn it is.',
    }],
    note: 'A dull patch sits inside a reflective area. It may be foil wear. This is not a measure of how worn it is.',
  };
}
