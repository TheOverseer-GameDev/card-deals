import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_FAIL, priceFeed, refreshSaved } from '../library.js';

test('refresh rechecks at most 12 and keeps a guide when a check fails', async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ code: `X-${i}`, usd: i + 1 }));
  let calls = 0;
  const result = await refreshSaved(rows, async (row) => {
    calls += 1;
    if (row.code === 'X-1') throw new Error('down');
    return { price: 9 };
  });
  assert.equal(calls, 12);
  assert.equal(result.rows[1].usd, 2);
  assert.equal(result.rows[0].usd, 9);
  assert.equal(result.rows[13].usd, 14);
  assert.equal(result.failed, true);
  assert.equal(FEED_FAIL.includes('No other printing'), true);
});

test('price feed keeps two prints and drops a failed substitution', () => {
  const kept = priceFeed([
    { name: 'Ash Blossom', game: 'ygo', staple: true, price: 1, code: 'A' },
    { name: 'Ash Blossom', game: 'ygo', staple: true, price: 2, code: 'B' },
    { name: 'Ash Blossom', game: 'ygo', staple: true, price: 3, code: 'C' },
    { name: 'Blank', game: 'ygo', staple: true, price: 0, code: 'Z' },
    { name: 'New rare', game: 'mtg', rarity: 'rare', releasedDays: 10, price: 4 },
  ]);
  assert.deepEqual(kept.map((row) => row.code || row.name), ['A', 'B', 'New rare']);
});
