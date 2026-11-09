/**
 * Headless Chrome phone journey. Not a hardware test and not a live purchase.
 * Requests stay on the local fixture server.
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
const LISTING = 'https://www.ebay.com/itm/157650931629';

function typeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('..')) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
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

function stripesPNG(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = (x % 2) ? 20 : 235;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(width, height, rgba);
}

const ocrMock = `
export async function createWorker() {
  return { async recognize() { return { data: { text: 'LON-000\\nGemini Elf' } }; }, terminate() {} };
}
export default { createWorker };
`;

function watch(page, base) {
  const hosts = new Set();
  page.on('request', (req) => hosts.add(new URL(req.url()).host));
  page.on('popup', (popup) => { throw new Error('unexpected popup ' + popup.url()); });
  return () => {
    const allowed = new URL(base).host;
    assert.deepEqual([...hosts], [allowed]);
  };
}

test('phone scan journey stays local and names the verified listing', async (t) => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await browser.close();
    server.close();
  });

  await t.test('real click, fake camera, gallery upload, exact listing, no external navigation', async () => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    });
    await context.grantPermissions(['camera']);
    const page = await context.newPage();
    const localOnly = watch(page, base);
    await page.route(/tesseract\.esm\.min\.js$/, (route) => route.fulfill({
      status: 200, contentType: 'text/javascript', body: ocrMock,
    }));
    await page.route(/worker\.min\.js$|tesseract-core|eng\.traineddata\.gz$/, (route) => route.abort());
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('html.scan-cam');
    await page.evaluate(() => {
      const note = document.createElement('div');
      note.id = 'freshness-note';
      note.className = 'banner';
      note.textContent = 'STALE NOTICE SHOULD NOT COVER THE CAMERA';
      document.querySelector('main').prepend(note);
    });
    const capture = await page.evaluate(() => ({
      note: getComputedStyle(document.getElementById('freshness-note')).display,
      panel: getComputedStyle(document.querySelector('.scan-panel')).display,
      fresh: document.getElementById('scan-freshness') ? getComputedStyle(document.getElementById('scan-freshness')).display : 'missing',
    }));
    assert.equal(capture.note, 'none');
    assert.equal(capture.panel, 'none');
    await page.locator('#scan-front-cam').click();
    await page.waitForFunction(() => {
      const video = document.querySelector('#scan-cam-video');
      return video && video.videoWidth > 0;
    });
    await page.locator('#scan-front-cam').click();
    await page.waitForFunction(() => (document.querySelector('#scan-front-note')?.textContent || '').includes('Working copy'));
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#scan-gallery').click();
    await (await chooser).setFiles({ name: 'front.png', mimeType: 'image/png', buffer: stripesPNG(900, 1200) });
    await page.waitForFunction(() => (document.querySelector('#scan-front-note')?.textContent || '').includes('Working copy'));
    await page.locator('#scan-next').click();
    await page.waitForSelector('#v-scan.scan-review .scan-panel');
    await page.locator('#scan-read').click();
    await page.waitForFunction(() => (document.querySelector('#scan-results')?.innerText || '').includes('Gemini Elf'));
    await page.locator('#scan-results button', { hasText: 'LON-000' }).click();
    await page.locator('#scan-asks summary').click();
    await page.waitForSelector('#scan-asks a');
    assert.equal(await page.locator('#scan-asks a').getAttribute('href'), LISTING);
    assert.equal(page.url().startsWith(base), true);
    assert.equal(context.pages().length, 1);
    localOnly();
    await context.close();
  });

  await t.test('desktop-site visual viewport keeps controls inside and the notice off the camera', async () => {
    const context = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const localOnly = watch(page, base);
    await page.goto(base + '/');
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    await page.evaluate(() => {
      const note = document.createElement('div');
      note.id = 'freshness-note';
      note.textContent = 'STALE NOTICE SHOULD NOT COVER THE CAMERA';
      document.body.append(note);
    });
    const fit = await page.evaluate(() => {
      const v = visualViewport;
      const ids = ['scan-front-cam', 'scan-gallery', 'scan-camera'];
      const controls = {};
      for (const id of ids) {
        const r = document.getElementById(id).getBoundingClientRect();
        controls[id] = r.width > 0 && r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1 && r.left >= v.offsetLeft - 1 && r.right <= v.offsetLeft + v.width + 1;
      }
      return {
        controls,
        scale: v.scale,
        width: v.width,
        note: getComputedStyle(document.getElementById('freshness-note')).display,
        panel: getComputedStyle(document.querySelector('.scan-panel')).display,
      };
    });
    assert.ok(fit.scale > 2, JSON.stringify(fit));
    assert.ok(fit.width < 420, JSON.stringify(fit));
    for (const id of Object.keys(fit.controls)) assert.equal(fit.controls[id], true, id);
    assert.equal(fit.note, 'none');
    assert.equal(fit.panel, 'none');
    await page.mouse.wheel(0, 400);
    const still = await page.evaluate(() => {
      const v = visualViewport;
      const r = document.getElementById('scan-front-cam').getBoundingClientRect();
      return r.bottom <= v.offsetTop + v.height + 1 && r.top >= v.offsetTop - 1;
    });
    assert.equal(still, true);
    localOnly();
    await context.close();
  });
});
