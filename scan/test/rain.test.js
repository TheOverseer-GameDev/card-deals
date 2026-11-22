/**
 * The card-back rain is three columns, logo-free, local, and quiet
 * when motion is reduced or the camera is open.
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

test('the rain source draws backs in code and names no trademark', () => {
  const src = fs.readFileSync(path.join(root, 'rain.js'), 'utf8');
  assert.equal(src.includes('fillText'), false);
  assert.doesNotMatch(src, /Yu-Gi-Oh|Deckmaster|Konami|Wizards|Pokemon|Pokémon|Poké|Gundam|Digimon|Lorcana|Weiss/i);
  assert.equal((src.match(/function /g) || []).length > 0, true);
});

test('three columns run opposite in the middle and a wrapped card changes back', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  const hosts = new Set();
  page.on('request', (req) => hosts.add(new URL(req.url()).host));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#card-rain');
    const motion = await page.evaluate(() => {
      const rain = document.getElementById('card-rain').rain;
      const speeds = rain.columns.map((column) => column.speed);
      const side = rain.columns[1].cards.every((item, index) => item.back !== rain.columns[0].cards[index].back);
      const card = rain.columns[0].cards[0];
      const before = card.back;
      card.y = -200;
      rain.tick(16);
      const adjacent = rain.columns[0].cards.every((item, index, list) => item.back !== list[(index + 1) % list.length].back);
      return {
        count: rain.columns.length,
        backs: rain.backs,
        speeds,
        changed: card.back !== before,
        adjacent,
        side,
        state: document.getElementById('card-rain').dataset.state,
      };
    });
    assert.equal(motion.count, 3);
    assert.ok(motion.backs >= 30);
    assert.ok(motion.speeds[0] < 0 && motion.speeds[2] < 0);
    assert.ok(motion.speeds[1] > 0);
    assert.equal(motion.changed, true);
    assert.equal(motion.adjacent, true);
    assert.equal(motion.side, true);
    assert.equal(motion.state, 'run');
    assert.deepEqual([...hosts], [new URL(page.url()).host]);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('html.scan-cam');
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('card-rain')).visibility);
    assert.equal(hidden, 'hidden');
  } finally {
    await browser.close();
    server.close();
  }
});

test('reduced motion keeps the rain still', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#card-rain');
    const first = await page.evaluate(() => document.getElementById('card-rain').dataset.frames);
    await page.waitForTimeout(250);
    const later = await page.evaluate(() => ({
      frames: document.getElementById('card-rain').dataset.frames,
      state: document.getElementById('card-rain').dataset.state,
    }));
    assert.equal(later.state, 'static');
    assert.equal(later.frames, first);
  } finally {
    await browser.close();
    server.close();
  }
});
