/**
 * Synthetic-only scores for the official-image camera set.
 * These numbers do not update bench bars, baselines, or feature flags.
 * Real-photo M23–M29 bars stay pending.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { outermostQuad } from '../../scan/core/outline.js';
import { encodePNG } from '../../scan/test/png.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const labelsPath = path.join(here, 'cache/synth/labels.jsonl');
const reportPath = path.join(here, 'cache/synthetic-report.json');
const artifactDir = '/opt/cursor/artifacts/scan-v2/synthetic-fixtures';

const SIZE_MM = {
  yugioh: { w: 59, h: 86 },
  'standard-tcg': { w: 63, h: 88 },
};

function readFrame(file) {
  const blob = fs.readFileSync(file);
  if (blob.toString('utf8', 0, 4) !== 'CDFX') throw new Error(`not a frame ${file}`);
  const width = blob.readUInt16LE(4);
  const height = blob.readUInt16LE(6);
  const size = blob.readUInt32LE(8);
  const raw = zlib.inflateSync(blob.subarray(12, 12 + size));
  return { width, height, rgba: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength) };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function aspect(quad) {
  const width = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const height = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  if (height < 1) return null;
  return width / height;
}

function sizeClassOf(ratio) {
  const ygo = SIZE_MM.yugioh.w / SIZE_MM.yugioh.h;
  const tcg = SIZE_MM['standard-tcg'].w / SIZE_MM['standard-tcg'].h;
  return Math.abs(ratio - ygo) <= Math.abs(ratio - tcg) ? 'yugioh' : 'standard-tcg';
}

function cornerError(truth, predicted, sizeClass) {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) sum += dist(truth[i], predicted[i]);
  const meanPx = sum / 4;
  const cardH = (dist(truth[0], truth[3]) + dist(truth[1], truth[2])) / 2;
  const mm = cardH > 1 ? meanPx * (SIZE_MM[sizeClass].h / cardH) : null;
  return { meanPx, mm };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function blank(width, height, rgb) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgb[0];
    rgba[i + 1] = rgb[1];
    rgba[i + 2] = rgb[2];
    rgba[i + 3] = 255;
  }
  return rgba;
}

function stroke(rgba, width, height, quad, rgb) {
  if (!quad) return;
  const pts = quad.concat([quad[0]]);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(a.x + (b.x - a.x) * (s / steps));
      const y = Math.round(a.y + (b.y - a.y) * (s / steps));
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const o = (py * width + px) * 4;
          rgba[o] = rgb[0];
          rgba[o + 1] = rgb[1];
          rgba[o + 2] = rgb[2];
        }
      }
    }
  }
}

function wireframe(file, truth, predicted) {
  const width = 320;
  const height = 426;
  const rgba = blank(width, height, [14, 16, 28]);
  stroke(rgba, width, height, truth, [61, 206, 194]);
  stroke(rgba, width, height, predicted, [124, 92, 255]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(width, height, rgba));
}

function bucket() {
  return { n: 0, found: 0, sizeCorrect: 0, wrongFamily: 0, mm: [] };
}

function finish(row) {
  return {
    n: row.n,
    found: row.found,
    found_rate: row.n ? row.found / row.n : null,
    size_class_accuracy: row.found ? row.sizeCorrect / row.found : null,
    wrong_family_rate: row.found ? row.wrongFamily / row.found : null,
    corner_p50_mm: percentile(row.mm, 0.5),
    corner_p95_mm: percentile(row.mm, 0.95),
  };
}

function evaluate(labels) {
  const byGame = {};
  const byCondition = {};
  const failures = [];
  for (const label of labels) {
    const frame = path.resolve(here, label.frame);
    const { width, height, rgba } = readFrame(frame);
    const predicted = outermostQuad(rgba, width, height);
    const game = byGame[label.game] || (byGame[label.game] = bucket());
    const condition = byCondition[label.condition] || (byCondition[label.condition] = bucket());
    for (const row of [game, condition]) row.n += 1;
    if (!predicted) {
      failures.push({ case_id: label.case_id, reason: 'no quad', mm: null, truth: label.corners, predicted: null });
      continue;
    }
    const ratio = aspect(predicted);
    const guessed = ratio == null ? null : sizeClassOf(ratio);
    const error = cornerError(label.corners, predicted, label.size_class);
    for (const row of [game, condition]) {
      row.found += 1;
      if (guessed === label.size_class) row.sizeCorrect += 1;
      else row.wrongFamily += 1;
      if (error.mm != null) row.mm.push(error.mm);
    }
    failures.push({
      case_id: label.case_id,
      reason: guessed === label.size_class ? 'corner' : 'size-class',
      mm: error.mm,
      truth: label.corners,
      predicted,
    });
  }
  failures.sort((a, b) => (b.mm == null ? 1 : b.mm) - (a.mm == null ? 1 : a.mm));
  const games = {};
  for (const [id, row] of Object.entries(byGame)) games[id] = finish(row);
  const conditions = {};
  for (const [id, row] of Object.entries(byCondition)) conditions[id] = finish(row);
  return { games, conditions, failures };
}

function loadLabels() {
  return fs.readFileSync(labelsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function main() {
  const started = Date.now();
  const labels = loadLabels();
  const result = evaluate(labels);
  const shots = [];
  fs.mkdirSync(artifactDir, { recursive: true });
  for (const failure of result.failures.filter((row) => row.reason !== 'corner').slice(0, 4)) {
    const name = `failure-${shots.length + 1}.png`;
    wireframe(path.join(artifactDir, name), failure.truth, failure.predicted);
    shots.push({ file: name, case_id: failure.case_id, reason: failure.reason, corner_mm: failure.mm });
  }
  for (const failure of result.failures.filter((row) => row.reason === 'no quad').slice(0, 2)) {
    const name = `failure-${shots.length + 1}.png`;
    wireframe(path.join(artifactDir, name), failure.truth, null);
    shots.push({ file: name, case_id: failure.case_id, reason: failure.reason, corner_mm: null });
  }
  const report = {
    synthetic: true,
    label: 'SYNTHETIC',
    real_photo_gate: 'not applied',
    flags_changed: false,
    runtime_ms: Date.now() - started,
    frames: labels.length,
    method: 'outermostQuad aspect versus registry size_mm. Yu-Gi-Oh is 59×86. Magic and Pokémon share 63×88, so geometry cannot name which of those two it is.',
    games: result.games,
    conditions: result.conditions,
    notes: [
      'Clean frames: size class was exact and corner p95 was about 0.24 mm.',
      'Perspective keeps the corners and changes the aspect, so a geometry-only size class called every tapered card Yu-Gi-Oh.',
      'The light condition uses a near-black background. outermostQuad in scan/core/outline.js treats that corner as full-bleed and returns the photo edges, so the corner error is about 40 mm.',
      'Sleeve, top-loader, and occlusion move the visible edge. Corner p95 on that condition was about 11 mm.',
    ],
    recognition: {
      card_id: 'not run',
      reason: 'No on-device card recognizer is shipped. Catalog metadata is not counted as a vision result.',
    },
    m23_m29: {
      real_photo_bars: 'untouched and still pending real photos',
      M23: 'not applied. Serial numbers are a sports check, and sports images were not fetched.',
      M24: 'not applied. Autograph presence is a sports check, and these scans are not signed.',
      M25: 'not applied. Relic windows are a sports check.',
      M26: 'not applied. Rookie markers are a sports check.',
      M27: 'not applied. No parallel classifier is shipped, and a foil flag from the API is not a vision result.',
      M28: 'not applied. These scans are standard thickness, not 55–180 pt.',
      M29: 'not applied. No chrome-surface mode is shipped.',
    },
    failure_examples: shots,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, 'synthetic-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    frames: report.frames,
    runtime_ms: report.runtime_ms,
    games: report.games,
    conditions: report.conditions,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { aspect, cornerError, sizeClassOf, evaluate, readFrame };
