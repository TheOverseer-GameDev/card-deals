/**
 * Manual guide math is exact. M3 stays at zero error.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { manualCentering } from '../../scan/manual.js';

test('manual left and top shares match the placed borders exactly', () => {
  const cases = [
    { left: 20, right: 20, top: 20, bottom: 20 },
    { left: 40, right: 10, top: 15, bottom: 30 },
    { left: 12, right: 28, top: 18, bottom: 18 },
    { left: 7, right: 13, top: 9, bottom: 21 },
  ];
  for (const item of cases) {
    const result = manualCentering({
      width: 400,
      height: 560,
      outerLeft: 20,
      innerLeft: 20 + item.left,
      innerRight: 360,
      outerRight: 360 + item.right,
      outerTop: 20,
      innerTop: 20 + item.top,
      innerBottom: 500,
      outerBottom: 500 + item.bottom,
    });
    assert.ok(result);
    assert.equal(result.leftPct, (100 * item.left) / (item.left + item.right));
    assert.equal(result.rightPct, (100 * item.right) / (item.left + item.right));
    assert.equal(result.topPct, (100 * item.top) / (item.top + item.bottom));
    assert.equal(result.bottomPct, (100 * item.bottom) / (item.top + item.bottom));
  }
});
