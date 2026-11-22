import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBench } from '../run.mjs';
import { sha256 } from '../lib/rng.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const locked = ['M5', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18', 'M18b', 'M19', 'M20'];

test('M5 and M13 through M20 do not fall behind the recorded baseline', () => {
  const file = path.join(root, 'bench/baseline.json');
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spec = fs.readFileSync(path.join(root, 'bench/spec.json'), 'utf8');
  assert.equal(baseline.specHash, sha256(spec));
  assert.equal(baseline.head, '88501579991d2c4a1827418797584cda115017a4');
  const run = runBench({ mode: 'quick', seed: 1, subject: 'current' });
  for (const id of locked) {
    const prev = baseline.metrics[id].value;
    const next = run.metrics[id].value;
    assert.equal(typeof prev, 'number', id);
    assert.ok(next <= prev, `${id} ${next} rose above ${prev}`);
  }
});
