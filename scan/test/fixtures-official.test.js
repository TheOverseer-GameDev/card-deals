/**
 * Official-image fixtures stay out of the real-photo gates.
 * The committed manifest and synthetic report must not loosen a bar.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { outermostQuad } from '../core/outline.js';
import { sizeClassOf } from '../../scripts/fixtures/eval_synthetic.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('the manifest names official sources and skips sports and One Piece', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/manifest.json'), 'utf8'));
  const skipped = new Set(manifest.skipped.map((row) => row.id));
  assert.equal(skipped.has('sports-standard'), true);
  assert.equal(skipped.has('onepiece'), true);
  assert.match(JSON.stringify(manifest.skipped), /not used/i);
  const counts = {};
  for (const card of manifest.cards) {
    counts[card.game] = (counts[card.game] || 0) + 1;
    assert.ok(card.card_id);
    assert.ok(card.source_url.startsWith('https://'));
    assert.equal(typeof card.set, 'string');
    assert.equal(typeof card.number, 'string');
    assert.match(card.licence_note, /copyright|Copyright|Konami|Wizards|Pokémon/);
    assert.equal(card.image_url.startsWith('https://'), true);
  }
  for (const game of ['mtg', 'yugioh', 'pokemon']) {
    assert.ok(counts[game] >= 120 && counts[game] <= 160, `${game} ${counts[game]}`);
  }
  const ygo = manifest.cards.filter((card) => card.game === 'yugioh' && card.stratum === 'pre-2008');
  assert.ok(ygo.length >= 20, `pre-2008 ${ygo.length}`);
});

test('the synthetic report is labelled synthetic and does not touch the ratchet', () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/synthetic-report.json'), 'utf8'));
  assert.equal(report.synthetic, true);
  assert.equal(report.label, 'SYNTHETIC');
  assert.equal(report.real_photo_gate, 'not applied');
  assert.equal(report.flags_changed, false);
  assert.match(report.m23_m29.real_photo_bars, /pending real photos/);
  const spec = fs.readFileSync(path.join(root, 'bench/spec.json'), 'utf8');
  assert.equal(spec.includes('M23'), false);
  const baseline = fs.readFileSync(path.join(root, 'bench/baseline.json'), 'utf8');
  assert.equal(baseline.includes('SYNTHETIC'), false);
});

test('geometry size class separates Yu-Gi-Oh from the shared 63 by 88 class', () => {
  assert.equal(sizeClassOf(59 / 86), 'yugioh');
  assert.equal(sizeClassOf(63 / 88), 'standard-tcg');
  const width = 80;
  const height = 100;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 20 && x < 60 && y >= 15 && y < 85;
      const i = (y * width + x) * 4;
      const color = inside ? 240 : 180;
      rgba[i] = color;
      rgba[i + 1] = color;
      rgba[i + 2] = color;
      rgba[i + 3] = 255;
    }
  }
  const quad = outermostQuad(rgba, width, height);
  assert.ok(quad);
  assert.ok(Math.abs(quad[0].x - 20) < 3);
  assert.ok(Math.abs(quad[0].y - 15) < 3);
});

test('fetcher and synth self-tests stay deterministic when Pillow is installed', () => {
  let missing = false;
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
  } catch {
    missing = true;
  }
  if (missing) return;
  execFileSync('python3', ['scripts/fixtures/fetch_official.py', '--self-test'], { cwd: root, stdio: 'pipe' });
  execFileSync('python3', ['scripts/fixtures/synth.py', '--self-test'], { cwd: root, stdio: 'pipe' });
});
