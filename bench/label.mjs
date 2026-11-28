/**
 * One labeler for every bench image. Recipes carry parameters.
 * Labels carry the truth those parameters imply. Nothing else invents a label.
 */

const ASPECT = { ygo: 59 / 86, mtg: 63 / 88 };
const MM = { ygo: [59, 86], mtg: [63, 88] };

export function labelFromParams(params) {
  const game = params.game === 'mtg' ? 'mtg' : 'ygo';
  const [cardMmW, cardMmH] = MM[game];
  const wanted = ASPECT[game];
  const padPx = params.padPx ?? 0;
  const rect = {
    x: padPx,
    y: padPx,
    w: params.cardW,
    h: params.cardH,
  };
  const imageW = params.cardW + padPx * 2;
  const imageH = params.cardH + padPx * 2;
  const aspect = rect.w / rect.h;
  const pxPerMm = rect.w / cardMmW;
  const reasons = [];
  if (params.multi) reasons.push('MULTIPLE_CARDS');
  if (params.noCard) reasons.push('NO_CARD');
  const gap = aspect > wanted * 1.02 && aspect < ASPECT.mtg * 0.98;
  const inBand = Math.abs(aspect - wanted) / wanted <= 0.02;
  if (!inBand || gap) reasons.push('NOT_CARD_SHAPED');
  if (pxPerMm < 8) reasons.push('LOW_RES');
  if (Math.abs(params.tiltDeg || 0) > 3) reasons.push('POSE_TILT');
  if ((params.shear || 0) > 0.08) reasons.push('NOT_PARALLEL');
  if (params.lowContrast) reasons.push('LOW_BG_CONTRAST');
  if (params.imageBounded && !inBand) reasons.push('IMAGE_BOUNDED_RIM');
  const gate = reasons[0] || 'ok';
  const cx = imageW / 2;
  const cy = imageH / 2;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ].map((p) => rotate(p.x, p.y, cx, cy, params.rotDeg || 0));
  const lr = clampPct(params.lr ?? 50);
  const tb = clampPct(params.tb ?? 50);
  return {
    id: params.id,
    family: params.family,
    game,
    image: { w: imageW, h: imageH },
    rect,
    aspect: round4(aspect),
    pxPerMm: round4(pxPerMm),
    gate,
    reasons,
    quad: corners,
    centering: { lr, tb },
    tiltDeg: params.tiltDeg || 0,
    rotDeg: params.rotDeg || 0,
    defects: params.defects || [],
    imageBounded: Boolean(params.imageBounded),
    dangerousIfFifty: Math.abs(lr - 50) > 3 || Math.abs(tb - 50) > 3,
  };
}

export function labelSelftest() {
  const base = {
    id: 'self',
    family: 'P',
    game: 'ygo',
    cardW: 59 * 10,
    cardH: 86 * 10,
    padPx: 40,
    lr: 50,
    tb: 50,
    tiltDeg: 0,
    rotDeg: 0,
  };
  const a = labelFromParams(base);
  const b = labelFromParams(base);
  const moved = labelFromParams({ ...base, lr: 70 });
  const square = labelFromParams({ ...base, id: 'sq', family: 'X', cardW: 400, cardH: 400, padPx: 0 });
  return {
    stable: JSON.stringify(a) === JSON.stringify(b),
    centeringMoves: a.centering.lr !== moved.centering.lr,
    squareRefused: square.gate === 'NOT_CARD_SHAPED',
    flatOk: a.gate === 'ok' || a.reasons.includes('LOW_RES') || a.reasons.includes('NOT_CARD_SHAPED'),
  };
}

function rotate(x, y, cx, cy, deg) {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: round4(cx + dx * c - dy * s),
    y: round4(cy + dx * s + dy * c),
  };
}

function clampPct(n) {
  return Math.max(25, Math.min(75, n));
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
