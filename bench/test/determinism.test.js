import assert from 'node:assert/strict';
import test from 'node:test';
import { runBench } from '../run.mjs';

test('the same seed produces the same truth and pixels', () => {
  const a = runBench({ mode: 'quick', seed: 7, subject: 'honest' });
  const b = runBench({ mode: 'quick', seed: 7, subject: 'honest' });
  assert.equal(a.determinism, b.determinism);
  assert.equal(a.truth, b.truth);
  assert.equal(a.metrics.M19.value, 0);
});
