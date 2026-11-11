import assert from 'node:assert/strict';
import test from 'node:test';
import { findStains } from '../stains.js';
import { findCreases } from '../creases.js';
import { findFoilWear } from '../foil.js';
import { readMarks } from '../marks.js';
import { compareReference } from '../consistency.js';
import { printQuality } from '../printq.js';
import { estimateRange } from '../range.js';
import { gradingWorth } from '../worth.js';
import { createMemoryHistory, presentScan, saveScan } from '../history.js';

function paint(width, height, pixel) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('short buffers are unchecked instead of read past the end', () => {
  const tiny = new Uint8ClampedArray(8);
  assert.equal(findStains(tiny, 40, 40).status, 'unchecked');
  assert.equal(findCreases(tiny, 40, 40).status, 'unchecked');
  assert.equal(findCreases(tiny, Number.NaN, 80).status, 'unchecked');
  assert.equal(findCreases(tiny, 80, Number.NaN).status, 'unchecked');
  assert.equal(findFoilWear(tiny, 40, 40).status, 'unchecked');
  assert.match(readMarks(tiny, 40, 40, '').note, /too small|not a missing stamp/);
  assert.match(compareReference({ rgba: tiny, width: 40, height: 40 }, { rgba: tiny, width: 40, height: 40 }).note, /not compared|too small|consistent|inconsistent/);
  assert.match(printQuality(tiny, 40, 40, null).note, /too small/);
});

test('a dark patch is a possible stain and a flat photo is not', () => {
  const clean = paint(96, 128, () => [180, 180, 180]);
  const clear = findStains(clean, 96, 128);
  assert.equal(clear.status, 'clear');
  assert.match(clear.note, /No stain/);
  const marked = paint(96, 128, (x, y) => (x > 40 && x < 62 && y > 50 && y < 72 ? [30, 30, 30] : [180, 180, 180]));
  const stain = findStains(marked, 96, 128);
  assert.equal(stain.status, 'marked');
  assert.match(stain.note, /fingerprint/);
  const dark = paint(96, 128, () => [20, 20, 20]);
  assert.equal(findStains(dark, 96, 128).status, 'unchecked');
});

test('a local shading step can be a crease and a whole-card gradient is not', () => {
  const ridge = paint(80, 80, (x) => (x >= 36 && x <= 48 ? [90, 90, 90] : [170, 170, 170]));
  const crease = findCreases(ridge, 80, 80);
  assert.equal(crease.status, 'marked');
  assert.match(crease.note, /crease or a dent/);
  const gradient = paint(80, 80, (x) => {
    const v = Math.round(80 + x * 1.4);
    return [v, v, v];
  });
  assert.equal(findCreases(gradient, 80, 80).status, 'unchecked');
  assert.match(findCreases(gradient, 80, 80).note, /not separated from the light/);
});

test('foil wear is a dull patch inside reflective color, not a claim the card is holo', () => {
  const plain = paint(60, 60, () => [140, 140, 140]);
  assert.match(findFoilWear(plain, 60, 60).note, /does not mean the card has no foil/);
  const worn = paint(60, 60, (x, y) => {
    const inside = x > 12 && x < 48 && y > 12 && y < 42;
    const hole = x > 24 && x < 38 && y > 20 && y < 34;
    if (hole) return [120, 120, 120];
    if (!inside) return [140, 140, 140];
    return x % 3 === 0 ? [220, 40, 40] : x % 3 === 1 ? [40, 200, 60] : [40, 60, 220];
  });
  const foil = findFoilWear(worn, 60, 60);
  assert.equal(foil.status, 'marked');
  assert.match(foil.note, /foil wear/);
  assert.doesNotMatch(foil.note, /this card is holo|genuine/i);
});

test('edition words come only from text that was already read', () => {
  const blank = paint(96, 128, () => [150, 150, 150]);
  assert.match(readMarks(blank, 96, 128, '').note, /not a missing stamp/);
  const words = readMarks(blank, 96, 128, 'Blue-Eyes 1st Edition Ultra Rare');
  assert.match(words.note, /1st Edition/);
  assert.match(words.note, /rarity word/);
  assert.match(words.note, /not identified/);
  const stamped = paint(96, 128, (x, y) => (x > 8 && x < 24 && y > 108 && y < 120 ? [240, 240, 240] : [150, 150, 150]));
  const mark = readMarks(stamped, 96, 128, '');
  assert.match(mark.note, /compact mark/);
  assert.doesNotMatch(mark.note, /1st Edition/);
});

test('a reference comparison says consistent or inconsistent and never real or fake', () => {
  const card = paint(80, 100, () => [200, 200, 210]);
  const same = compareReference({ rgba: card, width: 80, height: 100 }, { rgba: card, width: 80, height: 100 });
  assert.match(same.note, /looks consistent/);
  const other = paint(80, 100, (x, y) => (y < 6 ? [20, 20, 20] : [200, 200, 210]));
  const shifted = compareReference({ rgba: card, width: 80, height: 100 }, { rgba: other, width: 80, height: 100 });
  assert.match(shifted.note, /looks inconsistent/);
  const none = compareReference({ rgba: card, width: 80, height: 100 }, null);
  assert.match(none.note, /were not compared/);
  for (const note of [same.note, shifted.note, none.note]) {
    assert.doesNotMatch(note, /\breal\b|\bfake\b|genuine|counterfeit/i);
  }
});

test('print quality names blur, blocky pixels, and a missing color reference', () => {
  const flat = paint(48, 48, () => [128, 128, 128]);
  const blur = printQuality(flat, 48, 48, null);
  assert.equal(blur.poor, true);
  assert.match(blur.note, /blurry/);
  assert.match(blur.note, /no reference image/);
  const sharp = paint(48, 48, (x, y) => ((x + y) % 2 ? [20, 20, 20] : [230, 230, 230]));
  const blocks = paint(48, 48, (x) => (Math.floor(x / 8) % 2 ? [30, 30, 30] : [220, 220, 220]));
  const pixel = printQuality(blocks, 48, 48, { rgba: sharp, width: 48, height: 48 });
  assert.match(pixel.note, /pixelation/);
  assert.match(pixel.note, /not a print-run verdict/);
});

test('the grade estimate stays a range and widens when the photo is poor', () => {
  const missing = estimateRange({ range: null }, { poor: false });
  assert.equal(missing.low, null);
  assert.match(missing.text, /Unavailable/);
  const tight = estimateRange({ range: [8, 8] }, { poor: false });
  assert.notEqual(tight.low, tight.high);
  assert.match(tight.text, /PSA \d+–\d+/);
  assert.match(tight.notes.join(' '), /not a single promised grade/);
  const poor = estimateRange({ range: [8, 9] }, { poor: true });
  assert.equal(poor.confidence, 'low');
  assert.ok(poor.low < 8);
  assert.match(poor.notes.join(' '), /Low confidence/);
});

test('the grading check is CAD-first and leaves missing prices and fees unavailable', () => {
  const grades = {
    ungraded: [{ status: 'value', price: 10, currency: 'USD' }],
    psa8: [{ status: 'unavailable', price: null, currency: null }],
    psa9: [{ status: 'value', price: 40, currency: 'USD' }],
  };
  const noFee = gradingWorth({ grades, low: 8, high: 9, feeCad: '', rate: 1.4 });
  assert.match(noFee.text, /Ungraded: CAD 14\.00/);
  assert.match(noFee.text, /PSA 8: Unavailable/);
  assert.match(noFee.text, /PSA 9: CAD 56\.00/);
  assert.match(noFee.text, /Grading fee: Unavailable/);
  const compared = gradingWorth({ grades, low: 9, high: 9, feeCad: '20', rate: 1.4 });
  assert.match(compared.text, /larger than the fee/);
  assert.match(compared.text, /not a recommendation/);
  const small = gradingWorth({ grades, low: 9, high: 9, feeCad: 80, rate: 1.4 });
  assert.match(small.text, /not larger than the fee/);
  const noRate = gradingWorth({ grades, low: 9, high: 9, feeCad: 20, rate: null });
  assert.match(noRate.text, /Unavailable/);
  assert.doesNotMatch(noRate.text, /CAD 14/);
});

test('an old automatic centering pair is hidden and a tagged row is kept', () => {
  const oldRow = presentScan({ summary: 'Estimate: PSA 7–8. Centering: 48.0/52.0 left/right.' });
  assert.match(oldRow, /older automatic centering number is hidden/);
  assert.doesNotMatch(oldRow, /48\.0\/52\.0/);
  assert.doesNotMatch(oldRow, /Estimate:\s*PSA/);
  const autoRow = presentScan({ summary: 'Estimate: PSA 8–9. Centering 50.0/50.0 left/right (auto).' });
  assert.match(autoRow, /older automatic centering number is hidden/);
  assert.doesNotMatch(autoRow, /PSA/);
  assert.doesNotMatch(autoRow, /\(auto\)/);
  assert.doesNotMatch(autoRow, /50\.0\/50\.0/);
  assert.equal(presentScan({ version: 2, summary: 'Estimate: PSA 7–8. Measured 55.0/45.0 left/right.' }), 'Estimate: PSA 7–8. Measured 55.0/45.0 left/right.');
});

test('scan history stays in the store, deletes, and stops when storage is full', async () => {
  const memory = createMemoryHistory();
  const saved = await saveScan(memory, { at: 1, name: 'Blue-Eyes', summary: 'PSA 8–9' });
  assert.equal(saved.saved, true);
  assert.equal((await memory.list())[0].name, 'Blue-Eyes');
  await memory.clear();
  assert.equal((await memory.list()).length, 0);

  let fails = 1;
  const flaky = {
    rows: [{ id: 1, at: 1, name: 'Old' }],
    async list() { return this.rows.map((row) => ({ ...row })); },
    async add(entry) {
      if (fails) {
        fails -= 1;
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      }
      this.rows.unshift({ ...entry, id: 2 });
      return 2;
    },
    async delete(id) { this.rows = this.rows.filter((row) => row.id !== id); },
    async clear() { this.rows = []; },
  };
  const trimmed = await saveScan(flaky, { at: 2, name: 'New', summary: 'PSA 7–8' });
  assert.equal(trimmed.trimmed, true);
  assert.equal(flaky.rows.some((row) => row.name === 'Old'), false);

  const blocked = {
    async list() { return [{ id: 1 }]; },
    async add() {
      const err = new Error('full');
      err.name = 'QuotaExceededError';
      throw err;
    },
    async delete() {},
    async clear() {},
  };
  const full = await saveScan(blocked, { at: 3, name: 'Nope', summary: '' });
  assert.equal(full.saved, false);
  assert.match(full.reason, /out of room/);
});
