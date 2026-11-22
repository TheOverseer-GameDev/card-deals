import assert from 'node:assert/strict';
import test from 'node:test';
import { runBench } from '../run.mjs';

test('a gate that is always ok reports a dangerous centering', () => {
  const run = runBench({ mode: 'quick', seed: 1, subject: 'always-ok' });
  assert.ok(run.metrics.M1.value > 0);
});

test('always 50/50 fails auto-centering and guided centering', () => {
  const run = runBench({ mode: 'quick', seed: 1, subject: 'always-5050' });
  assert.equal(run.metrics.M1.pass, false);
  assert.equal(run.metrics.M2.pass, false);
  assert.ok(run.metrics.M1.value > 0);
});
