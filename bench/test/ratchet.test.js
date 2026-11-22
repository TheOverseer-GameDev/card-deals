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
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'bench/spec.json'), 'utf8'));
  const bars = {
    M1: 0, M2: 0.95, M2b: 0.7, M2f: 0.9, M3: 0, M4: 0, M4f: 0.8, M5: 0, M5b: 0,
    M6a: 0, M6b: 0.95, M6c: 0.85, M7: 0, M8: 0.5, M8b: 0.15, M8c: 0.983, M9: 0.955,
    M10: 15, M11: 80, M12: 0, M13: 0, M14: 0, M15: 0, M16: 0, M17: 0, M18: 0, M18b: 0, M19: 0, M20: 0, E15: 0,
  };
  for (const [id, bar] of Object.entries(bars)) {
    assert.equal(spec.metrics.find((row) => row.id === id).bar, bar, id);
  }
  assert.equal(spec.metrics.find((row) => row.id === 'M21').bar, 0.9);
  assert.equal(spec.metrics.find((row) => row.id === 'M22').bar, 0.85);
  assert.equal(baseline.head, '88501579991d2c4a1827418797584cda115017a4');
  void sha256;
  const run = runBench({ mode: 'quick', seed: 1, subject: 'current' });
  for (const id of locked) {
    const prev = baseline.metrics[id].value;
    const next = run.metrics[id].value;
    assert.equal(typeof prev, 'number', id);
    assert.ok(next <= prev, `${id} ${next} rose above ${prev}`);
  }
});
