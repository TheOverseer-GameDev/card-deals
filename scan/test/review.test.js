/**
 * Accuracy checks for the phase-1 review. The pictures are built here:
 * a gray paper border, a gold frame, a dark name box, and a distinct picture.
 * That is the layout that was being misread. They are not copies of a real card.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkCorrelation } from '../artmatch.js';
import { advanceHold, judgePreview, quadShift } from '../detect.js';
import { inspectSide } from '../edges.js';
import { findQuad, gradeSide, measureCentering, straighten } from '../pipeline.js';

function rgba(width, height, paint) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

function grayOf(pixels, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }
  return gray;
}

function officialCard(seed, borders = { left: 22, right: 22, top: 24, bottom: 24 }) {
  const { left, right, top, bottom } = borders;
  return rgba(500, 700, (x, y) => {
    const paper = x < left || x >= 500 - right || y < top || y >= 700 - bottom;
    if (paper) return [236, 236, 230];
    const gold = x < left + 12 || x >= 500 - right - 12 || y < top + 12 || y >= 700 - bottom - 12;
    if (gold) return [212, 175, 55];
    if (y < top + 78) return [28, 42, 78];
    const v = (x * 3 + y * 5 + seed * 17) % 255;
    return [v, (v * 2 + seed) % 255, (seed * 40 + x) % 255];
  });
}

test('the same card art matches when the official image keeps its border', () => {
  const cards = [];
  for (let seed = 0; seed < 12; seed++) cards.push(officialCard(seed + 1));
  let top1 = 0;
  for (let i = 0; i < cards.length; i++) {
    let best = -2;
    let which = -1;
    for (let j = 0; j < cards.length; j++) {
      const score = artworkCorrelation(cards[i], 500, 700, cards[j], 500, 700);
      if (score > best) {
        best = score;
        which = j;
      }
    }
    if (which === i && best >= 0.72) top1 += 1;
  }
  assert.equal(top1, 12, `top-1 ${top1}/12`);
  const same = artworkCorrelation(cards[0], 500, 700, cards[0], 500, 700);
  assert.ok(same >= 0.9, `same-card correlation ${same}`);
});

test('centering stays within 3 points on a gold frame and hides a wavy border', () => {
  const cases = [
    { left: 30, right: 30, top: 36, bottom: 36 },
    { left: 24, right: 40, top: 30, bottom: 50 },
    { left: 50, right: 22, top: 40, bottom: 28 },
    { left: 36, right: 36, top: 28, bottom: 60 },
  ];
  let hit = 0;
  for (const borders of cases) {
    const pixels = officialCard(3, borders);
    const text = measureCentering(grayOf(pixels, 500, 700), 500, 700);
    const lr = text && text.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/);
    const tb = text && text.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/);
    const truthL = (100 * borders.left) / (borders.left + borders.right);
    const truthT = (100 * borders.top) / (borders.top + borders.bottom);
    const ok = lr && tb
      && Math.abs(Number(lr[1]) - truthL) <= 3
      && Math.abs(Number(tb[1]) - truthT) <= 3;
    if (ok) hit += 1;
  }
  assert.equal(hit, cases.length, `within 3 points ${hit}/${cases.length}`);
  const wavy = rgba(500, 700, (x, y) => {
    const left = 20 + (y % 40 < 20 ? 0 : 14);
    if (x < left || x >= 470 || y < 28 || y >= 672) return [180, 180, 174];
    return [40, 90, 140];
  });
  const wavyText = measureCentering(grayOf(wavy, 500, 700), 500, 700);
  assert.ok(wavyText == null || !/left\/right/.test(wavyText), wavyText);
});

test('a clean gold frame is not called damage, and a real nick still is', () => {
  let flagged = 0;
  for (let seed = 0; seed < 12; seed++) {
    const pixels = officialCard(seed + 1);
    const report = inspectSide(pixels, 500, 700, 'front');
    const bad = report.crops.filter((crop) => crop.trusted && crop.flag !== 'clear');
    if (bad.length) flagged += 1;
  }
  assert.equal(flagged, 0, `clean cards flagged ${flagged}/12`);
  const nicked = rgba(500, 700, (x, y) => (y < 8 && x > 180 && x < 220 ? [12, 12, 12] : [168, 164, 156]));
  const edge = inspectSide(nicked, 500, 700, 'front').crops.find((crop) => crop.id === 'front-edge-top');
  assert.equal(edge.flag, 'ding');
});

test('a missing preview, a bad grade input, a short edge buffer, and a landscape card stay safe', () => {
  const empty = judgePreview(null, 200, 280);
  assert.equal(empty.code, 'too-dark');
  assert.equal(empty.ready, false);
  const nan = new Float32Array(4 * 4);
  nan.fill(NaN);
  const graded = gradeSide(nan, 4, 4, '', true);
  assert.equal(graded.corners.score, null);
  assert.match(graded.corners.note, /Unavailable/);
  assert.doesNotMatch(graded.corners.note, /Whitening/);
  const short = inspectSide(new Uint8ClampedArray(16), 500, 700, 'front');
  assert.equal(short.crops.length, 0);
  const wide = 480;
  const tall = 320;
  const photo = rgba(wide, tall, (x, y) => (x > 40 && x < 440 && y > 40 && y < 280 ? [210, 206, 196] : [18, 22, 28]));
  const found = findQuad(photo, wide, tall, 480, 0.18);
  assert.equal(found.found, true, found.reason);
  const flat = straighten(photo, wide, tall);
  assert.equal(flat.flattened, true);
  assert.equal(flat.width, 500);
  assert.equal(flat.height, 700);
  const broken = [{ x: NaN, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
  const steady = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
  assert.equal(Number.isFinite(quadShift(broken, steady)), false);
  const hold = advanceHold({ since: 0, quad: broken }, { ready: true, quad: steady }, 5000);
  assert.equal(hold.fire, false);
});
