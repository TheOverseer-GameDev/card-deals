/**
 * A profile is data. Adding test-game.json needs no loader change.
 * Yu-Gi-Oh and Magic guide sizes stay the numbers already on screen.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundledProfiles, loadProfiles } from '../../registry/load.mjs';
import { importCatalog, memoryCatalog, openCatalog } from '../../catalog/import.mjs';
import { GUIDE } from '../profiles.js';
import { GAMES, guideForSelect } from '../games.js';
import { GAME_CUE_ENABLED } from '../game-cue.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('bundled profiles match the schema and the shipped guide sizes', () => {
  const profiles = bundledProfiles();
  const ids = profiles.map((profile) => profile.id);
  assert.equal(ids.length, 30);
  assert.ok(ids.includes('lorcana') && ids.includes('digimon') && ids.includes('fleshandblood') && ids.includes('starwars-unlimited'));
  assert.equal(profiles.filter((profile) => profile.status === 'provisional').length, 25);
  const ygo = profiles.find((profile) => profile.id === 'yugioh');
  const mtg = profiles.find((profile) => profile.id === 'mtg');
  assert.equal(ygo.size_mm.w, GUIDE.yugioh.w);
  assert.equal(ygo.size_mm.h, GUIDE.yugioh.h);
  assert.equal(mtg.size_mm.w, GUIDE.mtg.w);
  assert.equal(mtg.size_mm.h, GUIDE.mtg.h);
  assert.equal(ygo.guide.px_corner, 16);
  assert.equal(mtg.guide.px_corner, 16);
  for (const profile of profiles) {
    assert.equal(profile.centering.BGS, 'unofficial');
    assert.equal(profile.centering.SGC, 'unofficial');
  }
});

test('the picker lists every profile and leaves the shipped guides alone', () => {
  const profiles = bundledProfiles();
  assert.equal(GAMES.length, profiles.length);
  for (const profile of profiles) {
    const row = GAMES.find((item) => item.id === profile.id);
    assert.ok(row, profile.id);
    assert.equal(row.w, profile.size_mm.w);
    assert.equal(row.h, profile.size_mm.h);
    assert.equal(row.provisional, String(profile.status).includes('provisional'));
  }
  assert.deepEqual(guideForSelect('ygo'), { w: 59, h: 86 });
  assert.deepEqual(guideForSelect('mtg'), { w: 63, h: 88 });
  assert.deepEqual(guideForSelect('all'), { w: 59, h: 86 });
  assert.deepEqual(guideForSelect('lorcana'), { w: 63, h: 88 });
  assert.deepEqual(guideForSelect('tobacco-t206'), { w: 36.5, h: 66.7 });
  assert.deepEqual(guideForSelect('caramel-e90'), { w: 38.1, h: 69.9 });
  assert.deepEqual(guideForSelect('size:cabinet-t3'), { w: 146.1, h: 203.2 });
  assert.equal(GUIDE.yugioh.w, 59);
  assert.equal(GUIDE.mtg.h, 88);
  assert.equal(GAME_CUE_ENABLED, false);
});

test('a dummy profile loads with no change to the loader', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-profile-'));
  const profile = {
    id: 'test-game',
    label: 'Test game',
    family: 'tcg',
    size_mm: { w: 63, h: 88, tol: 0.5 },
    thickness: ['std-tcg'],
    surfaces: ['paper-gloss'],
    centering: { PSA: { 10: [55, 75] } },
    id_features: ['set_code'],
    data_sources: { catalog: 'none', prices: 'none' },
    status: 'fixture',
  };
  fs.writeFileSync(path.join(dir, 'test-game.json'), JSON.stringify(profile));
  const loaded = loadProfiles(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'test-game');
  assert.equal(loaded[0].size_mm.w, 63);
});

test('the bundled set pack imports and an empty pack stays empty', async () => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'catalog/pack.json'), 'utf8'));
  const db = memoryCatalog();
  assert.equal(await importCatalog(db, pack), 0);
  assert.deepEqual(await db.all(), []);
  const one = memoryCatalog();
  const count = await importCatalog(one, {
    rows: [{ game: 'ygo', set_id: 'FIX', name: 'Fixture set', release_date: '', card_count: 0, source: 'fixture' }],
  });
  assert.equal(count, 1);
  assert.equal((await one.all())[0].set_id, 'FIX');
  const opened = await openCatalog({});
  assert.equal(opened.kind, 'memory');
  const calls = [];
  const native = await openCatalog({
    Capacitor: {
      Plugins: {
        CapacitorSQLite: {
          async createConnection(options) { calls.push(options.database); },
          async open() {},
          async execute() {},
          async run() {},
          async query() { return { values: [] }; },
        },
      },
    },
  });
  assert.equal(native.kind, 'sqlite');
  assert.deepEqual(calls, ['card-deals-catalog']);
});
