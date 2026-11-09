import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatGuide,
  gradePhoto,
  gradeSide,
  measureCentering,
  normalizeSetCode,
  positiveGuide,
  rowsFromCardInfo,
  straighten,
} from '../pipeline.js';

function fill(width, height, paint) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function cardPhoto() {
  const width = 480;
  const height = 640;
  return {
    width,
    height,
    rgba: fill(width, height, (x, y) => {
      const inside = x >= 90 && x < 390 && y >= 80 && y < 560;
      return inside ? [210, 206, 196] : [18, 22, 28];
    }),
  };
}

test('a rectangular card straightens to 500x700 and a blank photo stays tilted', () => {
  const photo = cardPhoto();
  const flat = straighten(photo.rgba, photo.width, photo.height);
  assert.equal(flat.flattened, true, 'card should straighten');
  assert.equal(flat.width, 500);
  assert.equal(flat.height, 700);
  const blank = fill(200, 260, () => [30, 30, 30]);
  const tilted = straighten(blank, 200, 260);
  assert.equal(tilted.flattened, false);
});

test('zero is unavailable and CAD is not a relabeled USD figure', () => {
  assert.equal(positiveGuide(0), null);
  assert.equal(positiveGuide('0.00'), null);
  assert.equal(positiveGuide(1.25), 1.25);
  const missing = formatGuide(0, 1.4, '2026-11-09');
  assert.equal(missing.cadText, 'Unavailable');
  assert.equal(missing.usdText, 'Unavailable');
  const noRate = formatGuide(10, null, null);
  assert.equal(noRate.cadText, 'Unavailable');
  assert.equal(noRate.usdText, 'USD 10.00');
  assert.match(noRate.note, /USD is not labeled as CAD/);
  const rated = formatGuide(10, 1.36, '2026-11-09');
  assert.equal(rated.cadText, 'CAD 13.60');
  assert.equal(rated.usdText, 'USD 10.00');
});

test('set codes stay printed and a zero guide is dropped', () => {
  assert.equal(normalizeSetCode('LOB-005'), 'LOB-005');
  assert.equal(normalizeSetCode('lob005'), 'LOB-005');
  assert.equal(normalizeSetCode('LAVD-ENO34'), 'LAVD-ENO34');
  assert.notEqual(normalizeSetCode('LAVD-ENO34'), 'LAVD-EN034');
  const rows = rowsFromCardInfo('LAVD-ENO34', {
    data: [{
      id: 15032,
      name: 'Accesscode Talker',
      card_sets: [{ set_code: 'LAVD-ENO34', set_name: 'Legendary Arc-V Decks', set_rarity: 'Ultra Rare', set_price: '0' }],
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'LAVD-ENO34');
  assert.equal(rows[0].price, null);
  const none = rowsFromCardInfo('ZZZZ-EN999', { data: [] });
  assert.equal(none.length, 0);
  const many = rowsFromCardInfo('RA01-EN008', {
    data: [{
      id: 1,
      name: 'Ash Blossom & Joyous Spring',
      card_sets: [
        { set_code: 'RA01-EN008', set_rarity: 'Collector\'s Rare', set_price: '0' },
        { set_code: 'RA01-EN008', set_rarity: 'Ultra Rare', set_price: '2.5' },
        { set_code: 'RA04-EN025', set_rarity: 'Ultra Rare', set_price: '9' },
      ],
    }],
  });
  assert.equal(many.length, 2);
  assert.equal(many[0].price, null);
  assert.equal(many[1].price, 2.5);
});

test('front centering cutoffs and four marks still grade a dark or glaring photo', () => {
  const width = 500;
  const height = 700;
  function bordered(left, right, top, bottom, paint) {
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge = x < left || x >= width - right || y < top || y >= height - bottom;
        gray[y * width + x] = edge ? 20 : (paint ? paint(x, y) : 140);
      }
    }
    return gray;
  }
  const even = bordered(40, 40, 50, 50);
  const text = measureCentering(even, width, height);
  assert.match(text, /left\/right/);
  const sixty = 'Centering: 60.0/40.0 left/right. 50.0/50.0 top/bottom.';
  const fifty = 'Centering: 55.0/45.0 left/right. 50.0/50.0 top/bottom.';
  const nine = gradeSide(even, width, height, sixty, true);
  const ten = gradeSide(even, width, height, fifty, true);
  assert.equal(nine.centering.score, 9);
  assert.equal(ten.centering.score, 10);
  assert.equal(nine.corners.score != null && nine.edges.score != null && nine.surface.score != null, true);
  const dark = bordered(40, 40, 50, 50, () => 20);
  const darkGrade = gradePhoto({
    front: { flattened: true, marks: gradeSide(dark, width, height, fifty, true) },
    back: null,
    frontBack: false,
  });
  assert.match(darkGrade.headline, /Estimate: PSA/);
  assert.match(darkGrade.detail, /Photo estimate only, not a PSA grade/);
  const glare = bordered(40, 40, 50, 50, (x, y) => (x > 200 && x < 300 && y > 250 && y < 450 ? 250 : 140));
  const glareMarks = gradeSide(glare, width, height, fifty, true);
  assert.match(glareMarks.surface.note, /Glare/);
  const glareGrade = gradePhoto({
    front: { flattened: true, marks: glareMarks },
    back: { flattened: true, marks: gradeSide(even, width, height, fifty, true, true) },
    frontBack: true,
  });
  assert.match(glareGrade.headline, /Estimate: PSA/);
  const tilted = gradeSide(even, width, height, null, false);
  assert.equal(tilted.corners.note, 'Tilted. Not checked.');
  const tiltedCard = gradePhoto({
    front: { flattened: false, marks: tilted },
    back: null,
    frontBack: true,
  });
  assert.match(tiltedCard.notes.join(' '), /Front is tilted/);
  assert.match(tiltedCard.notes.join(' '), /No back photo/);
});
