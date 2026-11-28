/**
 * Planted checks on a readable card are found.
 * A card with no planted mark is not given one.
 * A tilted photo is not called clear.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { labelFromParams } from '../label.mjs';
import { render } from '../procedural/render.mjs';
import { recipes } from '../recipes/sealed.mjs';
import { inspect } from '../../scan/core/inspect.js';

test('planted backs and marks are found, and a plain card grows none', () => {
  const params = recipes('quick', 1);
  let caught = 0;
  let planted = 0;
  let invented = 0;
  for (const item of params) {
    const label = labelFromParams(item);
    if (label.pxPerMm < 8 || label.gate !== 'ok') continue;
    const report = inspect(render(label, item), label.image.w, label.image.h);
    if (item.defects.length) {
      planted += 1;
      const type = item.defects[0].type;
      if (report.results[type].state === 'found') caught += 1;
      const extras = Object.entries(report.results)
        .filter(([key, row]) => key !== type && row.state === 'found')
        .map(([key]) => key);
      assert.deepEqual(extras, [], `${item.id} also found ${extras.join(',')}`);
      assert.notEqual(report.results[type].state, 'ok');
    } else if (!item.glare) {
      const hits = Object.values(report.results).filter((row) => row.state === 'found');
      if (hits.length) invented += 1;
    }
    for (const row of Object.values(report.results)) {
      if (row.state === 'unchecked') {
        assert.ok(row.reason, row.note);
        assert.ok(row.tip, row.note);
        assert.doesNotMatch(row.note, /\bclear\b/i);
      }
    }
  }
  assert.ok(planted >= 10);
  assert.equal(caught, planted);
  assert.equal(invented, 0);
});
