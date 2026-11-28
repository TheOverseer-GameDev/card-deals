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
import { outermostQuad, rectifiedAspect } from '../core/outline.js';
import { sizeClassOf } from '../../scripts/fixtures/eval_synthetic.mjs';
import { GAME_CUE_ENABLED, cueGame, resolveGameCue } from '../game-cue.js';
import { SIZE_CLASSES, classForSize, guideForSelect } from '../size-class.js';

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

test('a tilted 63 by 88 quad stays standard-tcg after rectification', () => {
  function project(W, H, pitch, yaw) {
    const tp = pitch * Math.PI / 180;
    const ty = yaw * Math.PI / 180;
    const focal = 780;
    const cx = 160;
    const cy = 213;
    return [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([X, Y]) => {
      const x1 = X * Math.cos(ty);
      const z1 = -X * Math.sin(ty);
      const y2 = Y * Math.cos(tp) - z1 * Math.sin(tp);
      const z2 = Y * Math.sin(tp) + z1 * Math.cos(tp);
      const distance = focal + z2;
      return { x: cx + focal * x1 / distance, y: cy + focal * y2 / distance };
    });
  }
  const tilted = project(179, 250, 18, 12);
  const ratio = rectifiedAspect(tilted, 320, 426);
  assert.equal(sizeClassOf(ratio), 'standard-tcg');
  assert.ok(Math.abs(ratio - 63 / 88) < Math.abs(ratio - 59 / 86));
});

test('a card on near-black cloth is not the photo rectangle', () => {
  const width = 80;
  const height = 110;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 22 && x < 58 && y >= 18 && y < 92;
      const i = (y * width + x) * 4;
      const color = inside ? 210 : 8;
      rgba[i] = color;
      rgba[i + 1] = inside ? color : 10;
      rgba[i + 2] = inside ? color : 16;
      rgba[i + 3] = 255;
    }
  }
  const quad = outermostQuad(rgba, width, height);
  assert.ok(quad);
  assert.ok(quad[0].x > 8, `left ${quad[0].x}`);
  assert.ok(Math.abs(quad[0].x - 22) < 8, `left ${quad[0].x}`);
  assert.ok(Math.abs(quad[0].y - 18) < 8, `top ${quad[0].y}`);
  assert.ok(quad[1].x < width - 8);
});

test('the Magic versus Pokémon cue stays off and a user choice wins', () => {
  assert.equal(GAME_CUE_ENABLED, false);
  const cue = { game: 'pokemon', state: 'estimated' };
  assert.equal(resolveGameCue({ enabled: false, cue }).source, 'off');
  assert.equal(resolveGameCue({ enabled: true, userChoice: 'mtg', cue }).game, 'mtg');
  const width = 40;
  const height = 56;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 210;
    rgba[i + 1] = 180;
    rgba[i + 2] = 40;
    rgba[i + 3] = 255;
  }
  const quad = [{ x: 2, y: 2 }, { x: 37, y: 2 }, { x: 37, y: 53 }, { x: 2, y: 53 }];
  assert.equal(cueGame(rgba, width, height, quad, 'front').game, 'pokemon');
});

test('provisional size classes do not move the shipped guides', () => {
  assert.equal(guideForSelect('ygo').w, 59);
  assert.equal(guideForSelect('ygo').h, 86);
  assert.equal(guideForSelect('mtg').w, 63);
  assert.equal(guideForSelect('mtg').h, 88);
  assert.equal(guideForSelect('all').w, 59);
  assert.equal(guideForSelect('lorcana').w, 63);
  assert.equal(classForSize(66.7, 95.3).id, 'vintage-1952');
  assert.equal(classForSize(36.5, 66.7).id, 'tobacco-t206');
  assert.equal(classForSize(38.1, 69.9).id, 'caramel-e90');
  assert.equal(classForSize(127, 177.8).id, 'oversized-5x7');
  assert.equal(classForSize(146.1, 203.2).id, 'cabinet-t3');
  assert.equal(SIZE_CLASSES['caramel-e90'].provisional, true);
  assert.notEqual(classForSize(36.5, 66.7).id, classForSize(38.1, 69.9).id);
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
