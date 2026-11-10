import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefectMap } from '../defects.js';

test('only trusted visible findings become marks', () => {
  const map = buildDefectMap([
    {
      crops: [
        { id: 'front-corner-tl', trusted: true, flag: 'rounding', label: 'Front top left corner', text: 'Rounded.', x: 0, y: 0, w: 0.1, h: 0.1 },
        { id: 'front-edge-top', trusted: true, flag: 'clear', label: 'Front top edge', text: 'Clear.', x: 0.2, y: 0, w: 0.5, h: 0.05 },
        { id: 'front-edge-left', trusted: false, flag: 'unchecked', label: 'Front left edge', text: 'Too dark.', x: 0, y: 0.2, w: 0.05, h: 0.5 },
      ],
    },
  ], { status: 'marked', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, findings: [{ kind: 'scratch', text: 'Maybe a scratch.' }] });
  assert.equal(map.marks.length, 2);
  assert.equal(map.marks[0].id, 'front-corner-tl');
  assert.equal(map.marks[1].label, 'Possible surface mark');
  assert.match(map.note, /not a grade/);
  assert.match(map.note, /too dark or too glary/);
  const empty = buildDefectMap([{ crops: [{ trusted: true, flag: 'clear', label: 'x', text: 'Clear.' }] }], null);
  assert.equal(empty.marks.length, 0);
  assert.match(empty.note, /Nothing on the checked crops/);
});
