import assert from 'node:assert/strict';
import test from 'node:test';
import { labelFromParams, labelSelftest } from '../label.mjs';

test('labels come only from labelFromParams and stay stable', () => {
  const check = labelSelftest();
  assert.equal(check.stable, true);
  assert.equal(check.centeringMoves, true);
  assert.equal(check.squareRefused, true);
  const flat = labelFromParams({
    id: 'flat',
    family: 'P',
    game: 'ygo',
    cardW: 590,
    cardH: 860,
    padPx: 24,
    lr: 50,
    tb: 50,
  });
  assert.equal(flat.gate, 'ok');
  assert.ok(flat.pxPerMm >= 8);
});
