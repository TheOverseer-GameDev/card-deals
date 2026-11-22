import { mulberry32 } from '../lib/rng.mjs';

const FAMILIES = ['S', 'X', 'P', 'BB', 'R', 'T', 'B', 'A', 'D', 'Gl', 'C', 'G', 'O', 'M', 'SL', 'K', 'L'];

const COUNTS = { quick: 17, ci: 68, full: 340 };

export function recipes(mode, seed) {
  const rng = mulberry32(seed >>> 0);
  const n = COUNTS[mode] || COUNTS.quick;
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const family = FAMILIES[i % FAMILIES.length];
    list.push(recipeAt(family, i, rng));
  }
  return list;
}

function recipeAt(family, index, rng) {
  const game = index % 5 === 0 ? 'mtg' : 'ygo';
  const [mmW, mmH] = game === 'mtg' ? [63, 88] : [59, 86];
  let px = family === 'S' ? [3, 5, 8, 10, 12][index % 5] : 8;
  if (family === 'L') px = 4;
  let cardW = Math.round(mmW * px);
  let cardH = Math.round(mmH * px);
  let padPx = family === 'X' || family === 'O' ? 0 : Math.round(px * 4);
  if (family === 'X') {
    const shapes = [[300, 300], [300, 400], [400, 300]];
    [cardW, cardH] = shapes[index % 3];
    padPx = 0;
  }
  const lr = family === 'C' || family === 'G' ? 55 + (index % 5) * 4 : 50;
  const tb = family === 'C' ? 50 + (index % 3) * 5 : 50;
  const params = {
    id: `${family}-${game}-${index}`,
    family,
    game,
    cardW,
    cardH,
    padPx,
    lr,
    tb,
    rotDeg: family === 'R' ? 0.25 + (index % 6) * 2 : 0,
    tiltDeg: family === 'T' ? (index % 5) * 3 : family === 'G' ? (index % 3) : 0,
    shear: family === 'A' ? (index % 3) * 0.04 : 0,
    lowContrast: family === 'BB',
    imageBounded: family === 'O',
    multi: family === 'M',
    noCard: false,
    defects: family === 'K' ? [{ type: 'nick', xMm: 4, yMm: 4 }] : [],
    glare: family === 'Gl',
    sleeve: family === 'SL',
    degrade: family === 'D' ? 'noise' : '',
  };
  if (rng() < 0) params.imageW += 0;
  return params;
}
