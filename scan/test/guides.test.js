/**
 * The border guides have to stay on the photo after it loads, and a drag has to move them.
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
const chrome = [process.env.CHROME_PATH, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((item) => item && fs.existsSync(item));

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
          : file.endsWith('.png') ? 'image/png'
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

async function touchDrag(page, box, dx) {
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(90, box.height * 0.25);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 4; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * step) / 4, y, id: 1 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

function guideScript(selector) {
  return [...document.querySelectorAll(selector)].map((el) => {
    const box = el.getBoundingClientRect();
    return {
      label: el.getAttribute('aria-label'),
      w: box.width,
      h: box.height,
      left: box.left,
      top: box.top,
      value: Number(el.getAttribute('aria-valuenow')),
    };
  });
}

test('a loaded photo keeps eight border guides on the front and the back', async () => {
  const photo = cardFile();
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-front-file').setInputFiles(photo);
    await page.waitForFunction(() => {
      const stage = document.querySelector('#scan-stage canvas');
      const host = document.querySelector('#scan-front-guides');
      return stage && host && host.dataset.w && document.querySelectorAll('#scan-front-guides .scan-guide').length === 8;
    });
    const front = await page.evaluate(guideScript, '#scan-front-guides .scan-guide');
    assert.equal(front.length, 8);
    const values = front.map((guide) => guide.value).sort((a, b) => a - b);
    assert.ok(values[0] >= 22, `outer guide collapsed to ${values.join(',')}`);
    assert.ok(new Set(values).size >= 6, `guides stacked at ${values.join(',')}`);
    for (const guide of front) {
      assert.ok(guide.label && guide.label.includes('border'), guide.label);
      assert.ok(guide.w >= 44 || guide.h >= 44, `${guide.label} ${guide.w}x${guide.h}`);
    }
    assert.match(await page.locator('#scan-auto-center').innerText(), /Measure centering yourself/);
    assert.match(await page.locator('.scan-manual-note').first().innerText(), /move the guides/);
    assert.doesNotMatch(await page.locator('.scan-manual-note').first().innerText(), /\d+\.\d+\/\d+\.\d+/);
    const before = front.find((guide) => guide.label === 'Inner left border');
    const box = await page.locator('#scan-front-guides .scan-guide[aria-label="Inner left border"]').boundingBox();
    assert.ok(box, 'inner left guide has a box');
    await touchDrag(page, box, 48);
    await page.waitForFunction((start) => {
      const el = document.querySelector('#scan-front-guides .scan-guide[aria-label="Inner left border"]');
      return el && Number(el.getAttribute('aria-valuenow')) !== start;
    }, before.value);
    const moved = await page.locator('#scan-front-guides .scan-guide[aria-label="Inner left border"]').getAttribute('aria-valuenow');
    assert.notEqual(Number(moved), before.value);
    assert.match(await page.locator('.scan-manual-note').first().innerText(), /Measured by you/);

    await page.locator('#scan-back-file').setInputFiles(photo);
    await page.waitForFunction(() => {
      const host = document.querySelector('#scan-back-guides');
      return host && host.dataset.w && document.querySelectorAll('#scan-back-guides .scan-guide').length === 8;
    });
    const back = await page.evaluate(guideScript, '#scan-back-guides .scan-guide');
    assert.equal(back.length, 8);
    const backValues = back.map((guide) => guide.value);
    assert.ok(Math.min(...backValues) >= 22, `back guides collapsed to ${backValues.join(',')}`);
    for (const guide of back) {
      assert.ok(guide.w >= 44 || guide.h >= 44, `${guide.label} ${guide.w}x${guide.h}`);
    }
    assert.match(await page.locator('#scan-back-auto').innerText(), /Measure centering yourself/);
    const backBox = await page.locator('#scan-back-guides .scan-guide[aria-label="Inner right border"]').boundingBox();
    assert.ok(backBox, 'back guide has a box');
    const backStart = Number(await page.locator('#scan-back-guides .scan-guide[aria-label="Inner right border"]').getAttribute('aria-valuenow'));
    await touchDrag(page, backBox, -48);
    await page.waitForFunction((start) => {
      const el = document.querySelector('#scan-back-guides .scan-guide[aria-label="Inner right border"]');
      return el && Number(el.getAttribute('aria-valuenow')) !== start;
    }, backStart);
    assert.notEqual(
      Number(await page.locator('#scan-back-guides .scan-guide[aria-label="Inner right border"]').getAttribute('aria-valuenow')),
      backStart,
    );
  } finally {
    await browser.close();
    server.close();
  }
});
