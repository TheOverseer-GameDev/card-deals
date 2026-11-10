/**
 * The border guides have to stay on the photo after it loads.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const type = file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.json') ? 'application/json'
          : 'text/html';
    res.writeHead(200, { 'content-type': type });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function cardFile() {
  const file = '/tmp/scan-guide-card.jpg';
  const proc = spawnSync('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x202018:s=640x880',
    '-vf', 'drawbox=x=80:y=80:w=480:h=720:color=white:t=fill',
    '-frames:v', '1', file,
  ]);
  if (proc.status !== 0) throw new Error('could not make a card photo');
  return file;
}

test('a loaded photo keeps eight border guides on the front and the back', async () => {
  const photo = cardFile();
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('nav button[data-v="scan"]').click();
  await page.locator('#scan-front-file').setInputFiles(photo);
  await page.waitForFunction(() => document.querySelectorAll('#scan-front-guides .scan-guide').length === 8);
  const front = await page.evaluate(() => [...document.querySelectorAll('#scan-front-guides .scan-guide')].map((el) => {
    const box = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label'), w: box.width, h: box.height };
  }));
  assert.equal(front.length, 8);
  for (const guide of front) {
    assert.ok(guide.label && guide.label.includes('border'), guide.label);
    assert.ok(guide.w >= 44 || guide.h >= 44, `${guide.label} ${guide.w}x${guide.h}`);
  }
  assert.match(await page.locator('#scan-auto-center').innerText(), /Measure centering yourself/);
  await page.locator('#scan-back-file').setInputFiles(photo);
  await page.waitForFunction(() => document.querySelectorAll('#scan-back-guides .scan-guide').length === 8);
  const back = await page.evaluate(() => [...document.querySelectorAll('#scan-back-guides .scan-guide')].map((el) => {
    const box = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label'), w: box.width, h: box.height };
  }));
  assert.equal(back.length, 8);
  for (const guide of back) {
    assert.ok(guide.w >= 44 || guide.h >= 44, `${guide.label} ${guide.w}x${guide.h}`);
  }
  assert.match(await page.locator('#scan-back-auto').innerText(), /Measure centering yourself/);
  await browser.close();
  server.close();
});
