import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';
import { fileURLToPath } from 'url';

const root = new URL('..', import.meta.url);
const files = ['boot.js', 'engine.js', 'lookup.js', 'ocr.js', 'image.js', 'prices.js', 'charts.js', 'gauges.js', 'scan.css'];

function source(name) {
  return fs.readFileSync(new URL(name, root), 'utf8');
}

test('scan code has no cloud model, token, or upload path', () => {
  const banned = [
    /openai/i,
    /anthropic/i,
    /generativelanguage/i,
    /huggingface/i,
    /replicate\.com/i,
    /openrouter/i,
    /api\.groq/i,
    /mistral\.ai/i,
    /localhost:\d+\/v1/i,
    /sessionStorage/,
    /indexedDB/,
    /sendBeacon/,
    /WebSocket/,
    /createObjectURL/,
    /setInterval/,
    /requestAnimationFrame/,
    /grade10_rate/,
    /psa10_odds/,
    /https?:\/\//,
  ];
  for (const name of files) {
    const text = source(name);
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${name} matched ${pattern}`);
  }
  const boot = source('boot.js');
  assert.match(boot, /card-scan-camera/);
  assert.equal(boot.includes('localStorage'), true);
  assert.equal(/localStorage[\s\S]{0,80}(canvas|blob|photo|data:image)/i.test(boot), false);
  for (const name of files) {
    if (name === 'boot.js') continue;
    assert.equal(source(name).includes('localStorage'), false, name);
  }
  assert.equal(boot.includes("from './ocr.js'"), false);
  assert.equal(boot.includes("import('./ocr.js')"), true);
  assert.equal(boot.match(/setTimeout/g).length, 1);
  const lookup = source('lookup.js');
  assert.equal(lookup.includes('fetchImpl'), true);
  assert.equal(source('engine.js').includes('localPath'), true);
});

test('service worker still refuses cross-origin and non-GET, and names the scan shell', () => {
  const sw = fs.readFileSync(fileURL('sw.js'), 'utf8');
  assert.match(sw, /r\.method!='GET'/);
  assert.match(sw, /u\.origin!=location\.origin/);
  assert.match(sw, /caches\.delete/);
  for (const asset of ['scan/boot.js', 'scan/engine.js', 'scan/lookup.js', 'scan/image.js', 'scan/prices.js', 'scan/charts.js', 'scan/gauges.js', 'scan/scan.css', 'scan/verified-prices.json']) {
    assert.equal(sw.includes(asset), true, asset);
  }
  assert.equal(sw.includes('tesseract'), false);
  const index = fs.readFileSync(fileURL('index.html'), 'utf8');
  assert.equal(index.includes('scan/boot.js'), true);
  assert.equal(index.split('scan/boot.js').length, 2);
});

test('vendored OCR files are present and the language pack is gzip', () => {
  const gz = fs.readFileSync(fileURL('scan/vendor/lang/eng.traineddata.gz'));
  assert.equal(gz[0], 0x1f);
  assert.equal(gz[1], 0x8b);
  assert.ok(fs.statSync(fileURL('scan/vendor/core/tesseract-core-simd-lstm.wasm.js')).size > 1_000_000);
  assert.ok(fs.statSync(fileURL('scan/vendor/core/tesseract-core-lstm.wasm.js')).size > 1_000_000);
  assert.ok(fs.statSync(fileURL('scan/vendor/worker.min.js')).size > 10_000);
});

function fileURL(rel) {
  return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
}
