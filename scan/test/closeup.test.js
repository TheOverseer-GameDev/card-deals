/**
 * Close-ups after a gallery photo. Not a physical camera test.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { encodePNG } from './png.js';

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
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
    res.writeHead(200, { 'content-type': type });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function cardPNG() {
  const width = 480;
  const height = 640;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= 90 && x < 390 && y >= 80 && y < 560;
      const i = (y * width + x) * 4;
      rgba[i] = inside ? 190 : 16;
      rgba[i + 1] = inside ? 186 : 18;
      rgba[i + 2] = inside ? 176 : 22;
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(width, height, rgba);
}

test('a straightened photo shows eight front close-ups at 320px', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('nav button[data-v="scan"]').click();
  await page.locator('#scan-mode-front').evaluate((node) => node.click());
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#scan-gallery').click();
  await (await chooser).setFiles({ name: 'card.png', mimeType: 'image/png', buffer: cardPNG() });
  await page.locator('#scan-next').click();
  await page.waitForFunction(() => !document.getElementById('scan-edges').hidden && document.getElementById('scan-edges').querySelectorAll('canvas').length === 8);
  const text = await page.locator('#scan-edges').innerText();
  assert.match(text, /Corner and edge close-ups/);
  assert.match(text, /cannot guarantee a grade/);
  assert.equal(await page.locator('#scan-edges canvas').count(), 8);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.equal(overflow, true, 'close-ups overflow 320px');
  assert.deepEqual(errors, []);
  const angled = page.waitForEvent('filechooser');
  await page.locator('#scan-tilt-add').click();
  await (await angled).setFiles({ name: 'flat.png', mimeType: 'image/png', buffer: cardPNG() });
  const again = page.waitForEvent('filechooser');
  await page.locator('#scan-tilt-add').click();
  await (await again).setFiles({ name: 'flat-2.png', mimeType: 'image/png', buffer: cardPNG() });
  await page.waitForFunction(() => /same angle/.test(document.getElementById('scan-tilt-note').textContent));
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
});
