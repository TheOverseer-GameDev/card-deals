/**
 * A usable card photo always gets a best estimate.
 * Unseen areas widen the range. They are not treated as perfect or as ruined.
 * Only a photo with no card is refused.
 */

const DAMAGE = {
  stain: 7,
  whitening: 7,
  ding: 6,
  scratch: 8,
  dent: 7,
  crease: 6,
  warp: 6,
  nick: 6,
  foil: 8,
  print: 7,
  authenticity: 4,
  glare: 8,
};

export function gradeEstimate({ hasCard, seen } = {}) {
  if (!hasCard) {
    return {
      refused: true,
      message: 'No card in this photo.',
      point: null,
      low: null,
      high: null,
      confidence: null,
      reason: 'No card edge was found.',
    };
  }
  const checks = seen || {};
  let point = 10;
  let unseen = 0;
  let estimated = 0;
  for (const [id, item] of Object.entries(checks)) {
    const state = item && item.state;
    if (state === 'unseen') {
      unseen += 1;
      continue;
    }
    if (state === 'estimated') estimated += 1;
    if (state === 'found' || item.hit) point = Math.min(point, DAMAGE[id] ?? 8);
    if (id === 'centering' && item && Number.isFinite(item.cap)) point = Math.min(point, item.cap);
  }
  point = Math.max(1, Math.min(10, point));
  let confidence;
  let reason;
  let low;
  let high;
  if (unseen >= 2) {
    confidence = 'Low';
    reason = 'Some areas could not be seen, so this grade is partly guessed.';
    low = Math.max(1, point - 6);
    high = Math.min(10, point + 1);
  } else if (unseen || estimated) {
    confidence = 'Medium';
    reason = 'Part of the photo is unclear, so the range is wider.';
    low = Math.max(1, point - 3);
    high = Math.min(10, point + 1);
  } else {
    confidence = 'High';
    reason = 'The checks that affect the grade were measured.';
    low = Math.max(1, point - 1);
    high = point;
  }
  const span = high - low;
  const wide = confidence === 'Low' && span >= 4;
  if (wide) point = Math.round((low + high) / 2);
  return {
    refused: false,
    point,
    low,
    high,
    confidence,
    reason,
    headline: wide ? `PSA ${low}–${high}, likely ~${point}.` : `Most likely PSA ${point}.`,
    rangeText: wide ? '' : `Range PSA ${low}–${high}.`,
  };
}

export function covers(truth, estimate) {
  return Boolean(estimate && !estimate.refused && truth >= estimate.low && truth <= estimate.high);
}
