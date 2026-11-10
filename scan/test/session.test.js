import assert from 'node:assert/strict';
import test from 'node:test';
import { addToSession, createSession, sessionTotal, targetNote, toCsv } from '../session.js';

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
  assert.match(targetNote('', 10), /Set a CAD target/);
  assert.match(targetNote('8', 0), /unavailable/);
  assert.match(targetNote('8', 7.5), /At or under/);
  assert.match(targetNote('8', 9), /Above/);
});
