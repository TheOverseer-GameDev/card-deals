import assert from 'node:assert/strict';
import test from 'node:test';
import { addToSession, createSession, csvCell, sessionTotal, targetNote, toCsv } from '../session.js';

test('a session total counts cards and leaves a missing price unavailable', () => {
  const session = createSession();
  addToSession(session, { name: 'Blue-Eyes', set: 'LOB-001', cad: 12.5 });
  addToSession(session, { name: 'Dark Magician', set: 'LOB-005', cad: null });
  session.items[0].qty = 2;
  const total = sessionTotal(session);
  assert.equal(total.count, 3);
  assert.equal(total.cad, null);
  session.items.pop();
  assert.equal(sessionTotal(session).cad, 25);
});

test('csv export quotes fields and a target is not compared without a price', () => {
  const session = createSession();
  addToSession(session, { name: 'Say "hi"', set: 'LOB-001', cad: 4 });
  const csv = toCsv(session.items);
  assert.match(csv, /name,set,number/);
  assert.match(csv, /"Say ""hi"""/);
  const hostile = toCsv([{ name: '=cmd', set: '+1', number: '-2', variant: '@x', foil: false, qty: 1, condition: '\tcell', cad: '\r1' }]);
  for (const bad of ['"\'=cmd"', '"\'+1"', '"\'-2"', '"\'@x"']) {
    assert.ok(hostile.includes(bad), hostile);
  }
  assert.equal(csvCell('\tcell'), '"cell"');
  assert.equal(csvCell('\r1'), '"1"');
  assert.equal(csvCell('\t=1'), '"\'=1"');
  assert.equal(csvCell('\r+1'), '"\'+1"');
  const tricks = [
    [' =1+1', '"\'=1+1"'],
    ['\n=1', '"\'=1"'],
    ['\u00A0=1', '"\'=1"'],
    ['\u3000=1', '"\'=1"'],
    ['\uFF1Dcmd', '"\'=cmd"'],
    ['\uFF0B1', '"\'+1"'],
    ['\uFEFF-2', '"\'-2"'],
  ];
  for (const [raw, expected] of tricks) assert.equal(csvCell(raw), expected, raw);
  assert.match(targetNote('', 10), /Set a CAD target/);
  assert.match(targetNote('8', 0), /unavailable/);
  assert.match(targetNote('8', 7.5), /At or under/);
  assert.match(targetNote('8', 9), /Above/);
});
