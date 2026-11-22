import assert from 'node:assert/strict';
import test from 'node:test';
import { describe } from '../../scan/core/describe.js';

test('describe refuses an area that was not measured', () => {
  assert.throws(() => describe({ state: 'unchecked', coverage: 0, note: 'clear' }), /not measured/);
  assert.throws(() => describe({ state: 'ok', coverage: 0.2, note: 'No issue stood out.' }), /not measured/);
  assert.equal(describe({ state: 'ok', coverage: 1, note: 'No issue stood out.' }), 'No issue stood out.');
});
