import { insideRound, rotate, setPixel } from '../lib/image.mjs';

const BORDER = [24, 28, 36];
const ART = [186, 168, 120];
const BG = [18, 42, 84];
const DARK = [8, 8, 10];

/** Draw one procedural card. Pixels stay in memory. */
export function render(label, params) {
  const { w, h } = label.image;
  const buf = new Uint8ClampedArray(w * h * 4);
  const bg = params.lowContrast ? DARK : params.imageBounded ? BORDER : BG;
  const border = params.lowContrast ? DARK : BORDER;
  const art = params.lowContrast ? [16, 16, 18] : ART;
  const radius = Math.max(2, label.pxPerMm * 2);
  const borderPx = borderWidths(label, params);
  const cx = w / 2;
  const cy = h / 2;
  const warp = (params.defects || []).some((item) => item.type === 'warp');
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = rotate(x, y, cx, cy, -(params.rotDeg || 0));
      const t = (src.y - label.rect.y) / label.rect.h;
      const sag = warp ? Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * label.pxPerMm * 1.2 : 0;
      const rect = sag ? { ...label.rect, x: label.rect.x + sag } : label.rect;
      let rgb = bg;
      if (insideRound(src.x, src.y, rect, radius)) {
        const lx = src.x - rect.x;
        const ly = src.y - rect.y;
        const onBorder = lx < borderPx.l || lx > rect.w - borderPx.r
          || ly < borderPx.t || ly > rect.h - borderPx.b;
        rgb = onBorder ? border : art;
        const mark = defectColor(lx, ly, label, params, onBorder, bg);
        if (mark) rgb = mark;
        if (params.glare && ly < rect.h * 0.18 && lx > rect.w * 0.6) rgb = [250, 250, 250];
      }
      if (params.degrade === 'noise') {
        const n = ((x * 13 + y * 7) % 11) - 5;
        rgb = [rgb[0] + n, rgb[1] + n, rgb[2] + n].map((c) => Math.max(0, Math.min(255, c)));
      }
      setPixel(buf, w, x, y, rgb);
    }
  }
  return buf;
}

function defectColor(lx, ly, label, params, onBorder, bg) {
  const px = label.pxPerMm || 1;
  for (const defect of params.defects || []) {
    const dx = lx / px - defect.xMm;
    const dy = ly / px - defect.yMm;
    if (defect.type === 'stain' && !onBorder && dx * dx + dy * dy < 2.25) return [30, 20, 15];
    if (defect.type === 'whitening' && onBorder && dx * dx + dy * dy < 3.2) return [236, 232, 220];
    if (defect.type === 'ding' && onBorder && dx > -0.2 && dx < 1.6 && dy > -1 && dy < 2.2) return bg;
    if (defect.type === 'nick' && onBorder && dx * dx + dy * dy < 1.2) return [232, 232, 226];
    if (defect.type === 'scratch' && !onBorder && Math.abs(dy) < 0.2 && dx > 0 && dx < 9) return [232, 224, 204];
    if (defect.type === 'dent' && !onBorder && dx * dx + dy * dy < 3.2) return [150, 130, 90];
    if (defect.type === 'crease' && !onBorder && Math.abs(dx) < 0.45 && Math.abs(dy) < 16) return [118, 98, 68];
    if (defect.type === 'foil' && !onBorder && Math.abs(dx) < 10 && Math.abs(dy) < 8) {
      if (dx * dx + dy * dy < 2.6) return [142, 142, 142];
      return [36, 92, 214];
    }
    if (defect.type === 'edition' && !onBorder && dx > -1.5 && dx < 2.4 && dy > -0.8 && dy < 1.6) return [4, 4, 4];
    if (defect.type === 'authenticity' && onBorder) return [148, 36, 36];
    if (defect.type === 'print' && !onBorder && Math.abs((ly / px) % 4) < 0.3) return [110, 92, 60];
    if (defect.type === 'glare' && dx * dx + dy * dy < 8) return [252, 252, 252];
  }
  return null;
}

function borderWidths(label, params) {
  const px = Math.max(2, label.pxPerMm * 3);
  const lr = (params.lr ?? 50) / 100;
  const tb = (params.tb ?? 50) / 100;
  return { l: px * 2 * lr, r: px * 2 * (1 - lr), t: px * 2 * tb, b: px * 2 * (1 - tb) };
}
