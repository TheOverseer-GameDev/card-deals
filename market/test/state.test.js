import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';
import { escapeText } from '../escape.js';
import { prefillFromSaved } from '../prefill.js';
import { createMemory } from '../memory.js';
import { PAY_WINDOW_MS, canReadHandles, emptyMarket } from '../state.js';

const seller = { id: 's', name: 'Seller' };
const buyer = { id: 'b', name: 'Buyer' };
const other = { id: 'o', name: 'Other' };

function market() {
  let now = 1_000_000;
  const client = createMemory(() => now);
  client.at = (value) => { now = value; };
  client.sign = (user) => client.dispatch({ type: 'sign', user });
  return client;
}

test('user text is escaped and market files do not inject raw HTML', () => {
  assert.equal(escapeText(`<img src=x onerror=alert(1)>&"'`), '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;');
  for (const name of ['../boot.js', '../remote.js', '../memory.js', '../prefill.js']) {
    const text = fs.readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.equal(text.includes('innerHTML'), false, name);
  }
});

test('prefill copies only stored figures and does not invent a range', () => {
  const filled = prefillFromSaved(
    { name: 'Gemini Elf [1st Edition]', code: 'LON-000', usd: 5, rarity: 'Ultra Rare' },
    { ygo: { cards: [{ name: 'Gemini Elf [1st Edition] LON-000', raw: 10, p9: 20 }] } },
  );
  assert.equal(filled.setCode, 'LON-000');
  assert.equal(filled.edition, '1st Edition');
  assert.equal(filled.conditionNotes, '');
  assert.equal(filled.centering, '');
  assert.match(filled.notes.join('\n'), /Saved guide: USD 5\.00/);
  assert.match(filled.notes.join('\n'), /CAD estimate unavailable/);
  assert.match(filled.notes.join('\n'), /Raw USD 10\.00/);
  assert.match(filled.notes.join('\n'), /Sold range is not stored/);
  const bare = prefillFromSaved({ name: 'No Match' }, { ygo: { cards: [] } });
  assert.match(bare.notes.join('\n'), /Sold range unavailable/);
  assert.doesNotMatch(bare.notes.join('\n'), /CAD \d/);
});

test('offers move through counter, accept, pay, and rating', () => {
  const client = market();
  client.sign(seller);
  assert.equal(client.dispatch({ type: 'handles', interac: 'seller@example.com', paypal: 'seller' }).ok, true);
  assert.equal(client.dispatch({ type: 'list', name: 'Dark Magician', game: 'ygo', askCad: 12 }).ok, true);
  assert.equal(client.dispatch({ type: 'list', name: '', game: 'ygo', askCad: 12 }).ok, false);
  assert.equal(client.dispatch({ type: 'list', name: 'Zero', game: 'ygo', askCad: 0 }).ok, false);
  const listing = client.view().mine[0];
  client.sign(buyer);
  assert.equal(client.dispatch({ type: 'offer', listingId: listing.id, amount: 8 }).ok, true);
  let trade = client.view().trades[0];
  assert.equal(trade.handles, null);
  assert.equal(canReadHandles({ offers: [trade.offer] }, buyer.id, trade.offer, client.view && 0), false);
  client.sign(seller);
  assert.equal(client.dispatch({ type: 'counter', offerId: trade.offer.id, amount: 10 }).ok, true);
  client.sign(buyer);
  trade = client.view().trades[0];
  assert.equal(trade.offer.amountCad, 10);
  assert.equal(trade.handles, null);
  assert.equal(client.dispatch({ type: 'accept', offerId: trade.offer.id }).ok, true);
  trade = client.view().trades[0];
  assert.equal(trade.handles.interac, 'seller@example.com');
  client.sign(other);
  assert.equal(client.view().trades.length, 0);
  client.sign(buyer);
  assert.equal(client.dispatch({ type: 'paid', offerId: trade.offer.id }).ok, true);
  client.sign(seller);
  assert.equal(client.dispatch({ type: 'received', offerId: trade.offer.id }).ok, true);
  client.sign(buyer);
  assert.equal(client.dispatch({ type: 'rate', offerId: trade.offer.id, stars: 5 }).ok, true);
  assert.equal(client.dispatch({ type: 'rate', offerId: trade.offer.id, stars: 4 }).ok, false);
  assert.equal(client.dispatch({ type: 'report', listingId: listing.id, userId: seller.id, reason: 'Wrong card' }).ok, true);
  assert.equal(client.dispatch({ type: 'block', userId: seller.id }).ok, true);
  assert.equal(client.view().feed.some((row) => row.sellerId === seller.id), false);
});

test('payment handles hide when the two-hour window ends', () => {
  const client = market();
  client.sign(seller);
  client.dispatch({ type: 'handles', interac: 'seller@example.com' });
  client.dispatch({ type: 'list', name: 'Blue-Eyes', game: 'ygo', askCad: 20 });
  const listing = client.view().mine[0];
  client.sign(buyer);
  assert.equal(client.dispatch({ type: 'buy', listingId: listing.id }).ok, true);
  assert.equal(client.view().trades[0].handles.interac, 'seller@example.com');
  client.at(client.view().trades[0].offer.paymentDue + 1);
  assert.equal(client.view().trades[0].handles, null);
  assert.equal(client.view().trades[0].offer.status, 'expired');
  assert.equal(PAY_WINDOW_MS, 7_200_000);
});

test('a photo is dropped without consent and a stranger cannot read handles', () => {
  const client = market();
  client.sign(seller);
  const denied = client.dispatch({ type: 'list', name: 'Photo', game: 'mtg', askCad: 3, photoConsent: false, photoPath: 'secret.jpg' });
  assert.equal(denied.ok, false);
  client.dispatch({ type: 'handles', paypal: 'seller' });
  client.dispatch({ type: 'list', name: 'Real', game: 'mtg', askCad: 3 });
  const state = emptyMarket();
  assert.equal(canReadHandles(state, other.id, { buyerId: buyer.id, status: 'accepted', paymentDue: 10 }, 1), false);
});
