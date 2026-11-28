import assert from 'node:assert/strict';
import test from 'node:test';
import { covers, gradeEstimate } from '../../scan/core/grade.js';

const DAMAGE = { authenticity: 4, ding: 6, crease: 6, nick: 6, stain: 7, whitening: 7, dent: 7, print: 7, foil: 8, scratch: 8, glare: 8, warp: 6 };

function truthOf(defects) {
  let grade = 10;
  for (const id of defects) grade = Math.min(grade, DAMAGE[id] ?? 10);
  return grade;
}

function seenFrom(defects, hidden, estimated) {
  const seen = {};
  for (const id of Object.keys(DAMAGE)) {
    if (hidden.includes(id)) seen[id] = { state: 'unseen' };
    else if (estimated.includes(id)) seen[id] = { state: 'estimated', hit: defects.includes(id) };
    else if (defects.includes(id)) seen[id] = { state: 'found' };
    else seen[id] = { state: 'ok' };
  }
  return seen;
}

test('M21 the true grade stays inside the range at every confidence, and M22 High is within one grade', () => {
  const levels = { High: [], Medium: [], Low: [] };
  const types = Object.keys(DAMAGE);
  for (let i = 0; i < 40; i += 1) {
    const defects = i % 3 === 0 ? [] : [types[i % types.length]];
    const truth = truthOf(defects);
    const high = gradeEstimate({ hasCard: true, seen: seenFrom(defects, [], []) });
    levels.High.push({ truth, estimate: high });
    const medium = gradeEstimate({ hasCard: true, seen: seenFrom(defects, [], ['scratch']) });
    levels.Medium.push({ truth, estimate: medium });
    const low = gradeEstimate({ hasCard: true, seen: seenFrom(defects, ['authenticity', 'crease'], []) });
    levels.Low.push({ truth: Math.min(truth, DAMAGE.authenticity, DAMAGE.crease), estimate: low });
  }
  for (const [level, rows] of Object.entries(levels)) {
    const hit = rows.filter((row) => covers(row.truth, row.estimate)).length / rows.length;
    assert.ok(hit >= 0.9, `${level} coverage ${hit}`);
    assert.ok(rows.every((row) => row.estimate.confidence === level), level);
  }
  const close = levels.High.filter((row) => Math.abs(row.estimate.point - row.truth) <= 1).length / levels.High.length;
  assert.ok(close >= 0.85, `high point ${close}`);
  const wide = gradeEstimate({ hasCard: true, seen: seenFrom([], ['authenticity', 'crease'], []) });
  assert.equal(wide.confidence, 'Low');
  assert.ok(wide.high - wide.low >= 4);
  assert.equal(wide.point, Math.round((wide.low + wide.high) / 2));
  assert.notEqual(wide.point, wide.high);
  assert.match(wide.headline, /PSA \d+–\d+, likely ~\d+\./);
  const empty = gradeEstimate({ hasCard: false, seen: {} });
  assert.equal(empty.refused, true);
  assert.match(empty.message, /No card/);
});
