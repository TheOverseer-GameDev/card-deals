/**
 * On-device inspection. A result is ok, found, or unchecked.
 * Unchecked always carries a reason and a retake tip. Nothing is uploaded.
 */

export const CHECKS = ['stain', 'foil', 'edition', 'authenticity', 'print', 'whitening', 'ding', 'scratch', 'dent', 'crease', 'warp', 'glare', 'nick'];

const TIPS = {
  NO_CARD: 'Retake with the whole card on a plain background.',
  LOW_RES: 'Move closer so the card fills more of the photo.',
  GLARE_REGION: 'Tilt the card or remove the sleeve so the glare moves off.',
  POSE_TILT: 'Hold the card upright so the edges run straight.',
  FLAG_OFF: 'This check is off in this version.',
  UNCERTAIN: 'Retake in even light, with all four edges visible.',
};

export function inspect(rgba, width, height, flags = {}) {
  if (!rgba || rgba.length < width * height * 4 || width < 40 || height < 40) {
    return { card: null, results: mapUnchecked(CHECKS, 'LOW_RES', 'The photo is too small to inspect.') };
  }
  const card = findCard(rgba, width, height);
  if (!card) return { card: null, results: mapUnchecked(CHECKS, 'NO_CARD', 'No card edge was found.') };
  const pxPerMm = card.w / (card.w / card.h > 0.7 ? 63 : 59);
  if (pxPerMm < 8) return { card, results: mapUnchecked(CHECKS, 'LOW_RES', 'The photo is below 8 pixels per millimetre.') };
  const results = {};
  for (const id of CHECKS) {
    if (flags[id] === false) {
      results[id] = unchecked('FLAG_OFF', 'This check is off.');
      continue;
    }
    results[id] = runCheck(id, rgba, width, card, pxPerMm);
  }
  return { card, results };
}

function runCheck(id, rgba, width, card, px) {
  try {
    if (id === 'stain') return stain(rgba, width, card, px);
    if (id === 'foil') return foil(rgba, width, card, px);
    if (id === 'edition') return edition(rgba, width, card, px);
    if (id === 'authenticity') return authenticity(rgba, width, card, px);
    if (id === 'print') return printLines(rgba, width, card, px);
    if (id === 'whitening') return whitening(rgba, width, card, px);
    if (id === 'ding') return ding(rgba, width, card, px);
    if (id === 'scratch') return scratch(rgba, width, card, px);
    if (id === 'dent') return dent(rgba, width, card, px);
    if (id === 'crease') return crease(rgba, width, card, px);
    if (id === 'warp') return warp(rgba, width, card, px);
    if (id === 'glare') return glare(rgba, width, card, px);
    if (id === 'nick') return nick(rgba, width, card, px);
  } catch {
    return unchecked('UNCERTAIN', 'This check could not be finished.');
  }
  return unchecked('UNCERTAIN', 'This check is not available.');
}

function stain(rgba, width, card, px) {
  const art = artBox(card, px);
  const samples = [];
  for (let y = art.y0; y < art.y1; y += 4) {
    for (let x = art.x0; x < art.x1; x += 4) samples.push(lum(sample(rgba, width, x, y)));
  }
  samples.sort((a, b) => a - b);
  const base = samples[Math.floor(samples.length * 0.7)] || 0;
  let dark = 0;
  for (let y = art.y0; y < art.y1; y += 2) {
    for (let x = art.x0; x < art.x1; x += 2) {
      if (inEdition(x, y, card, px)) continue;
      if (base - lum(sample(rgba, width, x, y)) > 70) dark += 4;
    }
  }
  const area = dark / (px * px);
  if (area >= 1.2 && area <= 20) return found('A dark spot stands out from the printing.');
  return ok('No stain stood out.');
}

function foil(rgba, width, card, px) {
  const art = artBox(card, px);
  let shiny = 0;
  let dull = 0;
  for (let y = art.y0; y < art.y1; y += 2) {
    for (let x = art.x0; x < art.x1; x += 2) {
      const p = sample(rgba, width, x, y);
      const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
      if (sat > 100 && p[2] > p[0] + 40) shiny += 4;
      if (sat < 20 && lum(p) > 90 && lum(p) < 180) dull += 4;
    }
  }
  if (shiny / (px * px) > 8 && dull / (px * px) > 0.8) return found('A dull patch sits inside a reflective area.');
  if (shiny / (px * px) > 8) return ok('The reflective area looks even.');
  return ok('No foil wear stood out.');
}

function slanted(rgba, width, card) {
  const top = edgeX(rgba, width, card, card.y + Math.round(card.h * 0.2));
  const bot = edgeX(rgba, width, card, card.y + Math.round(card.h * 0.8));
  if (top < 0 || bot < 0) return false;
  return Math.abs(top - bot) / card.h > 0.04;
}

function inEdition(x, y, card, px) {
  const x0 = card.x + Math.round(4 * px);
  const x1 = card.x + Math.round(14 * px);
  const y0 = card.y + card.h - Math.round(14 * px);
  const y1 = card.y + card.h - Math.round(4 * px);
  return x >= x0 && x < x1 && y >= y0 && y < y1;
}

function edition(rgba, width, card, px) {
  if (slanted(rgba, width, card)) return unchecked('POSE_TILT', 'The card is tilted, so the edition area was not judged.');
  const x0 = card.x + Math.round(5 * px);
  const x1 = card.x + Math.round(12 * px);
  const y0 = card.y + card.h - Math.round(12 * px);
  const y1 = card.y + card.h - Math.round(6 * px);
  let ink = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (lum(sample(rgba, width, x, y)) < 30) ink += 1;
    }
  }
  if (ink > px * px * 0.6) return found('A dark edition stamp is visible.');
  return ok('No edition stamp stood out.');
}

function authenticity(rgba, width, card, px) {
  const band = Math.max(2, Math.round(px));
  let red = 0;
  let n = 0;
  for (let y = card.y + band; y < card.y + card.h - band; y += 3) {
    const p = sample(rgba, width, card.x + band, y);
    red += p[0] - Math.max(p[1], p[2]);
    n += 1;
  }
  if (n && red / n > 40) return found('The border ink does not match a normal dark edge.');
  return ok('No counterfeit border ink stood out.');
}

function printLines(rgba, width, card, px) {
  const art = artBox(card, px);
  let swings = 0;
  let prev = null;
  for (let y = art.y0; y < art.y1; y += Math.max(1, Math.round(px * 0.5))) {
    let sum = 0;
    let n = 0;
    for (let x = art.x0; x < art.x1; x += 4) {
      sum += lum(sample(rgba, width, x, y));
      n += 1;
    }
    const mean = n ? sum / n : 0;
    if (prev != null && Math.abs(mean - prev) > 18) swings += 1;
    prev = mean;
  }
  if (swings >= 6) return found('Repeating print lines run across the card.');
  return ok('No print line stood out.');
}

function whitening(rgba, width, card, px) {
  if (slanted(rgba, width, card)) return unchecked('POSE_TILT', 'The card is tilted, so the edge was not judged.');
  const band = Math.round(3.5 * px);
  let light = 0;
  for (let y = card.y; y < card.y + card.h; y += 2) {
    for (let x = card.x; x < card.x + band; x += 2) {
      if (lum(sample(rgba, width, x, y)) > 190) light += 4;
    }
  }
  if (light / (px * px) > 4) return found('The edge looks whitened.');
  return ok('No whitening stood out.');
}

function ding(rgba, width, card, px) {
  if (slanted(rgba, width, card)) return unchecked('POSE_TILT', 'The card is tilted, so a chip was not judged.');
  if (warp(rgba, width, card, px).state === 'found') return ok('No ding stood out.');
  const bg = sample(rgba, width, 2, 2);
  const band = Math.round(3 * px);
  let holes = 0;
  const yStart = card.y + Math.round(4 * px);
  for (let y = yStart; y < yStart + Math.round(10 * px); y += 1) {
    for (let x = card.x; x < card.x + band; x += 1) {
      const p = sample(rgba, width, x, y);
      if (Math.abs(p[2] - bg[2]) < 18 && p[2] > p[0] + 10) holes += 1;
    }
  }
  if (holes > px * 1.5) return found('A chip of the edge is missing.');
  return ok('No ding stood out.');
}

function scratch(rgba, width, card, px) {
  const art = artBox(card, px);
  let best = 0;
  for (let y = art.y0; y < art.y1; y += 2) {
    let run = 0;
    for (let x = art.x0; x < art.x1; x += 1) {
      const p = sample(rgba, width, x, y);
      const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
      if (lum(p) > 200 && sat > 12) {
        run += 1;
        if (run > best) best = run;
      } else run = 0;
    }
  }
  if (best > 5 * px) return found('A thin scratch crosses the surface.');
  return ok('No scratch stood out.');
}

function dent(rgba, width, card, px) {
  const art = artBox(card, px);
  const base = lum(sample(rgba, width, art.cx, art.cy));
  let mild = 0;
  for (let y = art.y0; y < art.y1; y += 2) {
    for (let x = art.x0; x < art.x1; x += 2) {
      const d = base - lum(sample(rgba, width, x, y));
      if (d > 28 && d < 60) mild += 4;
    }
  }
  if (mild / (px * px) > 2 && mild / (px * px) < 30) return found('A shallow dent darkens the surface.');
  return ok('No dent stood out.');
}

function crease(rgba, width, card, px) {
  if (slanted(rgba, width, card)) return unchecked('POSE_TILT', 'The card is tilted, so a crease was not judged.');
  const art = artBox(card, px);
  let best = 0;
  for (let x = art.x0; x < art.x1; x += Math.max(1, Math.round(px))) {
    let run = 0;
    for (let y = art.y0; y < art.y1; y += 1) {
      const p = sample(rgba, width, x, y);
      const here = lum(p);
      const left = lum(sample(rgba, width, Math.max(0, x - Math.round(px * 2)), y));
      const right = lum(sample(rgba, width, Math.min(width - 1, x + Math.round(px * 2)), y));
      if (here < 130 && p[0] < 150 && left - here > 18 && right - here > 18) run += 1;
      else run = 0;
      if (run > best) best = run;
    }
  }
  if (best > 12 * px) return found('A crease runs down the card.');
  return ok('No crease stood out.');
}

function warp(rgba, width, card, px) {
  const ys = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => card.y + Math.round(card.h * t));
  const xs = ys.map((y) => edgeX(rgba, width, card, y));
  if (xs.some((x) => x < 0)) return unchecked('UNCERTAIN', 'The edge could not be followed.');
  const mid = xs[2];
  const line = (xs[0] + xs[4]) / 2;
  const sag = Math.abs(mid - line) / px;
  if (sag > 0.25) return found('The edge bows. The card may be warped.');
  return ok('The edge is straight.');
}

function glare(rgba, width, card, px) {
  let hot = 0;
  for (let y = card.y; y < card.y + card.h; y += 2) {
    for (let x = card.x; x < card.x + card.w; x += 2) {
      if (lum(sample(rgba, width, x, y)) > 245) hot += 4;
    }
  }
  if (hot / (px * px) > 2) return found('Glare hides part of the card. A sleeve or top-loader can cause this.');
  return ok('No glare stood out.');
}

function nick(rgba, width, card, px) {
  if (slanted(rgba, width, card)) return unchecked('POSE_TILT', 'The card is tilted, so a nick was not judged.');
  const band = Math.round(4 * px);
  let light = 0;
  for (let y = card.y; y < card.y + card.h; y += 2) {
    for (let x = card.x; x < card.x + band; x += 2) {
      const p = sample(rgba, width, x, y);
      if (lum(p) > 180 && Math.abs(p[0] - p[1]) < 20) light += 4;
    }
  }
  if (light / (px * px) > 0.4 && light / (px * px) < 8) return found('A small nick lightens the edge.');
  return ok('No nick stood out.');
}

function findCard(rgba, width, height) {
  const bg = sample(rgba, width, 1, 1);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = sample(rgba, width, x, y);
      const d = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
      if (d > 36) {
        n += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (n < 40 || maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function edgeX(rgba, width, card, y) {
  const bg = sample(rgba, width, 1, 1);
  for (let x = Math.max(0, card.x - 8); x < card.x + card.w; x += 1) {
    const p = sample(rgba, width, x, y);
    const d = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
    if (d > 36) return x;
  }
  return -1;
}

function artBox(card, px) {
  const inset = Math.round(6 * px);
  const x0 = card.x + inset;
  const y0 = card.y + inset;
  const x1 = card.x + card.w - inset;
  const y1 = card.y + card.h - inset;
  return { x0, y0, x1, y1, cx: (x0 + x1) >> 1, cy: (y0 + y1) >> 1 };
}

function sample(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return [rgba[i] || 0, rgba[i + 1] || 0, rgba[i + 2] || 0];
}

function lum(p) {
  return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
}

function ok(note) {
  return { state: 'ok', note, reason: '', tip: '' };
}

function found(note) {
  return { state: 'found', note, reason: '', tip: '' };
}

function unchecked(reason, note) {
  return { state: 'unchecked', note, reason, tip: TIPS[reason] || TIPS.UNCERTAIN };
}

function mapUnchecked(ids, reason, note) {
  const results = {};
  for (const id of ids) results[id] = unchecked(reason, note);
  return results;
}
