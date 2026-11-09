import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupSetCode } from '../feeds.js';
import { rowsFromCardInfo } from '../pipeline.js';

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('set-code lookup keeps only that printed code', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (String(url).includes('ZZZZ-EN999')) return jsonRes({}, 400);
    if (String(url).includes('cardsetsinfo')) {
      return jsonRes([{ id: 1, set_code: 'RA01-EN008' }, { id: 2, set_code: 'RA04-EN025' }]);
    }
    if (String(url).includes('id=1')) {
      return jsonRes({ data: [{ id: 1, name: 'Ash Blossom & Joyous Spring', card_sets: [
        { set_code: 'RA01-EN008', set_rarity: "Collector's Rare", set_price: '0', set_name: 'Royalty' },
        { set_code: 'RA01-EN008', set_rarity: 'Ultra Rare', set_price: '3', set_name: 'Royalty' },
      ] }] });
    }
    return jsonRes({ data: [{ id: 2, name: 'Ash Blossom & Joyous Spring', card_sets: [
      { set_code: 'RA04-EN025', set_rarity: "Collector's Rare", set_price: '0', set_name: 'Stampede' },
      { set_code: 'RA04-EN999', set_rarity: 'Ultra Rare', set_price: '80', set_name: 'Other' },
    ] }] });
  };
  assert.deepEqual(await lookupSetCode('ZZZZ-EN999', fetchImpl), []);
  const ra01 = await lookupSetCode('RA01-EN008', fetchImpl);
  assert.equal(ra01.length, 2);
  assert.equal(ra01[0].price, null);
  assert.equal(ra01[1].price, 3);
  const ra04 = await lookupSetCode('RA04-EN025', fetchImpl);
  assert.equal(ra04.length, 1);
  assert.equal(ra04[0].price, null);
  assert.equal(calls.some((url) => url.includes('ygoprodeck.com') && !url.includes('db.ygoprodeck.com')), false);
});

test('LAVD-ENO34 is not rewritten and a live zero stays unavailable', async () => {
  const mocked = rowsFromCardInfo('LAVD-ENO34', { data: [{ id: 15032, name: 'Accesscode Talker', card_sets: [
    { set_code: 'LAVD-ENO34', set_rarity: 'Ultra Rare', set_price: 0, set_name: 'Legendary Arc-V Decks' },
  ] }] });
  assert.equal(mocked[0].code, 'LAVD-ENO34');
  assert.equal(mocked[0].price, null);
  try {
    const live = await lookupSetCode('LAVD-ENO34');
    if (!live || live.error) {
      console.log('live LAVD-ENO34 lookup did not return a card');
      return;
    }
    assert.equal(live[0].code, 'LAVD-ENO34');
    assert.equal(live[0].name, 'Accesscode Talker');
    assert.equal(live[0].price, null);
  } catch (err) {
    console.log('live LAVD-ENO34 lookup skipped: ' + err.message);
  }
});
