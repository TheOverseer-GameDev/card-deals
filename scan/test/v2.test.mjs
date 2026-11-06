import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessPhoto,
  centeringCeiling,
  COPY,
  ESTIMATE_UNAVAILABLE,
  psaEstimate,
  retakePrompts,
  classifyRegion,
} from '../engine.js';
import { buildSalesSeries } from '../charts.js';
import { buildGauges, spreadIsWide } from '../gauges.js';
import { rowsForCondition, splitMarket } from '../prices.js';

function checker(width, height, dark = 30, light = 90) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = ((x + y) % 2) ? light : dark;
  }
  return gray;
}

function region(status, reasons = []) {
  return { status, reasons, variance: 200, clipped: 0, shortPx: 80 };
}

function cleanReport(centering = { state: 'measured', leftPct: 50, rightPct: 50, topPct: 50, bottomPct: 50 }) {
  const ids = [
    'corner_tl', 'corner_tr', 'corner_bl', 'corner_br',
    'edge_top', 'edge_right', 'edge_bottom', 'edge_left',
    'center_field', 'print_register', 'border_box',
  ];
  const regions = {};
  for (const id of ids) regions[id] = region('pass');
  return {
    resolution: { state: 'ok', originalWidth: 1200, originalHeight: 1680 },
    blur: { state: 'not-flagged', variance: 400 },
    glare: { state: 'no-large-clipped-highlight', fraction: 0 },
    centering,
    regions,
  };
}

test('regional glare, blur, and resolution stay in their bands', () => {
  assert.deepEqual(classifyRegion({ variance: 200, clipped: 0, shortPx: 80, sampleShort: 40 }), { status: 'pass', reasons: [] });
  assert.deepEqual(classifyRegion({ variance: 10, clipped: 0, shortPx: 80, sampleShort: 40 }), { status: 'fail', reasons: ['blur'] });
  assert.deepEqual(classifyRegion({ variance: 60, clipped: 0, shortPx: 80, sampleShort: 40 }), { status: 'unknown', reasons: ['not-assessable'] });
  assert.deepEqual(classifyRegion({ variance: 200, clipped: 0.05, shortPx: 80, sampleShort: 40 }), { status: 'fail', reasons: ['glare'] });
  assert.deepEqual(classifyRegion({ variance: 200, clipped: 0.5, shortPx: 80, sampleShort: 40 }), { status: 'unknown', reasons: ['glare'] });
  assert.deepEqual(classifyRegion({ variance: 200, clipped: 0, shortPx: 10, sampleShort: 40 }), { status: 'fail', reasons: ['low-resolution'] });

  const sharp = assessPhoto({ gray: checker(200, 280), width: 200, height: 280, originalWidth: 1000, originalHeight: 1400 });
  assert.equal(sharp.regions.corner_tl.status, 'pass');
  const flat = assessPhoto({
    gray: new Uint8Array(200 * 280).fill(128),
    width: 200,
    height: 280,
    originalWidth: 1000,
    originalHeight: 1400,
  });
  assert.equal(flat.regions.corner_br.status, 'fail');
  assert.equal(flat.regions.corner_br.reasons[0], 'blur');
  const glare = checker(200, 280);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 20; x++) glare[y * 200 + x] = 255;
  }
  const glared = assessPhoto({ gray: glare, width: 200, height: 280, originalWidth: 1000, originalHeight: 1400 });
  assert.equal(glared.regions.corner_tl.reasons[0], 'glare');
  assert.ok(glared.regions.corner_tl.status === 'unknown' || glared.regions.corner_tl.status === 'fail');
  assert.equal(glared.regions.corner_br.status, 'pass');
  const tiny = assessPhoto({ gray: checker(80, 112), width: 80, height: 112, originalWidth: 80, originalHeight: 112 });
  assert.equal(tiny.regions.corner_tl.status, 'fail');
  assert.equal(tiny.regions.corner_tl.reasons[0], 'low-resolution');
  const line = retakePrompts('front', glared).find((item) => item.regionId === 'corner_tl');
  assert.match(line.line, /Front top-left corner/);
  assert.match(line.line, /specular glare/);
  assert.match(line.line, /Tip:/);
});

test('psa estimate never treats an unknown region as clean and never emits confidence', () => {
  const front = cleanReport();
  const back = cleanReport();
  const both = psaEstimate({
    mode: 'front-and-back',
    front,
    back,
    notes: { front: { corners: 'clean', edges: 'clean', surface: 'clean' }, back: { corners: 'clean', edges: 'clean', surface: 'clean' } },
  });
  assert.deepEqual(both.range, { low: 9, high: 10 });
  assert.equal(both.confidence, undefined);
  assert.equal(JSON.stringify(both).toLowerCase().includes('confidence'), false);
  assert.match(both.disclaimer, /not a certification|cannot prove/i);
  assert.equal(both.label.includes('not a certification'), true);

  front.regions.corner_tl = region('unknown', ['glare']);
  const dirty = psaEstimate({
    mode: 'front-and-back',
    front,
    back,
    notes: { front: { corners: 'clean', edges: 'clean', surface: 'clean' } },
  });
  assert.ok(dirty.range.high < 10);
  assert.match(dirty.basis.join(' '), /not counted as clean|ceiling reduced/);
  assert.equal(JSON.stringify(dirty).toLowerCase().includes('confidence'), false);

  for (const id of ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br']) {
    front.regions[id] = region('unknown', ['glare']);
  }
  const blocked = psaEstimate({ mode: 'front-and-back', front, back, notes: { front: { corners: 'clean' } } });
  assert.equal(blocked.range, null);
  assert.equal(blocked.message, ESTIMATE_UNAVAILABLE);
  assert.match(blocked.basis.join(' '), /not counted as clean/);

  const frontOnly = psaEstimate({ mode: 'front-only', front: cleanReport(), back: null, notes: {} });
  assert.ok(frontOnly.range.high <= 8);
  assert.match(frontOnly.basis.join(' '), /not photographed/);

  const centered = cleanReport({ state: 'measured', leftPct: 62, rightPct: 38, topPct: 50, bottomPct: 50 });
  const grade = psaEstimate({ mode: 'front-and-back', front: centered, back: cleanReport(), notes: {} });
  assert.ok(grade.range.high <= 9);
  assert.equal(centeringCeiling(centered.centering, 'front'), 9);
  assert.equal(centeringCeiling({ state: 'measured', leftPct: 55, rightPct: 45, topPct: 50, bottomPct: 50 }, 'front'), 10);
  assert.equal(Number.isInteger(grade.range.low) && Number.isInteger(grade.range.high), true);
});

test('sold and asking rows never cross labels', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const split = splitMarket({
    print_id: 'ygo:abc',
    sales: [
      { price: 12, currency: 'USD', source: 'PriceCharting', observed_at: '2026-11-01T00:00:00Z', condition: 'Ungraded' },
      { price: 40, currency: 'USD', source: 'eBay completed', observed_at: '2026-11-01T00:00:00Z', condition: 'PSA 10', kind: 'ask' },
      { price: 0, currency: 'USD', source: 'PriceCharting', observed_at: '2026-11-01T00:00:00Z' },
    ],
    asks: [
      { price: 18, currency: 'USD', source: 'eBay', observed_at: '2026-11-02T00:00:00Z', condition: 'PSA 10' },
      { price: 9, currency: 'USD', observed_at: '2026-11-02T00:00:00Z', condition: 'Ungraded' },
    ],
  }, now);
  assert.equal(split.sold.length, 1);
  assert.equal(split.sold[0].kind, 'sold');
  assert.equal(split.sold[0].condition, 'Ungraded');
  assert.equal(split.ask.length, 1);
  assert.equal(split.ask[0].kind, 'ask');
  assert.equal(split.ask[0].condition, 'PSA 10');
  assert.equal(split.sold.some((row) => row.kind === 'ask' || row.condition === 'PSA 10'), false);
  assert.equal(split.ask.some((row) => row.kind === 'sold'), false);
  assert.equal(rowsForCondition(split.ask, 'Ungraded').length, 0);
  assert.equal(rowsForCondition(split.sold, 'PSA 10').length, 0);
  assert.ok(split.rejected.some((row) => row.reason === 'cross-label'));
  assert.ok(split.rejected.some((row) => row.reason.includes('price')));
  assert.ok(split.rejected.some((row) => row.reason.includes('source')));
  const missing = splitMarket({ sales: [{ price: 5, currency: 'USD', source: 'Shop', observed_at: '2026-11-01T00:00:00Z' }] }, now);
  assert.equal(missing.sold.length, 0);
  assert.equal(missing.rejected[0].reason, 'exact print id missing');
});

test('chart months stay empty instead of inventing a sale', () => {
  const series = buildSalesSeries([
    { price: 10, observedAt: '2024-01-15T00:00:00Z' },
    { price: 30, observedAt: '2024-03-15T00:00:00Z' },
  ], { releasedAt: '2020-01-01T00:00:00Z' });
  assert.equal(series.buckets.find((bucket) => bucket.label === '2024-02').value, null);
  assert.equal(series.buckets.find((bucket) => bucket.label === '2024-01').value, 10);
  assert.equal(series.buckets.find((bucket) => bucket.label === '2024-03').value, 30);
  assert.equal(series.buckets.some((bucket) => bucket.value === 20), false);
  assert.equal(series.gap, COPY.gap);

  const aged = buildSalesSeries([
    { price: 5, observedAt: '2018-06-01T00:00:00Z' },
    { price: 9, observedAt: '2024-01-15T00:00:00Z' },
    { price: 11, observedAt: '2024-08-02T00:00:00Z' },
    { price: 14, observedAt: '2024-08-20T00:00:00Z' },
  ], { releasedAt: '2024-06-01T00:00:00Z' });
  assert.equal(aged.cardAgeKnown, true);
  assert.equal(aged.buckets.some((bucket) => bucket.label.startsWith('2018')), false);
  assert.equal(aged.buckets.some((bucket) => bucket.label === '2024-01'), false);
  assert.equal(aged.buckets[0].label, '2024-06');
  assert.equal(aged.buckets.find((bucket) => bucket.label === '2024-07').value, null);
  assert.equal(aged.buckets.find((bucket) => bucket.label === '2024-08').value, 14);

  const asks = buildSalesSeries([
    { price: 22, observedAt: '2025-02-01T00:00:00Z' },
  ], { kind: 'ask' });
  assert.equal(asks.title, 'Asking prices over time');
  assert.notEqual(asks.title, COPY.sold);
});

test('gauges stay unavailable instead of a neutral score', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const none = buildGauges({
    printConfirmed: true,
    photoUnknowns: 0,
    soldPrices: [],
    askPrices: [],
    scenarios: [],
    backMissing: false,
    now,
  });
  assert.equal(none.future.available, false);
  assert.equal(none.future.score, null);
  assert.notEqual(none.future.score, 50);
  assert.equal(none.value.score, null);
  assert.match(none.future.disclaimer, /scenario-based/);
  assert.match(none.risk.disclaimer, /not a probability/);
  assert.match(none.value.disclaimer, /not a price target/);

  const listed = buildGauges({
    printConfirmed: true,
    soldPrices: [10],
    scenarios: [{ tag: 'reprint-risk', note: 'A reprint exists.' }],
    backMissing: true,
    now,
  });
  assert.equal(listed.future.available, true);
  assert.equal(listed.future.score, null);
  assert.equal(listed.future.scenarios[0].tag, 'reprint-risk');

  const weighted = buildGauges({
    printConfirmed: true,
    soldPrices: [10, 11],
    askPrices: [12],
    newestSoldAt: '2026-11-01T00:00:00Z',
    scenarios: [{ tag: 'meta', note: 'Tracker note.', weight: 1 }],
    backMissing: false,
    now,
  });
  assert.equal(weighted.future.score, 100);
  assert.equal(weighted.risk.score, 0);
  assert.equal(spreadIsWide([10], [15]), true);
  assert.equal(spreadIsWide([10], [14]), false);
});
