/**
 * The intro is one short original beat per launch.
 * Sound waits for a tap, the mute choice sticks, and reduced motion is a fade.
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

test('intro source is original and local', () => {
  const src = fs.readFileSync(path.join(root, 'intro.js'), 'utf8');
  assert.equal(src.includes('fetch('), false);
  assert.doesNotMatch(src, /Yu-Gi-Oh|Pokemon|Pokémon|Konami|Wizards|Deckmaster/i);
  assert.match(src, /AudioContext/);
  assert.match(src, /Card Deals/);
});

test('the intro ends within 2.2s, can be skipped, and does not block the scanner', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro');
    const ready = await page.evaluate(() => ({
      scan: !!document.getElementById('v-scan'),
      audio: window.__intro.audio,
    }));
    assert.equal(ready.scan, true);
    assert.equal(ready.audio, false);
    await page.locator('#intro-skip').click();
    await page.waitForSelector('#app-intro', { state: 'detached' });
    const again = await page.locator('#app-intro').count();
    assert.equal(again, 0);
  } finally {
    await browser.close();
    server.close();
  }
});

test('an untouched intro is gone within 2.2s', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro.is-run');
    await page.waitForFunction(() => window.__intro && window.__intro.ended, null, { timeout: 3000 });
    const elapsed = await page.evaluate(() => window.__intro.ended);
    assert.ok(elapsed < 2200, `intro lasted ${elapsed}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test('sound off is remembered and the sting stays silent', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#intro-skip').click();
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').textContent(), 'Sound off');
    await page.reload();
    await page.waitForSelector('#app-intro');
    assert.equal(await page.locator('#sound').textContent(), 'Sound off');
    assert.equal(await page.evaluate(() => localStorage.getItem('cd-sound')), 'off');
    await page.locator('#app-intro').click();
    assert.equal(await page.evaluate(() => window.__intro.audio), false);
  } finally {
    await browser.close();
    server.close();
  }
});

test('reduced motion is a fade without the flip', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro.is-reduced.is-run');
    const motion = await page.evaluate(() => ({
      reduced: window.__intro.reduced,
      card: getComputedStyle(document.querySelector('.intro-card')).animationName,
    }));
    assert.equal(motion.reduced, true);
    assert.equal(motion.card, 'none');
    await page.waitForFunction(() => window.__intro.ended, null, { timeout: 2000 });
    assert.ok(await page.evaluate(() => window.__intro.ended) < 1200);
  } finally {
    await browser.close();
    server.close();
  }
});
