/**
 * Fake-camera check for the live preview. Not a physical phone.
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

function typeFor(file) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-type': typeFor(file), 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function darkFeed(file) {
  const width = 640;
  const height = 480;
  const ySize = width * height;
  const cSize = (width / 2) * (height / 2);
  const parts = [Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let frame = 0; frame < 8; frame++) {
    const y = Buffer.alloc(ySize, 26);
    parts.push(Buffer.from('FRAME\n'), y, Buffer.alloc(cSize, 128), Buffer.alloc(cSize, 128));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

test('a dark fake camera shows the capture ring and does not fire the shutter', async () => {
  const feed = darkFeed('/tmp/scan-phase1/dark.y4m');
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${feed}`,
    ],
  });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.context().grantPermissions(['camera']);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('nav button[data-v="scan"]').click();
  await page.locator('#scan-front-cam').click();
  await page.waitForFunction(() => {
    const video = document.querySelector('#scan-cam-video');
    return video && video.videoWidth > 2 && !video.hidden;
  });
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    ring: !!document.getElementById('scan-capture-ring'),
    hint: document.getElementById('scan-align')?.textContent || '',
    reviewHidden: document.getElementById('scan-next')?.hidden,
    offset: document.querySelector('#scan-capture-ring circle')?.getAttribute('stroke-dashoffset'),
  }));
  assert.equal(state.ring, true);
  assert.match(state.hint, /Too dark|No card outline/);
  assert.equal(state.reviewHidden, true);
  assert.equal(state.offset, '100.53');
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
});
