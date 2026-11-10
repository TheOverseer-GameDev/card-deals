import assert from 'node:assert/strict';
import test from 'node:test';
import { formatManual, manualCentering } from '../manual.js';

test('guide positions become the border ratio and the PSA cutoff', () => {
  const even = manualCentering({
    width: 500,
    height: 700,
    outerLeft: 0,
    innerLeft: 40,
    innerRight: 459,
    outerRight: 499,
    outerTop: 0,
    innerTop: 50,
    innerBottom: 649,
    outerBottom: 699,
    back: false,
  });
  assert.equal(even.label, 'measured by you');
  assert.ok(Math.abs(even.leftPct - 50) < 0.01, even.leftPct);
  assert.ok(Math.abs(even.rightPct - 50) < 0.01, even.rightPct);
  assert.ok(Math.abs(even.topPct - 50) < 0.01, even.topPct);
  assert.equal(even.withinCutoff, true);
  assert.equal(even.cutoff, 55);
  const off = manualCentering({
    width: 500,
    height: 700,
    outerLeft: 0,
    innerLeft: 60,
    innerRight: 459,
    outerRight: 499,
    outerTop: 0,
    innerTop: 40,
    innerBottom: 659,
    outerBottom: 699,
    back: false,
  });
  assert.ok(Math.abs(off.leftPct - 60) < 0.01, off.leftPct);
  assert.equal(off.withinCutoff, false);
  const back = manualCentering({
    width: 500,
    height: 700,
    outerLeft: 0,
    innerLeft: 60,
    innerRight: 459,
    outerRight: 499,
    outerTop: 0,
    innerTop: 40,
    innerBottom: 659,
    outerBottom: 699,
    back: true,
  });
  assert.equal(back.cutoff, 75);
  assert.equal(back.withinCutoff, true);
  assert.match(formatManual(back), /Measured by you/);
  assert.match(formatManual(back), /back 75\/25/);
  assert.equal(manualCentering({
    width: 500, height: 700, outerLeft: 10, innerLeft: 10, innerRight: 40, outerRight: 80, outerTop: 0, innerTop: 10, innerBottom: 40, outerBottom: 80,
  }), null);
});
