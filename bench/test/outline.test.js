/**
 * The reported quad is the card border, not the artwork inside it.
 * Bars: corner p95 <= 0.5 mm and no corner worse than 1 mm.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { recipes } from '../recipes/sealed.mjs';
import { labelFromParams } from '../label.mjs';
import { render } from '../procedural/render.mjs';
import { straighten } from '../../scan/pipeline.js';

test('outermost corners stay inside the geometry bars on the CI set', () => {
  const errors = [];
  for (const params of recipes('ci', 1)) {
    const label = labelFromParams(params);
    if (label.gate !== 'ok') continue;
    const flat = straighten(render(label, params), label.image.w, label.image.h);
    assert.ok(flat.quad, label.id);
    let sum = 0;
    for (let i = 0; i < 4; i += 1) {
      sum += Math.hypot(label.quad[i].x - flat.quad[i].x, label.quad[i].y - flat.quad[i].y);
    }
    errors.push((sum / 4) / label.pxPerMm);
  }
  errors.sort((a, b) => a - b);
  const p95 = errors[Math.ceil(0.95 * errors.length) - 1];
  assert.ok(errors.length >= 24, `n ${errors.length}`);
  assert.ok(p95 <= 0.5, `p95 ${p95}`);
  assert.ok(errors[errors.length - 1] <= 1, `max ${errors[errors.length - 1]}`);
});
