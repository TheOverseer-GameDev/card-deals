import assert from 'node:assert/strict';
import test from 'node:test';
import { discriminate } from '../score/score.mjs';
import { runBench } from '../run.mjs';

test('centering metrics tell an honest report from a constant 50/50', () => {
  const honest = runBench({ mode: 'quick', seed: 1, subject: 'honest' });
  const canary = runBench({ mode: 'quick', seed: 1, subject: 'always-5050' });
  const bad = discriminate(honest.metrics, canary.metrics);
  assert.deepEqual(bad, []);
});
