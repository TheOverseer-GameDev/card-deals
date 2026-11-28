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
