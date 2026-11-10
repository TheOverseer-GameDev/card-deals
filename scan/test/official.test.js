/**
 * Real official card images, kept outside the repo. This is not a silent pass:
 * if the folder or ffmpeg is missing, the test is skipped with a reason.
 *
 * CARD_OFFICIAL_DIR should contain ygo/ and mtg/ folders of .jpg files,
 * or point at data/official from the local benchmark set.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { gradeSide, measureCentering } from '../pipeline.js';
import { inspectSide } from '../edges.js';

const root = process.env.CARD_OFFICIAL_DIR
  || (fs.existsSync('/tmp/card-official/data/official') ? '/tmp/card-official/data/official' : '');
const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
const skip = !root
  ? 'Official card images are not on this machine. Set CARD_OFFICIAL_DIR. This is not a pass.'
  : !ffmpeg
    ? 'ffmpeg is not available, so the official card images were not decoded. This is not a pass.'
    : false;

function images() {
  const files = [];
  for (const game of ['ygo', 'mtg']) {
    const dir = path.join(root, game);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.jpg') || name.endsWith('.png')) files.push(path.join(dir, name));
    }
  }
  return files;
}

function decode(file, width, height) {
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', `scale=${width}:${height}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 20_000_000 });
  if (proc.status !== 0) throw new Error(proc.stderr.toString());
  return new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength);
}

function grayOf(rgba) {
  const gray = new Float32Array(rgba.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return gray;
}

test('clean official cards are not called nicked, whitened, or creased', { skip }, () => {
  const files = images();
  assert.ok(files.length >= 30, `only ${files.length} official images were found`);
  let damage = 0;
  let crease = 0;
  for (const file of files) {
    const rgba = decode(file, 500, 700);
    const bad = inspectSide(rgba, 500, 700, 'front').crops
      .filter((crop) => crop.flag === 'ding' || crop.flag === 'whitening' || crop.flag === 'chip');
    if (bad.length) damage += 1;
    const note = gradeSide(grayOf(rgba), 500, 700, '', true).surface.note;
    if (note.startsWith('Possible crease')) crease += 1;
  }
  assert.equal(damage, 0, `${damage}/${files.length} clean official cards were marked ding, whitening, or chip`);
  assert.equal(crease, 0, `${crease}/${files.length} clean official cards were marked with a crease`);
});

test('centering of official cards is readable and the left and right borders stay within 3 points', { skip }, () => {
  const files = images();
  let readable = 0;
  let leftAxes = 0;
  let leftWithin = 0;
  for (const file of files) {
    const flat = decode(file, 500, 700);
    const text = measureCentering(grayOf(flat), 500, 700);
    if (!text) continue;
    readable += 1;
    const left = text.match(/(\d+\.\d+)\/(\d+\.\d+) left\/right/);
    if (left) {
      leftAxes += 1;
      if (Math.abs(Number(left[1]) - 50) <= 3) leftWithin += 1;
    }
  }
  assert.ok(readable >= 50, `readable centering ${readable}/${files.length}`);
  assert.ok(leftWithin / leftAxes >= 0.8, `left/right within 3 points ${leftWithin}/${leftAxes}`);
});

test('planted nicks and corner damage on official cards are still caught', { skip }, () => {
  const files = images();
  let planted = 0;
  let caught = 0;
  for (const file of files) {
    const rgba = decode(file, 500, 700);
    const nick = new Uint8ClampedArray(rgba);
    for (let y = 0; y < 8; y++) {
      for (let x = 200; x < 232; x++) {
        const i = (y * 500 + x) * 4;
        nick[i] = 250;
        nick[i + 1] = 250;
        nick[i + 2] = 250;
      }
    }
    planted += 1;
    const nickFlag = inspectSide(nick, 500, 700, 'front').crops.find((crop) => crop.id === 'front-edge-top').flag;
    if (nickFlag === 'ding' || nickFlag === 'whitening' || nickFlag === 'chip') caught += 1;
    const corner = new Uint8ClampedArray(rgba);
    const edgeTone = rgba[(0 * 500 + 40) * 4];
    const ink = edgeTone > 128 ? 10 : 245;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        if (Math.hypot(x, y) >= 26) continue;
        const i = (y * 500 + x) * 4;
        corner[i] = ink;
        corner[i + 1] = ink;
        corner[i + 2] = ink;
      }
    }
    planted += 1;
    const cornerFlag = inspectSide(corner, 500, 700, 'front').crops.find((crop) => crop.id === 'front-corner-tl').flag;
    if (cornerFlag === 'rounding' || cornerFlag === 'chip' || cornerFlag === 'ding') caught += 1;
  }
  assert.ok(caught / planted >= 0.9, `planted defects caught ${caught}/${planted}`);
});
