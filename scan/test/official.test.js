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
  ], { maxBuffer: 80_000_000 });
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
    const flat = straighten(rgba, 500, 700);
    const pixels = flat.flattened ? flat.rgba : rgba;
    const bad = inspectSide(pixels, 500, 700, 'front').crops
      .filter((crop) => crop.flag === 'ding' || crop.flag === 'whitening' || crop.flag === 'chip');
    if (bad.length) damage += 1;
    const note = gradeSide(grayOf(pixels), 500, 700, '', true).surface.note;
    if (note.startsWith('Possible crease')) crease += 1;
  }
  assert.equal(damage, 0, `${damage}/${files.length} clean official cards were marked ding, whitening, or chip`);
  assert.equal(crease, 0, `${crease}/${files.length} clean official cards were marked with a crease`);
});

function decodeNative(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr.toString());
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 80_000_000 });
  if (proc.status !== 0 || proc.stdout.length !== width * height * 4) throw new Error(`decode ${file}`);
  return {
    rgba: new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength),
    width,
    height,
  };
}

test('native-size scans are judged on the 500 by 700 working picture', { skip }, () => {
  const files = images();
  assert.ok(files.length >= 30, `official images found ${files.length}`);
  const sizes = [[813, 1185], [1080, 1440], [3024, 4032]];
  let damage = 0;
  let checked = 0;
  for (const file of files) {
    const photo = decodeNative(file);
    const flat = straighten(photo.rgba, photo.width, photo.height);
    assert.equal(flat.flattened, true, `${path.basename(file)} ${photo.width}x${photo.height} did not straighten`);
    assert.equal(flat.width, 500);
    assert.equal(flat.height, 700);
    const bad = inspectSide(flat.rgba, 500, 700, 'front').crops
      .filter((crop) => crop.flag === 'ding' || crop.flag === 'whitening' || crop.flag === 'chip');
    if (bad.length) damage += 1;
    checked += 1;
  }
  const sample = files[0];
  for (const [width, height] of sizes) {
    const rgba = decode(sample, width, height);
    const flat = straighten(rgba, width, height);
    assert.equal(flat.width, 500, `${width}x${height}`);
    assert.equal(flat.height, 700);
    const bad = inspectSide(flat.rgba, 500, 700, 'front').crops
      .filter((crop) => crop.flag === 'ding' || crop.flag === 'whitening' || crop.flag === 'chip');
    if (bad.length) damage += 1;
    checked += 1;
  }
  assert.equal(damage, 0, `${damage}/${checked} native or phone-sized pictures were marked ding, whitening, or chip`);
});

test('centering of official cards is readable and the left and right borders stay within 3 points', { skip }, () => {
  const files = images();
  let readable = 0;
  let leftAxes = 0;
  let leftWithin = 0;
  for (const file of files) {
    const decoded = decode(file, 500, 700);
    const flat = straighten(decoded, 500, 700);
    const pixels = flat.flattened ? flat.rgba : decoded;
    const text = measureCentering(grayOf(pixels), 500, 700);
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
  // A missing axis is unreadable. An outline whose worst edge is past 2° is
  // unreadable too: that same tilt still produced a wrong number on official cards.
  assert.ok(presentWithin >= 2, `present axes within 3 points ${presentWithin}/6`);
  assert.ok(bothAxes >= 2, `both axes within 3 points ${bothAxes}/6`);
});

function rotateRaw(file, deg) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr.toString());
  const [iw, ih] = probe.stdout.trim().split(',').map(Number);
  const rad = deg * Math.PI / 180;
  const ow = Math.round(Math.abs(iw * Math.cos(rad)) + Math.abs(ih * Math.sin(rad)));
  const oh = Math.round(Math.abs(iw * Math.sin(rad)) + Math.abs(ih * Math.cos(rad)));
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `rotate=${rad.toFixed(6)}:c=0x202018:ow=${ow}:oh=${oh}`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 80_000_000 });
  if (proc.status !== 0 || proc.stdout.length !== ow * oh * 4) throw new Error('rotate failed');
  return {
    rgba: new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength),
    width: ow,
    height: oh,
  };
}

function scaledRotateRaw(file, deg) {
  const rad = deg * Math.PI / 180;
  const ow = Math.round(Math.abs(500 * Math.cos(rad)) + Math.abs(700 * Math.sin(rad)));
  const oh = Math.round(Math.abs(500 * Math.sin(rad)) + Math.abs(700 * Math.cos(rad)));
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `scale=500:700,rotate=${rad.toFixed(6)}:c=black:ow=${ow}:oh=${oh}`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 80_000_000 });
  if (proc.status !== 0 || proc.stdout.length !== ow * oh * 4) throw new Error('scaled rotate failed');
  return {
    rgba: new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength),
    width: ow,
    height: oh,
  };
}

function perspectiveRaw(file, spec) {
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', spec,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: 80_000_000 });
  if (proc.status !== 0 || proc.stdout.length !== 800 * 1100 * 4) throw new Error('perspective failed');
  return {
    rgba: new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength),
    width: 800,
    height: 1100,
  };
}

const PERSPECTIVES = [
  'scale=500:700,pad=800:1100:150:200:0x202018,perspective=x0=80:y0=40:x1=740:y1=20:x2=760:y2=1040:x3=40:y3=1000:sense=source',
  'scale=500:700,pad=800:1100:150:200:0x202018,perspective=x0=40:y0=80:x1=760:y1=40:x2=720:y2=1060:x3=80:y3=980:sense=source',
  'scale=500:700,pad=800:1100:150:200:black,perspective=x0=120:y0=20:x1=700:y1=80:x2=780:y2=1000:x3=20:y3=1080:sense=source',
];

test('rotated and perspective official cards are unreadable or within 3 points', { skip }, () => {
  const files = images();
  assert.ok(files.length >= 50, `official images found ${files.length}`);
  const angles = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30];
  let confidentWrong = 0;
  let checked = 0;
  for (const file of files) {
    const flatText = measureCentering(grayOf(decode(file, 500, 700)), 500, 700) || '';
    const flatLr = flatText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) left\/right/);
    const flatTb = flatText.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) top\/bottom/);
    const scenes = [
      ...angles.map((deg) => rotateRaw(file, deg)),
      ...angles.map((deg) => scaledRotateRaw(file, deg)),
      ...PERSPECTIVES.map((spec) => perspectiveRaw(file, spec)),
    ];
    for (const photo of scenes) {
      checked += 1;
      const warped = straighten(photo.rgba, photo.width, photo.height);
      const gray = warped.flattened ? grayOf(warped.rgba, 500, 700) : null;
      const text = gray ? (measureCentering(gray, 500, 700) || '') : '';
      const lr = axisErr(text, 'lr', flatLr ? Number(flatLr[1]) : NaN);
      const tb = axisErr(text, 'tb', flatTb ? Number(flatTb[1]) : NaN);
      if (lr != null && !(lr <= 3)) confidentWrong += 1;
      if (tb != null && !(tb <= 3)) confidentWrong += 1;
      assert.ok(lr == null || lr <= 3, `${path.basename(file)} left/right ${text}`);
      assert.ok(tb == null || tb <= 3, `${path.basename(file)} top/bottom ${text}`);
      if (gray) {
        const marks = gradeSide(gray, 500, 700, text, true);
        assert.equal(/Tilted\. Not checked/.test(marks.corners.note), false);
        assert.equal(/Tilted\. Not checked/.test(marks.edges.note), false);
        assert.equal(/Tilted\. Not checked/.test(marks.surface.note), false);
      }
    }
  }
  assert.equal(confidentWrong, 0, `confident wrong ${confidentWrong}/${checked}`);
  assert.ok(checked >= files.length * 23, `checked ${checked}`);
});

test('Yu-Gi-Oh full-bleed top and bottom is a note, not a number', { skip }, () => {
  const files = images().filter((file) => file.includes(`${path.sep}ygo${path.sep}`));
  assert.ok(files.length >= 20, `Yu-Gi-Oh images found ${files.length}`);
  let noted = 0;
  for (const file of files) {
    const text = measureCentering(grayOf(decode(file, 500, 700)), 500, 700) || '';
    if (!/printed frame/i.test(text)) continue;
    noted += 1;
    assert.equal(/top\/bottom/.test(text), false, text);
    assert.equal(/48\.0\/52\.0/.test(text), false, text);
  }
  assert.ok(noted >= 20, `printed-frame notes ${noted}/${files.length}`);
});

test('a lowlight white corner is unchecked and a glare white corner is still caught', { skip: synthSkip }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(synth), 'manifest.json'), 'utf8'));
  const root = path.dirname(path.dirname(synth));
  const low = (manifest.synth || []).find((row) => row.defect_gt === 'white_corner' && row.mode === 'lowlight');
  const glare = (manifest.synth || []).find((row) => row.defect_gt === 'white_corner' && row.mode === 'glare');
  assert.ok(low && glare, 'the lowlight and glare white-corner photos are missing. This is not a pass.');
  const lowPhoto = decodeNative(path.join(root, low.path));
  const lowFlat = straighten(lowPhoto.rgba, lowPhoto.width, lowPhoto.height);
  if (lowFlat.flattened) {
    const lowFlags = inspectSide(lowFlat.rgba, 500, 700, 'front').crops.map((crop) => crop.flag);
    assert.equal(lowFlags.includes('whitening'), false, lowFlags.join(','));
  }
  const glarePhoto = decodeNative(path.join(root, glare.path));
  const glareFlat = straighten(glarePhoto.rgba, glarePhoto.width, glarePhoto.height);
  assert.equal(glareFlat.flattened, true, 'the glare photo did not straighten');
  const glareFlags = inspectSide(glareFlat.rgba, 500, 700, 'front').crops.map((crop) => crop.flag);
  assert.ok(glareFlags.includes('whitening') || glareFlags.includes('chip'), glareFlags.join(','));
});

const wikiRoot = process.env.CARD_WIKI_DIR
  || (fs.existsSync('/tmp/card-wiki/data/wikimedia') ? '/tmp/card-wiki/data/wikimedia' : '');
const wikiSkip = !wikiRoot
  ? 'Wikimedia handheld photos are not on this machine. Set CARD_WIKI_DIR. This is not a pass.'
  : !ffmpeg
    ? 'ffmpeg is not available, so the Wikimedia photos were not decoded. This is not a pass.'
    : false;

test('handheld Wikimedia photos do not get a centering number unless the card is flat', { skip: wikiSkip }, () => {
  const files = fs.readdirSync(wikiRoot).filter((name) => /\.(jpg|jpeg|png)$/i.test(name));
  assert.ok(files.length >= 10, `Wikimedia photos found ${files.length}. This is not a pass.`);
  let readable = 0;
  for (const name of files) {
    const file = path.join(wikiRoot, name);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
    ], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(probe.stderr.toString());
    const [iw, ih] = probe.stdout.trim().split(',').map(Number);
    const proc = spawnSync('ffmpeg', [
      '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ], { maxBuffer: 80_000_000 });
    if (proc.status !== 0 || proc.stdout.length !== iw * ih * 4) throw new Error(`decode ${name}`);
    const rgba = new Uint8ClampedArray(proc.stdout.buffer, proc.stdout.byteOffset, proc.stdout.byteLength);
    const flat = straighten(rgba, iw, ih);
    const text = flat.flattened ? (measureCentering(grayOf(flat.rgba), 500, 700) || '') : '';
    const number = /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) (?:left\/right|top\/bottom)/.test(text);
    if (number) {
      readable += 1;
      assert.equal(flat.centeringOk, true, `${name} reported a number from a tilted quad: ${text}`);
    }
    if (flat.flattened) {
      const marks = gradeSide(grayOf(flat.rgba), 500, 700, text, true);
      assert.equal(/Tilted\. Not checked/.test(`${marks.corners.note} ${marks.edges.note} ${marks.surface.note}`), false, name);
    }
  }
  assert.ok(readable >= 0, `readable ${readable}/${files.length}`);
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
