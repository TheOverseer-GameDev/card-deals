/**
 * The new result sections are in the scan panel and fill in from a local photo.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('missing'); return;
    }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': type });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('phase 2 sections appear from a local photo and history can be cleared', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  try {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' })).newPage();
  const requests = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, 0, 96, 128);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'card.png', { type: 'image/png' });
    const input = document.querySelector('#scan-front-file');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const note = document.querySelector('#scan-stains p');
    return note && !document.querySelector('#scan-stains').hidden && note.textContent.includes('stain');
  }, null, { timeout: 5000 });
  const text = await page.evaluate(() => ({
    stains: document.querySelector('#scan-stains p').textContent,
    creases: document.querySelector('#scan-creases p').textContent,
    foil: document.querySelector('#scan-foil p').textContent,
    marks: document.querySelector('#scan-marks p').textContent,
    consistency: document.querySelector('#scan-consistency p').textContent,
    printq: document.querySelector('#scan-print p').textContent,
    range: document.querySelector('#scan-grade-range p').textContent,
    worth: document.querySelector('#scan-worth p').textContent,
    history: document.querySelector('#scan-history-delete').textContent,
  }));
  assert.match(text.stains, /stain/i);
  assert.match(text.creases, /crease|shading/i);
  assert.match(text.foil, /foil/i);
  assert.match(text.marks, /stamp/i);
  assert.match(text.consistency, /not compared|looks consistent|looks inconsistent/);
  assert.match(text.printq, /print-run verdict/);
  assert.match(text.range, /PSA \d+–\d+|Unavailable|Estimate unavailable/);
  assert.match(text.range, /No back photo/);
  assert.match(text.range, /Centering is not measured/);
  assert.match(text.worth, /Unavailable/);
  assert.doesNotMatch(`${text.consistency} ${text.range}`, /\breal\b|\bfake\b/i);
  assert.match(text.history, /Delete all scans on this phone/);
  await page.evaluate(() => document.querySelector('#scan-history-delete').click());
  await page.waitForFunction(() => document.querySelector('#scan-history p').textContent.includes('deleted'), null, { timeout: 5000 });
  const leaked = requests.filter((url) => /openai|ebay|frankfurter|googleapis/i.test(url));
  assert.deepEqual(leaked, []);
  } finally {
    await browser.close();
    server.close();
  }
});
