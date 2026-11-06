import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';
import {
  assessPhoto,
  captureSize,
  catalogFromSite,
  clampCrop,
  extractSetCodes,
  fileMessage,
  formatUsd,
  identityFields,
  localPath,
  matchText,
  measureCentering,
  needsCodePass,
  parsePrintName,
  priceReport,
  searchCatalog,
  suggestCrop,
  validateFile,
  validateVerifiedFile,
} from '../engine.js';
import { createSession, readCardImage } from '../ocr.js';
import { createLookup } from '../lookup.js';

function loadSite() {
  const raw = fs.readFileSync(new URL('../../data.js', import.meta.url), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('=') + 1).replace(/;\s*$/, ''));
}

const D = loadSite();
const rows = catalogFromSite(D);
const byName = (name) => rows.find((row) => row.name === name);

test('catalog keeps deal rows and does not invent grade prices', () => {
  assert.ok(rows.length > 100);
  const gemini = byName('Gemini Elf [1st Edition] LON-000');
  assert.equal(gemini.parsed.setCode, 'LON-000');
  assert.equal(gemini.parsed.edition, '1st Edition');
  assert.equal(gemini.parsed.language, null);
  assert.equal(gemini.snapshot.ungraded, 79.1);
  assert.equal(gemini.snapshot.psa5, undefined);
  const brain = byName('Braingeyser');
  assert.equal(brain.snapshot.psa10, null);
  assert.equal(brain.slug, 'magic-alpha');
  assert.equal(byName("Lion's Eye Diamond").slug, 'magic-mirage');
  const coll = rows.find((row) => row.kind === 'collection');
  assert.equal(coll.parsed.setCode, 'TN23-EN014');
  assert.equal(coll.snapshot.ungraded, null);
  assert.equal(JSON.stringify(rows).includes('psa10_odds'), false);
  assert.equal(JSON.stringify(rows).includes('grade10_rate'), false);
});

test('every loaded Yu-Gi-Oh name still finds its own row', () => {
  for (const row of rows.filter((item) => item.game === 'ygo')) {
    const found = matchText(rows, row.name);
    assert.equal(found.confirmation, 'required');
    assert.ok(found.candidates.some((item) => item.key === row.key), row.name);
  }
});

test('set code match stays unconfirmed and name-only matches stay ambiguous', () => {
  const exact = matchText(rows, 'LON-000');
  assert.equal(exact.candidates.length, 1);
  assert.equal(exact.candidates[0].exactCode, true);
  assert.equal(exact.ambiguous, false);
  assert.equal(exact.confirmation, 'required');
  const nibiru = matchText(rows, 'RA05-EN094');
  assert.ok(nibiru.candidates.length > 1);
  assert.equal(nibiru.ambiguous, true);
  const lotus = matchText(rows, 'Black Lotus');
  assert.ok(lotus.candidates.length > 1);
  assert.ok(lotus.candidates.every((item) => !item.exactCode));
  const jets = matchText(rows, 'Mox Jet #259');
  const names = jets.candidates.map((item) => rows.find((row) => row.key === item.key).name);
  assert.ok(names.some((name) => name.includes('#259')));
  assert.equal(names.some((name) => name.includes('#263')), false);
});

test('fuzzy set codes and edition disagreements are labelled, not treated as exact', () => {
  const fuzzy = matchText(rows, 'Gemini Elf LON-O00');
  assert.equal(fuzzy.candidates.length, 1);
  assert.equal(fuzzy.candidates[0].fuzzyCode, true);
  assert.equal(fuzzy.candidates[0].exactCode, false);
  assert.match(fuzzy.candidates[0].evidence.join(' '), /not an exact code match/);
  const clash = matchText(rows, 'Unlimited LON-000');
  assert.equal(clash.candidates[0].disagreements.length > 0, true);
  assert.equal(clash.ambiguous, true);
  const parsed = parsePrintName('Blue-Eyes White Dragon [Ultra Rare] LC01-EN004');
  assert.equal(parsed.language, 'English');
  assert.equal(parsed.rarity, 'Ultra Rare');
  assert.equal(parsePrintName('Accesscode Talker LAVD-ENO34').language, null);
  assert.equal(needsCodePass('hello there'), true);
  assert.equal(needsCodePass('seen LON-000 already'), false);
  assert.deepEqual(extractSetCodes('code LON - 000'), ['LON-000']);
});

test('unknown text and empty text do not pick a card', () => {
  const none = matchText(rows, 'zzzz qqqq');
  assert.equal(none.candidates.length, 0);
  assert.equal(none.confirmation, 'required');
  const empty = matchText(rows, '   ');
  assert.equal(empty.empty, true);
  assert.equal(empty.candidates.length, 0);
  const hits = searchCatalog(rows, 'gemini elf');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].parsed.setCode, 'LON-000');
});

test('price table uses only stored figures and never fills missing grades', () => {
  const gemini = byName('Gemini Elf [1st Edition] LON-000');
  const history = JSON.parse(fs.readFileSync(new URL('../../h/ygo/c0920c088bce.json', import.meta.url), 'utf8'));
  const now = Date.parse('2026-11-05T18:00:00Z');
  const report = priceReport(gemini, history, null, now);
  const rawLines = report.grades.ungraded.filter((line) => line.status === 'value');
  const prices = rawLines.map((line) => line.price);
  assert.ok(prices.includes(79.1));
  const histPrice = rawLines.find((line) => line.kind === 'history').price;
  assert.notEqual(histPrice, 79.1);
  assert.equal(prices.includes((79.1 + histPrice) / 2), false);
  assert.equal(report.grades.psa5[0].status, 'unavailable');
  assert.equal(report.grades.psa6[0].status, 'unavailable');
  assert.equal(report.grades.psa7[0].status, 'unavailable');
  assert.equal(report.grades.psa8[0].status, 'unavailable');
  assert.equal(report.grades.psa9.some((line) => line.price === 210.08), true);
  assert.equal(rawLines.every((line) => line.salesCount == null), true);
  assert.equal(rawLines.some((line) => line.volumeText === '1 sale per week'), true);
  assert.equal(JSON.stringify(report).includes('odds'), false);
  const brain = priceReport(byName('Braingeyser'), { raw: [[1, 10]], p10: [[1, 0], [2, 0]] }, null, now);
  assert.equal(brain.grades.psa10[0].status, 'unavailable');
  assert.equal(JSON.stringify(brain.grades.psa10).includes('"price":0'), false);
  const verified = validateVerifiedFile({
    prints: {
      [`${gemini.game}:${gemini.id}`]: {
        grades: {
          psa8: {
            price: 40,
            currency: 'USD',
            source: 'PriceCharting',
            source_url: 'https://www.pricecharting.com/example',
            observed_at: '2020-01-01T00:00:00Z',
            sales_count: 3,
          },
          psa7: { price: 30, currency: 'USD', source: 'PriceCharting' },
          psa6: { price: 0, currency: 'USD', source: 'PriceCharting', observed_at: '2026-11-01T00:00:00Z' },
        },
      },
    },
  }, now);
  const withVerified = priceReport(gemini, null, verified.prints[`${gemini.game}:${gemini.id}`], now);
  assert.equal(withVerified.grades.psa8[0].kind, 'verified');
  assert.equal(withVerified.grades.psa8[0].salesCount, 3);
  assert.equal(withVerified.grades.psa8[0].stale, true);
  assert.equal(withVerified.grades.psa7[0].status, 'unavailable');
  assert.equal(withVerified.grades.psa6[0].status, 'unavailable');
  assert.equal(withVerified.grades.psa9[0].kind, 'snapshot');
  const fields = identityFields(byName('Braingeyser'));
  assert.equal(fields.find((item) => item[0] === 'Set code')[1], 'Unavailable');
  assert.equal(fields.find((item) => item[0] === 'Language')[1], 'Unavailable');
  assert.equal(fields.find((item) => item[0] === 'Set name')[1], 'Unavailable');
  assert.notEqual(fields.find((item) => item[0] === 'Language')[1], 'English');
});

test('verified file drops incomplete grades and bad urls', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const result = validateVerifiedFile({
    prints: {
      'ygo:ok': {
        grades: {
          psa9: {
            price: 12,
            currency: 'USD',
            source: 'Shop',
            observed_at: '2026-11-01T00:00:00Z',
            odds: 0.99,
          },
        },
      },
      'nope:1': { grades: { psa9: { price: 5, currency: 'USD', source: 'Shop', observed_at: '2026-11-01T00:00:00Z' } } },
    },
  }, now);
  assert.equal(result.prints['ygo:ok'].grades.psa9.price, 12);
  assert.equal(JSON.stringify(result.prints).includes('odds'), false);
  assert.equal(result.prints['nope:1'], undefined);
  assert.ok(result.rejected.length >= 1);
});

test('lookups are local, deduped, and do not cache failures', async () => {
  assert.throws(() => localPath('https://api.openai.com/v1/chat/completions'), /non-local/);
  assert.throws(() => localPath('//cdn.jsdelivr.net/tesseract'), /non-local/);
  assert.equal(localPath('h/ygo/abc.json'), 'h/ygo/abc.json');
  let calls = 0;
  let status = 200;
  const lookup = createLookup(async (url) => {
    calls += 1;
    if (String(url).includes('verified')) return { ok: true, json: async () => ({ prints: {} }) };
    if (status === 500) return { ok: false, status: 500 };
    if (status === 404) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ raw: [[10, 5]] }) };
  });
  const gemini = byName('Gemini Elf [1st Edition] LON-000');
  const [a, b] = await Promise.all([lookup.history('ygo', gemini.id), lookup.history('ygo', gemini.id)]);
  assert.equal(a.raw[0][1], 5);
  assert.equal(b.raw[0][1], 5);
  assert.equal(calls, 1);
  await lookup.history('ygo', gemini.id);
  assert.equal(calls, 1);
  assert.equal(await lookup.history('ygo', '../sw'), null);
  assert.equal(calls, 1);
  status = 500;
  const other = createLookup(async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => other.history('mtg', 'abc'));
  await assert.rejects(() => other.history('mtg', 'abc'));
  status = 404;
  const missing = createLookup(async (url) => {
    calls += 1;
    if (String(url).endsWith('missing.json')) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ prints: {} }) };
  });
  assert.equal(await missing.history('ygo', 'missing'), null);
  const before = calls;
  assert.equal(await missing.history('ygo', 'missing'), null);
  assert.equal(calls, before);
  const report = await lookup.report(gemini, Date.parse('2026-11-05T00:00:00Z'));
  assert.equal(report.grades.ungraded.some((line) => line.kind === 'snapshot'), true);
  assert.equal(report.grades.psa5[0].status, 'unavailable');
});

test('photo checks abstain unless the signal is strong', () => {
  const sharp = stripes(80, 60);
  const crisp = assessPhoto({ gray: sharp, width: 80, height: 60, originalWidth: 1200, originalHeight: 1600 });
  assert.equal(crisp.blur.state, 'not-flagged');
  assert.equal(crisp.resolution.state, 'ok');
  const blank = assessPhoto({
    gray: new Uint8Array(80 * 60).fill(128),
    width: 80,
    height: 60,
    originalWidth: 400,
    originalHeight: 300,
  });
  assert.equal(blank.blur.state, 'low-detail');
  assert.equal(blank.resolution.state, 'low');
  const mild = new Uint8Array(80 * 60);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 80; x++) mild[y * 80 + x] = 128 + (x % 12 < 1 ? 12 : 0);
  }
  assert.equal(assessPhoto({ gray: mild, width: 80, height: 60, originalWidth: 800, originalHeight: 1000 }).blur.state, 'not-assessable');
  const glare = new Uint8Array(100 * 100).fill(40);
  glare.fill(255, 0, 100);
  assert.equal(assessPhoto({ gray: glare, width: 100, height: 100 }).glare.state, 'possible-glare');
  assert.equal(assessPhoto({ gray: new Uint8Array(100 * 100).fill(40), width: 100, height: 100 }).glare.state, 'no-large-clipped-highlight');
  const washed = new Uint8Array(100 * 100).fill(255);
  assert.equal(assessPhoto({ gray: washed, width: 100, height: 100 }).glare.state, 'not-assessable');
  const card = bordered(200, 280, 16, 32, 20, 20);
  const center = measureCentering(card, 200, 280);
  assert.equal(center.state, 'measured');
  assert.ok(Math.abs(center.leftPct - (16 / 48) * 100) < 2);
  assert.ok(Math.abs(center.rightPct - (32 / 48) * 100) < 2);
  const noise = new Uint8Array(80 * 80);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 255;
  assert.equal(measureCentering(noise, 80, 80).state, 'not-assessable');
  assert.equal(suggestCrop(noise, 80, 80).state, 'not-assessable');
  const scene = flatCard();
  const crop = suggestCrop(scene.gray, scene.width, scene.height);
  assert.equal(crop.state, 'suggested');
  assert.ok(Math.abs(crop.left - 40 / 240) < 0.02);
  assert.equal(suggestCrop(new Uint8Array(80 * 80).fill(10), 80, 80).state, 'not-assessable');
});

test('files, crop, and camera size stay bounded', () => {
  assert.equal(validateFile({ size: 0, type: 'image/jpeg' }).code, 'empty');
  assert.equal(validateFile({ size: 8 * 1024 * 1024 + 1, type: 'image/jpeg' }).code, 'too-large');
  assert.equal(validateFile({ size: 20, type: 'text/plain', bytes: new Uint8Array(16) }).code, 'not-image');
  const png = new Uint8Array(16);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  assert.equal(validateFile({ size: 30, type: 'image/png', bytes: png }).ok, true);
  const heic = new Uint8Array(16);
  heic.set([0x66, 0x74, 0x79, 0x70], 4);
  heic.set([0x68, 0x65, 0x69, 0x63], 8);
  assert.equal(validateFile({ size: 32, type: 'image/heic', bytes: heic }).code, 'heic');
  assert.match(fileMessage('heic'), /HEIC/);
  assert.deepEqual(captureSize(4000, 3000), { width: 1600, height: 1200 });
  assert.equal(captureSize(0, 10), null);
  const crop = clampCrop(0.9, 0.9, 0.91, 0.92);
  assert.ok(crop.right - crop.left >= 0.05);
  assert.ok(crop.bottom - crop.top >= 0.05);
  assert.equal(formatUsd(2201.8), '$2,201.80');
});

test('one worker is reused and cancel stops it', async () => {
  let built = 0;
  let terminated = 0;
  const session = createSession(async () => {
    built += 1;
    return {
      recognize() {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ data: { text: 'HI' } }), 20);
        });
      },
      terminate() { terminated += 1; },
    };
  });
  assert.equal(await session.read({}), 'HI');
  assert.equal(await session.read({}), 'HI');
  assert.equal(built, 1);
  let saw;
  const hanging = createSession(async () => ({
    recognize() {
      saw();
      return new Promise(() => {});
    },
    terminate() { terminated += 1; },
  }));
  const ac = new AbortController();
  const gate = new Promise((resolve) => { saw = resolve; });
  const pending = hanging.read({}, { signal: ac.signal });
  await gate;
  ac.abort();
  await assert.rejects(pending, (err) => err.name === 'AbortError');
  assert.equal(terminated, 1);
  const passes = [];
  const reader = {
    read(_image, opts) {
      passes.push(opts);
      return Promise.resolve(passes.length === 1 ? 'name only' : 'LON-000');
    },
  };
  const text = await readCardImage(reader, { width: 100, height: 200 }, {});
  assert.match(text, /LON-000/);
  assert.equal(passes.length, 2);
  assert.equal(passes[1].psm, '7');
  assert.equal(passes[0].psm, '6');
  passes.length = 0;
  await readCardImage({
    read() {
      passes.push(1);
      return Promise.resolve('LON-000');
    },
  }, { width: 100, height: 200 }, {});
  assert.equal(passes.length, 1);
});

function stripes(width, height) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = x % 2 ? 255 : 0;
  }
  return gray;
}

function bordered(width, height, left, right, top, bottom) {
  const gray = new Uint8Array(width * height).fill(20);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < left || x >= width - right || y < top || y >= height - bottom) gray[y * width + x] = 210;
    }
  }
  return gray;
}

function flatCard() {
  const width = 240;
  const height = 320;
  const gray = new Uint8Array(width * height).fill(240);
  for (let y = 40; y < 240; y++) {
    for (let x = 40; x < 183; x++) gray[y * width + x] = 20;
  }
  return { gray, width, height };
}
