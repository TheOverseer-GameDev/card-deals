import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { encodePNG } from './png.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));
const shots = '/tmp/scan-shots';
const MARKER = 'SCANLEAK9f3a2c';
const state = { sw: 'real' };

function typeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.md')) return 'text/plain; charset=utf-8';
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
    res.setHeader('cache-control', 'no-store');
    if (pathname === '/sw.js' && state.sw === 'old') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(root, 'scan/test/fixtures/sw-old.js')));
      return;
    }
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-type': typeFor(file) });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
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
  return Buffer.concat([encodePNG(width, height, rgba), Buffer.from(MARKER)]);
}

const ocrMock = `
export async function createWorker() {
  return {
    async recognize() {
      if (globalThis.__ocrHang) return new Promise(() => {});
      return { data: { text: globalThis.__ocrText || 'LON-000\\nGemini Elf' } };
    },
    terminate() {}
  };
}
export default { createWorker };
`;

async function launch() {
  return chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

test('browser scan flows', { timeout: 180000 }, async (t) => {
  assert.ok(chrome, 'system Chrome is required');
  fs.mkdirSync(shots, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('desktop layout, uncertain read, prices, bad files, and no upload', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const requests = [];
    page.on('request', (req) => requests.push(req));
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.route(/tesseract\.esm\.min\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: ocrMock,
    }));
    let heavy = 0;
    await page.route(/worker\.min\.js$/, (route) => { heavy += 1; return route.abort(); });
    await page.route(/tesseract-core/, (route) => { heavy += 1; return route.abort(); });
    await page.route(/eng\.traineddata\.gz$/, (route) => { heavy += 1; return route.abort(); });
    await page.goto(base + '/');
    assert.equal(await page.locator('html').getAttribute('class'), 'desktop');
    const listCount = await page.locator('#v-ygo .c').count();
    assert.ok(listCount >= 1);
    await page.locator('#v-ygo .c').first().click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('#panel');
      return panel && !panel.innerText.startsWith('Select a card');
    });
    await page.locator('#q').fill('gemini');
    await page.waitForFunction(() => document.querySelector('#v-ygo').innerText.includes('Gemini Elf'));
    await page.locator('#q').fill('');
    assert.equal(await page.locator('#v-ygo .c').count(), listCount);
    assert.equal(requests.some((req) => req.url().includes('/scan/ocr.js')), false);
    assert.equal(requests.some((req) => req.url().includes('tesseract')), false);

    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    assert.equal(await page.locator('#scan-read').isEnabled(), false);
    await page.locator('#scan-front-file').setInputFiles({
      name: 'front.png',
      mimeType: 'image/png',
      buffer: stripesPNG(900, 1200),
    });
    await page.waitForFunction(() => document.querySelector('#scan-front-note')?.textContent?.includes('Working copy'));
    await page.waitForFunction(() => document.querySelector('#scan-front-quality')?.textContent?.includes('Resolution:'));
    const quality = await page.locator('#scan-front-quality').innerText();
    assert.match(quality, /Blur was not flagged/);
    assert.match(quality, /Centering:/);
    assert.match(await page.locator('#scan-suggest-note').innerText(), /No tighter crop/);
    await page.locator('#scan-zoom').evaluate((el) => {
      el.value = '2';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.match(await page.locator('#scan-stage').getAttribute('style'), /scale\(2\)/);

    await page.locator('#scan-read').click();
    await page.waitForFunction(() => document.querySelector('#scan-results')?.innerText?.includes('Gemini Elf'));
    assert.match(await page.locator('#scan-progress').innerText(), /Text read on this device/);
    assert.match(await page.locator('#scan-prices').innerText(), /Confirm a catalog row/);
    assert.equal(heavy, 0);
    assert.equal(requests.some((req) => req.url().includes('/scan/ocr.js')), true);
    await page.locator('#scan-results button', { hasText: 'LON-000' }).click();
    await page.waitForFunction(() => document.querySelector('#scan-prices')?.innerText?.includes('$79.10'));
    const prices = await page.locator('#scan-prices').innerText();
    assert.match(prices, /1 sale per week/);
    assert.match(prices, /not a sales count/);
    assert.doesNotMatch(prices, /C\$/);
    assert.doesNotMatch(prices, /odds/i);
    const psa5 = await page.evaluate(() => [...document.querySelectorAll('#scan-prices tr')]
      .filter((row) => row.cells[0]?.textContent === 'PSA 5')
      .map((row) => row.cells[1].textContent));
    assert.deepEqual(psa5, ['Unavailable']);
    const sales = await page.evaluate(() => [...document.querySelectorAll('#scan-prices tbody tr')]
      .map((row) => row.cells[5]?.textContent));
    assert.ok(sales.length > 0);
    assert.ok(sales.every((value) => value === 'Unavailable'));
    await page.locator('#scan-prices').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'desktop-prices.png') });

    await page.locator('#scan-clear').click();
    await page.locator('#scan-search').fill('Black Lotus');
    await page.waitForFunction(() => document.querySelectorAll('#scan-results button').length > 1);
    assert.match(await page.locator('#scan-prices').innerText(), /Confirm a catalog row/);
    await page.locator('#scan-text').fill('zzzz qqqq');
    await page.locator('#scan-rematch').click();
    assert.match(await page.locator('#scan-results').innerText(), /No loaded row matched/);
    await page.locator('#scan-text').fill('LON-000');
    await page.locator('#scan-rematch').click();
    assert.match(await page.locator('#scan-results').innerText(), /Gemini Elf/);
    assert.match(await page.locator('#scan-prices').innerText(), /Confirm a catalog row/);

    await page.evaluate(() => { globalThis.__ocrText = '<img src=x onerror="window.__xss=1">'; });
    await page.locator('#scan-read').click();
    await page.waitForFunction(() => (document.querySelector('#scan-text')?.value || '').includes('onerror'));
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('#v-scan img').count(), 0);
    assert.equal((await page.locator('#v-scan').innerHTML()).includes('onerror'), false);

    await page.evaluate(() => { globalThis.__ocrHang = true; });
    await page.locator('#scan-read').click();
    await page.waitForSelector('#scan-cancel:not([hidden])');
    await page.locator('#scan-cancel').click();
    await page.waitForFunction(() => document.querySelector('#scan-progress')?.textContent?.includes('Cancelled'));
    await page.evaluate(() => { globalThis.__ocrHang = false; globalThis.__ocrText = ''; });

    await page.locator('#scan-search').fill('Braingeyser');
    await page.locator('#scan-results button', { hasText: 'Braingeyser' }).click();
    await page.waitForFunction(() => document.querySelector('#scan-prices')?.innerText?.includes('PSA 10'));
    const psa10 = await page.evaluate(() => [...document.querySelectorAll('#scan-prices tr')]
      .filter((row) => row.cells[0]?.textContent === 'PSA 10')
      .map((row) => row.cells[1].textContent));
    assert.deepEqual(psa10, ['Unavailable']);

    await page.locator('#scan-front-file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await page.waitForFunction(() => document.querySelector('#scan-front-note')?.textContent?.includes('not a JPEG'));
    await page.locator('#scan-front-file').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    });
    await page.waitForFunction(() => document.querySelector('#scan-front-note')?.textContent?.includes('could not be read'));
    const heic = Buffer.alloc(20);
    heic.write('ftyp', 4, 'ascii');
    heic.write('heic', 8, 'ascii');
    await page.locator('#scan-front-file').setInputFiles({
      name: 'card.heic',
      mimeType: 'image/heic',
      buffer: heic,
    });
    await page.waitForFunction(() => document.querySelector('#scan-front-note')?.textContent?.includes('HEIC'));
    await page.locator('#scan-front-file').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 1),
    });
    await page.waitForFunction(() => document.querySelector('#scan-front-note')?.textContent?.includes('over 8 MB'));
    assert.equal(await page.locator('#scan-read').isEnabled(), true);

    const methods = requests.map((req) => req.method());
    assert.ok(methods.every((method) => method === 'GET'));
    const hosts = [...new Set(requests.map((req) => new URL(req.url()).host))];
    assert.deepEqual(hosts, [new URL(base).host]);
    const bodies = requests.map((req) => req.postData() || '').join('\n');
    assert.equal(bodies.includes(MARKER), false);
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    assert.equal(stored.includes(MARKER), false);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) urls.push(req.url);
      }
      return urls;
    });
    assert.ok(cached.every((url) => !url.startsWith('blob:')));
    await page.locator('#scan-close').click();
    assert.equal(await page.locator('#v-ygo .c').count(), listCount);
    assert.equal(await page.locator('#scan-cond-corners').inputValue(), 'unset');
    assert.equal(await page.locator('#scan-cond-edges').inputValue(), 'unset');
    assert.equal(await page.locator('#scan-cond-surface').inputValue(), 'unset');
    assert.match(await page.locator('#v-scan').evaluate((el) => el.textContent), /does not produce a PSA grade/);
    await context.close();
  });

  await t.test('phone layout keeps the lists and opens scan', async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.goto(base + '/');
    assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('phone')), true);
    assert.equal(await page.locator('nav').evaluate((el) => getComputedStyle(el).position), 'fixed');
    const before = await page.locator('#v-ygo .c').count();
    assert.ok(before >= 1);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    await page.screenshot({ path: path.join(shots, 'phone-scan.png') });
    await page.locator('#scan-close').click();
    assert.equal(await page.locator('#v-ygo .c').count(), before);
    await context.close();
  });

  await t.test('phone and PC toggle still reloads the saved view', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(base + '/');
    assert.equal(await page.locator('html').getAttribute('class'), 'desktop');
    await page.locator('#vt').click();
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.locator('html').getAttribute('class'), 'phone');
    await context.close();
  });

  await t.test('camera permission denied still allows upload', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
        },
      });
    });
    const page = await context.newPage();
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-front-cam').click();
    await page.waitForFunction(() => document.querySelector('#scan-cam-msg')?.textContent?.includes('Camera permission was denied'));
    assert.equal(await page.locator('#scan-cam-retry').isVisible(), true);
    assert.equal(await page.locator('#scan-gallery').isVisible(), true);
    assert.equal(await page.locator('#scan-front-file').isEnabled(), true);
    await page.screenshot({ path: path.join(shots, 'camera-denied.png') });
    await context.close();
  });

  await t.test('missing camera API still allows upload', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get() { return undefined; } });
    });
    const page = await context.newPage();
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-front-cam').click();
    await page.waitForFunction(() => document.querySelector('#scan-cam-msg')?.textContent?.includes('no camera API'));
    assert.equal(await page.locator('#scan-back-file').isEnabled(), true);
    await context.close();
  });

  await t.test('offline reload still opens scan and shows stored prices', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(base + '/');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
    await page.waitForSelector('nav button[data-v="scan"]');
    await context.setOffline(true);
    await page.reload();
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-search').fill('Gemini Elf');
    await page.locator('#scan-results button', { hasText: 'LON-000' }).click();
    await page.waitForFunction(() => document.querySelector('#scan-prices')?.innerText?.includes('$79.10'));
    const offlinePrices = await page.locator('#scan-prices').innerText();
    assert.match(offlinePrices, /PSA 5/);
    assert.match(offlinePrices, /Unavailable/);
    await context.close();
  });

  await t.test('a newer service worker drops the previous cache', async () => {
    state.sw = 'old';
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.goto(base + '/');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
    await page.waitForFunction(async () => (await caches.keys()).includes('cd3-oldworker'));
    state.sw = 'real';
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    const cacheName = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const C='([^']+)'/)[1];
    await page.waitForFunction(async (name) => {
      const keys = await caches.keys();
      return keys.includes(name) && !keys.includes('cd3-oldworker');
    }, cacheName, { timeout: 20000 });
    state.sw = 'real';
    await context.close();
  });

  await t.test('scanner v2 capture, retake, and empty market', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    assert.equal(await page.locator('#scan-outline').count(), 1);
    assert.equal(await page.locator('#scan-gallery').count(), 1);
    assert.equal(await page.locator('#scan-front-cam').count(), 1);
    await page.locator('#scan-mode-both').click();
    assert.match(await page.locator('#scan-step').innerText(), /Step 1 of 2/);
    await page.locator('#scan-mode-front').click();
    assert.match(await page.locator('#scan-step').innerText(), /Front only/);
    await page.locator('#scan-info-btn').click();
    assert.match(await page.locator('#v-scan').innerText(), /Photos stay on this device/);
    assert.match(await page.locator('#scan-s22').innerText(), /1×/);
    await page.locator('#scan-info-close').click();
    const width = 400;
    const height = 560;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const hot = x < 40 && y < 56;
        const v = hot ? 255 : ((x + y) % 2 ? 30 : 90);
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    await page.locator('#scan-front-file').setInputFiles({
      name: 'glare.png',
      mimeType: 'image/png',
      buffer: encodePNG(width, height, rgba),
    });
    await page.waitForFunction(() => document.querySelector('#scan-retakes')?.innerText?.includes('top-left corner'));
    const retake = await page.locator('#scan-retakes').innerText();
    assert.match(retake, /Front top-left corner/);
    assert.match(retake, /specular glare/);
    assert.match(retake, /Why:/);
    const psa = await page.locator('#scan-psa').innerText();
    assert.match(psa, /not a PSA certification/);
    assert.doesNotMatch(psa, /confidence/i);
    assert.match(psa, /cannot verify authenticity or alterations/);
    await page.locator('#scan-search').fill('Gemini Elf');
    await page.locator('#scan-results button', { hasText: 'LON-000' }).click();
    await page.waitForFunction(() => document.querySelector('#scan-sold')?.innerText?.includes('Completed sales'));
    const sold = await page.locator('#scan-sold').innerText();
    const asks = await page.locator('#scan-asks').innerText();
    assert.match(sold, /Completed sales/);
    assert.match(sold, /\$65\.80/);
    assert.doesNotMatch(sold, /95\.81/);
    assert.match(asks, /Asking prices/);
    assert.match(asks, /95\.81 CAD/);
    assert.doesNotMatch(asks, /\$65\.80/);
    assert.match(await page.locator('#scan-chart-note').innerText(), /No sourced sales in this period/);
    assert.match(await page.locator('#scan-gauges').innerText(), /Future potential is scenario-based, not a promise/);
    assert.match(await page.locator('#scan-gauges').innerText(), /Unavailable/);
    assert.doesNotMatch(await page.locator('#scan-prices').innerText(), /C\$/);
    await page.screenshot({ path: path.join(shots, 'scanner-v2-desktop.png') });
    await context.close();

    const narrow = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    await narrow.addInitScript(() => localStorage.setItem('view', 'desktop'));
    const phone = await narrow.newPage();
    await phone.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await phone.goto(base + '/');
    assert.equal(await phone.locator('html').getAttribute('class'), 'desktop');
    await phone.locator('nav button[data-v="scan"]').click();
    await phone.waitForSelector('#v-scan.on');
    const outline = await phone.locator('#scan-outline').boundingBox();
    const shutter = await phone.locator('#scan-front-cam').boundingBox();
    assert.ok(outline && outline.width >= 80);
    assert.ok(shutter && shutter.width >= 44 && shutter.height >= 44);
    await phone.screenshot({ path: path.join(shots, 'scanner-v2-desktop-site-phone.png') });
    await narrow.close();
  });

  await t.test('phone capture fits the first viewport and keeps a camera picker', async () => {
    async function check(width, height, desktopSite) {
      const context = await browser.newContext({
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        isMobile: !desktopSite,
        hasTouch: true,
        serviceWorkers: 'block',
      });
      if (desktopSite) await context.addInitScript(() => localStorage.setItem('view', 'desktop'));
      const page = await context.newPage();
      await page.route(/\/sw\.js$/, (route) => route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'self.addEventListener("install", () => self.skipWaiting());',
      }));
      await page.addInitScript(() => {
        const track = { getCapabilities: () => ({ zoom: { min: 1, max: 4 } }), applyConstraints: async () => {}, stop() {} };
        const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
        const devices = {
          getUserMedia: async () => stream,
          enumerateDevices: async () => [
            { kind: 'videoinput', deviceId: 'rear-main', label: 'Back camera' },
            { kind: 'videoinput', deviceId: 'front-cam', label: 'Front camera' },
          ],
        };
        try {
          Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
        } catch {
          navigator.mediaDevices.getUserMedia = devices.getUserMedia;
          navigator.mediaDevices.enumerateDevices = devices.enumerateDevices;
        }
      });
      await page.goto(base + '/');
      await page.locator('nav button[data-v="scan"]').click();
      await page.waitForSelector('#v-scan.on');
      await page.waitForFunction(() => {
        const video = document.querySelector('#scan-cam-video');
        const shutter = document.querySelector('#scan-front-cam');
        const picker = document.querySelector('#scan-camera');
        const shell = document.querySelector('#v-scan');
        if (!video || video.hidden || !shutter || !picker || !shell) return false;
        const vv = window.visualViewport;
        const top = vv.offsetTop;
        const bottom = vv.offsetTop + vv.height;
        const v = video.getBoundingClientRect();
        const s = shutter.getBoundingClientRect();
        const p = picker.getBoundingClientRect();
        const box = shell.getBoundingClientRect();
        const y = window.scrollY;
        window.scrollTo(0, 99999);
        const stuck = Math.abs(window.scrollY - y) < 2;
        window.scrollTo(0, y);
        return document.documentElement.classList.contains('scan-cam')
          && box.top <= top + 2 && box.bottom >= bottom - 2
          && v.height > 120 && s.width >= 44
          && s.top >= top - 1 && s.bottom <= bottom + 1
          && p.top >= top - 1 && p.bottom <= bottom + 1
          && stuck;
      });
      await page.waitForFunction(() => [...document.querySelector('#scan-camera').options].some((option) => option.value === 'device:rear-main'));
      const saved = await page.evaluate(() => {
        const picker = document.querySelector('#scan-camera');
        picker.value = 'device:rear-main';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        return localStorage.getItem('card-scan-camera');
      });
      assert.equal(saved, 'device:rear-main');
      await page.screenshot({ path: path.join(shots, `fit-${width}x${height}${desktopSite ? '-desktop-site' : ''}.png`) });
      await context.close();
    }
    await check(360, 780, false);
    await check(360, 800, false);
    await check(360, 780, true);
    await check(360, 800, true);
  });

  await t.test('S22 desktop-site layout viewport still opens a camera shell', async () => {
    const context = await browser.newContext({
      viewport: { width: 980, height: 700 },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.625,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.route(/\/sw\.js$/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'self.addEventListener("install", () => self.skipWaiting());',
    }));
    await page.addInitScript(() => {
      localStorage.setItem('view', 'desktop');
      const track = { getCapabilities: () => ({}), applyConstraints: async () => {}, stop() {} };
      const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
      const devices = { getUserMedia: async () => stream, enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'rear', label: 'Rear' }] };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices }); }
      catch { navigator.mediaDevices.getUserMedia = devices.getUserMedia; navigator.mediaDevices.enumerateDevices = devices.enumerateDevices; }
    });
    await page.goto(base + '/');
    await page.waitForSelector('#v-ygo .c');
    const before = await page.evaluate(() => {
      const scroller = document.scrollingElement;
      scroller.scrollTop = scroller.scrollHeight;
      return {
        scrolled: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        narrowCss: matchMedia('(max-width: 840px)').matches,
        coarse: matchMedia('(pointer: coarse)').matches,
        layout: window.innerWidth,
      };
    });
    assert.equal(before.narrowCss, false, `layout ${before.layout} still matches the old 840px camera rule`);
    assert.equal(before.coarse, true);
    assert.ok(before.scrolled > 40, `list did not scroll: ${JSON.stringify(before)}`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForFunction(() => {
      const shell = document.querySelector('#v-scan');
      const shutter = document.querySelector('#scan-front-cam');
      const gallery = document.querySelector('#scan-gallery');
      const picker = document.querySelector('#scan-camera');
      const vv = window.visualViewport;
      if (!shell || !shutter || !gallery || !picker) return false;
      if (!document.documentElement.classList.contains('scan-cam')) return false;
      const box = shell.getBoundingClientRect();
      const s = shutter.getBoundingClientRect();
      const hit = document.elementFromPoint(vv.width / 2, 40);
      return box.top <= vv.offsetTop + 2 && box.height >= vv.height - 2 && box.width >= vv.width - 2
        && s.bottom <= vv.offsetTop + vv.height + 1 && s.width >= 44
        && gallery.getBoundingClientRect().bottom <= vv.offsetTop + vv.height + 1
        && picker.getBoundingClientRect().top >= vv.offsetTop - 1
        && hit && hit.closest('#v-scan');
    });
    await page.setViewportSize({ width: 980, height: 520 });
    await page.waitForFunction(() => {
      const box = document.querySelector('#v-scan').getBoundingClientRect();
      return Math.abs(box.height - window.visualViewport.height) < 3;
    });
    await page.screenshot({ path: path.join(shots, 's22-desktop-site-980.png') });
    await context.close();
  });

  await t.test('page scale 2.72 keeps a real Scan click inside the visual viewport', async () => {
    const measure = () => {
      const v = visualViewport;
      const ids = ['scan-front-cam', 'scan-gallery', 'scan-camera', 'scan-next'];
      const controls = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        controls[id] = {
          top: r.top, bottom: r.bottom, left: r.left, right: r.right,
          inside: r.width > 0 && r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1 && r.left >= v.offsetLeft - 1 && r.right <= v.offsetLeft + v.width + 1,
        };
      }
      return { innerWidth, vv: { width: v.width, height: v.height, scale: v.scale, offsetTop: v.offsetTop, offsetLeft: v.offsetLeft }, media840: matchMedia('(max-width: 840px)').matches, controls };
    };
    state.sw = 'old';
    const context = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const track = { getCapabilities: () => ({}), applyConstraints: async () => {}, stop() {} };
      const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
      const devices = { getUserMedia: async () => stream, enumerateDevices: async () => [] };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices }); }
      catch { navigator.mediaDevices.getUserMedia = devices.getUserMedia; }
    });
    await page.goto(base + '/');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
    state.sw = 'real';
    const cacheName = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const C='([^']+)'/)[1];
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForFunction(async (name) => (await caches.keys()).includes(name), cacheName);
    await page.reload();
    await page.waitForSelector('nav button[data-v="scan"]');
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    const fit = await page.evaluate(measure);
    assert.equal(fit.media840, false);
    assert.ok(fit.vv.scale > 2, JSON.stringify(fit.vv));
    assert.ok(fit.vv.width < 420, JSON.stringify(fit.vv));
    for (const id of Object.keys(fit.controls)) assert.equal(fit.controls[id].inside, true, `${id} ${JSON.stringify(fit.controls[id])}`);
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, 'visual-viewport-scale.png'), Buffer.from(shot.data, 'base64'));
    await page.mouse.wheel(0, 400);
    const wheeled = await page.evaluate(measure);
    for (const id of Object.keys(wheeled.controls)) assert.equal(wheeled.controls[id].inside, true, `wheel ${id}`);
    await page.setViewportSize({ width: 980, height: Math.round(2178 * 0.85) });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const bars = await page.evaluate(measure);
    for (const id of Object.keys(bars.controls)) assert.equal(bars.controls[id].inside, true, `bars ${id} ${JSON.stringify(bars)}`);
    await page.setViewportSize({ width: 2178, height: 980 });
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2178 / 800 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const turned = await page.evaluate(measure);
    for (const id of Object.keys(turned.controls)) assert.equal(turned.controls[id].inside, true, `rotate ${id} ${JSON.stringify(turned)}`);
    state.sw = 'real';
    await context.close();
  });

  await t.test('landscape and a short PC window keep shutter and gallery inside', async () => {
    const inside = () => {
      const v = visualViewport;
      const ids = ['scan-front-cam', 'scan-gallery', 'scan-camera'];
      const controls = {};
      for (const id of ids) {
        const r = document.getElementById(id).getBoundingClientRect();
        controls[id] = { ok: r.width >= 44 && r.height >= 32 && r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1 && r.left >= v.offsetLeft - 1 && r.right <= v.offsetLeft + v.width + 1, t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) };
      }
      return { controls, tight: document.documentElement.classList.contains('scan-tight'), h: v.height, w: v.width, z: getComputedStyle(document.documentElement).zoom, shell: document.getElementById('v-scan').getBoundingClientRect().height };
    };
    const land = await browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const landPage = await land.newPage();
    await landPage.addInitScript(() => {
      const track = { stop() {}, getCapabilities: () => ({}), applyConstraints: async () => {} };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream, enumerateDevices: async () => [] } }); } catch { /* native */ }
    });
    await landPage.goto(base + '/');
    await landPage.locator('nav button[data-v="scan"]').click();
    const landFit = await landPage.evaluate(inside);
    assert.equal(landFit.controls['scan-front-cam'].ok, true, JSON.stringify(landFit));
    assert.equal(landFit.controls['scan-gallery'].ok, true, JSON.stringify(landFit));
    await land.close();

    const pc = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const pcPage = await pc.newPage();
    await pcPage.addInitScript(() => {
      const track = { stop() {}, getCapabilities: () => ({}), applyConstraints: async () => {} };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream, enumerateDevices: async () => [] } }); } catch { /* native */ }
    });
    await pcPage.goto(base + '/');
    await pcPage.locator('nav button[data-v="scan"]').click();
    await pcPage.setViewportSize({ width: 1440, height: 765 });
    await pcPage.evaluate(() => window.dispatchEvent(new Event('resize')));
    const pcFit = await pcPage.evaluate(inside);
    assert.equal(pcFit.controls['scan-camera'].ok, true, JSON.stringify(pcFit));
    assert.equal(pcFit.controls['scan-front-cam'].ok, true, JSON.stringify(pcFit));
    assert.equal(pcFit.controls['scan-gallery'].ok, true, JSON.stringify(pcFit));
    await pc.close();

    const extreme = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    const ex = await extreme.newPage();
    await ex.addInitScript(() => {
      const track = { stop() {}, getCapabilities: () => ({}), applyConstraints: async () => {} };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream, enumerateDevices: async () => [] } }); } catch { /* native */ }
    });
    await ex.goto(base + '/');
    const cdp = await extreme.newCDPSession(ex);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await ex.locator('nav button[data-v="scan"]').click();
    await ex.setViewportSize({ width: 800, height: 360 });
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await ex.evaluate(() => window.dispatchEvent(new Event('resize')));
    const exFit = await ex.evaluate(inside);
    assert.ok(exFit.h < 220, JSON.stringify(exFit));
    assert.equal(exFit.tight, true, JSON.stringify(exFit));
    assert.equal(exFit.controls['scan-front-cam'].ok, true, JSON.stringify(exFit));
    assert.equal(exFit.controls['scan-gallery'].ok, true, JSON.stringify(exFit));
    assert.equal(await ex.locator('#scan-tight-note').isVisible(), true);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await ex.locator('#scan-front-cam').click();
    const msgIn = await ex.evaluate(() => {
      const r = document.getElementById('scan-cam-msg').getBoundingClientRect();
      const v = visualViewport;
      return r.height > 0 && r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1;
    });
    assert.equal(msgIn, true);
    fs.writeFileSync(path.join(shots, 'extreme-landscape.png'), Buffer.from(shot.data, 'base64'));
    await extreme.close();
  });
});
