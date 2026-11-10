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
import { gradeSide, measureCentering, straighten } from '../pipeline.js';
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

const synth = process.env.CARD_SYNTH_DIR
  || (fs.existsSync('/tmp/card-synth/data/synth') ? '/tmp/card-synth/data/synth' : '');
const synthSkip = !synth
  ? 'Synthetic card fixtures are not on this machine. Set CARD_SYNTH_DIR. This is not a pass.'
  : !ffmpeg
    ? 'ffmpeg is not available, so the synthetic fixtures were not decoded. This is not a pass.'
    : false;

function decodeNative(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr.toString());
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 40_000_000 });
  if (proc.status !== 0) throw new Error(proc.stderr.toString());
  return {
    rgba: new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength),
    width,
    height,
  };
}

function sheet(paint) {
  const rgba = new Uint8ClampedArray(500 * 700 * 4);
  for (let y = 0; y < 700; y++) {
    for (let x = 0; x < 500; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * 500 + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('a 40 to 80 pixel corner scuff is whitening, and the same corner without it is not', () => {
  const border = (x, y) => x < 50 || y < 50;
  const plain = sheet((x, y) => (border(x, y) ? [190, 186, 176] : [70, 80, 90]));
  const plainFlag = inspectSide(plain, 500, 700, 'front').crops.find((crop) => crop.id === 'front-corner-tl').flag;
  assert.equal(plainFlag, 'clear', plainFlag);
  const scuffed = sheet((x, y) => {
    if (x + y < 52) return [250, 250, 250];
    return border(x, y) ? [190, 186, 176] : [70, 80, 90];
  });
  const flag = inspectSide(scuffed, 500, 700, 'front').crops.find((crop) => crop.id === 'front-corner-tl').flag;
  assert.equal(flag, 'whitening', flag);
});

test('a long thin mid-card bar is a crease, and the card without it is not', () => {
  const paint = (bar) => sheet((x, y) => {
    const edge = x < 40 || x >= 460 || y < 40 || y >= 660;
    if (bar && y >= 210 && y < 214 && x >= 110 && x < 390) return [15, 15, 15];
    return edge ? [200, 196, 186] : [120, 140, 150];
  });
  const clear = gradeSide(grayOf(paint(false)), 500, 700, '', true).surface;
  assert.equal(clear.score, 10, clear.note);
  assert.equal(clear.note.startsWith('Possible crease'), false);
  const marked = gradeSide(grayOf(paint(true)), 500, 700, '', true).surface;
  assert.equal(marked.score, 6, marked.note);
  assert.equal(marked.note.startsWith('Possible crease'), true);
});

test('synthetic white-corner flats are still called whitening', { skip: synthSkip }, () => {
  const files = fs.readdirSync(synth).filter((name) => name.startsWith('flat_') && name.includes('white_corner'));
  assert.ok(files.length >= 8, `only ${files.length} white-corner flats were found`);
  let caught = 0;
  for (const name of files) {
    const photo = decodeNative(path.join(synth, name));
    const flags = inspectSide(photo.rgba, photo.width, photo.height, 'front').crops.map((crop) => crop.flag);
    if (flags.includes('whitening') || flags.includes('chip')) caught += 1;
  }
  assert.equal(caught, files.length, `white corners caught ${caught}/${files.length}`);
});

test('synthetic crease flats are still called a crease', { skip: synthSkip }, () => {
  const files = fs.readdirSync(synth).filter((name) => name.startsWith('flat_') && name.includes('_crease'));
  assert.ok(files.length >= 8, `only ${files.length} crease flats were found`);
  let caught = 0;
  for (const name of files) {
    const photo = decodeNative(path.join(synth, name));
    const surface = gradeSide(grayOf(photo.rgba), photo.width, photo.height, '', true).surface;
    if (surface.score === 6 && surface.note.startsWith('Possible crease')) caught += 1;
  }
  assert.equal(caught, files.length, `creases caught ${caught}/${files.length}`);
});

function axisErr(text, kind, truth) {
  const re = kind === 'lr'
    ? /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/
    : /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/;
  const match = text.match(re);
  if (!match) return null;
  return Math.abs(Number(match[1]) - truth);
}

test('lined-up synthetic photos agree on centering within 3 points', { skip: synthSkip }, () => {
  const manifestPath = path.join(path.dirname(synth), 'manifest.json');
  assert.equal(fs.existsSync(manifestPath), true, 'the synthetic manifest is missing. This is not a pass.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rows = (manifest.synth || []).filter((row) => row.mode === 'lined-up' && row.centering_gt);
  assert.equal(rows.length, 6, `lined-up fixtures found ${rows.length}`);
  const root = path.dirname(path.dirname(synth));
  let presentWithin = 0;
  let bothAxes = 0;
  for (const row of rows) {
    const image = decodeNative(path.join(root, row.path));
    const flat = straighten(image.rgba, image.width, image.height);
    const text = flat.flattened ? (measureCentering(grayOf(flat.rgba), 500, 700) || '') : '';
    const lr = axisErr(text, 'lr', row.centering_gt.lr[0]);
    const tb = axisErr(text, 'tb', row.centering_gt.tb[0]);
    if (lr != null) assert.ok(lr <= 3, `${row.name} left/right ${text}`);
    if (tb != null) assert.ok(tb <= 3, `${row.name} top/bottom ${text}`);
    if ((lr != null || tb != null) && (lr == null || lr <= 3) && (tb == null || tb <= 3)) presentWithin += 1;
    if (lr != null && tb != null && lr <= 3 && tb <= 3) bothAxes += 1;
  }
  // The bench accepts a missing axis. Both axes are required on the cards whose outline is stable.
  assert.ok(presentWithin >= 5, `present axes within 3 points ${presentWithin}/6`);
  assert.ok(bothAxes >= 4, `both axes within 3 points ${bothAxes}/6`);
});

test('a rotated official card stays within 3 points of its flat centering', { skip }, () => {
  const files = images();
  const source = files.find((file) => file.includes('89631139')) || files[0];
  const out = path.join('/tmp', 'card-warp-official.png');
  const made = spawnSync('ffmpeg', [
    '-y', '-v', 'error', '-i', source,
    '-vf', 'scale=520:728,pad=700:980:90:120:0x2a241c,rotate=0.05:c=0x2a241c:ow=700:oh=980',
    out,
  ]);
  assert.equal(made.status, 0, 'the warped official fixture could not be built. This is not a pass.');
  const flatText = measureCentering(grayOf(decode(source, 500, 700)), 500, 700) || '';
  const photo = decodeNative(out);
  const warped = straighten(photo.rgba, photo.width, photo.height);
  assert.equal(warped.flattened, true, 'the warped official photo did not straighten');
  const text = measureCentering(grayOf(warped.rgba), 500, 700) || '';
  const flatLr = flatText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/);
  const warpLr = text.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/);
  const flatTb = flatText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/);
  const warpTb = text.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/);
  assert.ok(flatLr && warpLr, `${text} vs ${flatText}`);
  assert.ok(flatTb && warpTb, `${text} vs ${flatText}`);
  assert.ok(Math.abs(Number(warpLr[1]) - Number(flatLr[1])) <= 3, `${text} vs ${flatText}`);
  assert.ok(Math.abs(Number(warpTb[1]) - Number(flatTb[1])) <= 3, `${text} vs ${flatText}`);
});

test('Yu-Gi-Oh full-bleed reads are labeled as the printed frame', { skip }, () => {
  const files = images().filter((file) => file.includes(`${path.sep}ygo${path.sep}`));
  assert.ok(files.length >= 20, `Yu-Gi-Oh images found ${files.length}`);
  let labeled = 0;
  let locked = 0;
  for (const file of files) {
    const text = measureCentering(grayOf(decode(file, 500, 700)), 500, 700) || '';
    if (!/top\/bottom/.test(text)) continue;
    if (text.includes('Printed frame.')) labeled += 1;
    if (/48\.0\/52\.0 top\/bottom/.test(text)) locked += 1;
  }
  assert.ok(labeled >= 20, `printed-frame labels ${labeled}/${files.length}`);
  assert.equal(locked, labeled);
});

test('a lowlight white corner is unchecked and a glare white corner is still caught', { skip: synthSkip }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(synth), 'manifest.json'), 'utf8'));
  const root = path.dirname(path.dirname(synth));
  const low = (manifest.synth || []).find((row) => row.defect_gt === 'white_corner' && row.mode === 'lowlight');
  const glare = (manifest.synth || []).find((row) => row.defect_gt === 'white_corner' && row.mode === 'glare');
  assert.ok(low && glare, 'the lowlight and glare white-corner photos are missing. This is not a pass.');
  const lowPhoto = decodeNative(path.join(root, low.path));
  const lowFlat = straighten(lowPhoto.rgba, lowPhoto.width, lowPhoto.height);
  assert.equal(lowFlat.flattened, true, 'the lowlight photo did not straighten');
  const lowFlags = inspectSide(lowFlat.rgba, 500, 700, 'front').crops.map((crop) => crop.flag);
  assert.equal(lowFlags.includes('whitening'), false, lowFlags.join(','));
  const glarePhoto = decodeNative(path.join(root, glare.path));
  const glareFlat = straighten(glarePhoto.rgba, glarePhoto.width, glarePhoto.height);
  assert.equal(glareFlat.flattened, true, 'the glare photo did not straighten');
  const glareFlags = inspectSide(glareFlat.rgba, 500, 700, 'front').crops.map((crop) => crop.flag);
  assert.ok(glareFlags.includes('whitening') || glareFlags.includes('chip'), glareFlags.join(','));
});

test('a synthetic crease with no remaining step is not invented', { skip: synthSkip }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(synth), 'manifest.json'), 'utf8'));
  const root = path.dirname(path.dirname(synth));
  const rows = (manifest.synth || []).filter((row) => row.kind === 'synth_gt' && row.defect_gt === 'crease' && row.mode !== 'too-far');
  assert.ok(rows.length >= 2, `geometric crease photos found ${rows.length}`);
  for (const row of rows) {
    const image = decodeNative(path.join(root, row.path));
    const flat = straighten(image.rgba, image.width, image.height);
    if (!flat.flattened) continue;
    const note = gradeSide(grayOf(flat.rgba), 500, 700, '', true).surface.note;
    assert.equal(note.startsWith('Possible crease'), false, `${row.name} ${note}`);
  }
});
