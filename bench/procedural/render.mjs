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
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = rotate(x, y, cx, cy, -(params.rotDeg || 0));
      let rgb = bg;
      if (insideRound(src.x, src.y, label.rect, radius)) {
        const lx = src.x - label.rect.x;
        const ly = src.y - label.rect.y;
        const onBorder = lx < borderPx.l || lx > label.rect.w - borderPx.r
          || ly < borderPx.t || ly > label.rect.h - borderPx.b;
        rgb = onBorder ? border : art;
        if (params.glare && ly < label.rect.h * 0.18 && lx > label.rect.w * 0.6) rgb = [250, 250, 250];
        if (params.defects && params.defects.length && onBorder && lx < borderPx.l && ly < radius + label.pxPerMm * 4) {
          rgb = [230, 230, 230];
        }
      }
      if (params.degrade === 'noise') {
        const n = ((x * 13 + y * 7) % 11) - 5;
        rgb = rgb.map((c) => Math.max(0, Math.min(255, c + n)));
      }
      setPixel(buf, w, x, y, rgb);
    }
  }
  return buf;
}

function borderWidths(label, params) {
  const px = Math.max(2, label.pxPerMm * 3);
  const lr = (params.lr ?? 50) / 100;
  const tb = (params.tb ?? 50) / 100;
  const horiz = px * 2;
  const vert = px * 2;
  return {
    l: horiz * lr,
    r: horiz * (1 - lr),
    t: vert * tb,
    b: vert * (1 - tb),
  };
}
