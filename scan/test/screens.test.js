import fs from 'fs';
import http from 'http';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));
const out = '/tmp/scan-shots';
fs.mkdirSync(out, { recursive: true });

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8'
      : file.endsWith('.json') ? 'application/json; charset=utf-8'
      : file.endsWith('.png') ? 'image/png'
      : file.endsWith('.svg') ? 'image/svg+xml'
      : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shot(page, name) {
  const buf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(out, name), buf);
}

async function saveCdp(client, name) {
  const frame = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, name), Buffer.from(frame.data, 'base64'));
}

async function waitLive(page) {
  await page.waitForFunction(() => {
    const video = document.getElementById('scan-cam-video');
    const blocked = document.getElementById('scan-blocked');
    if (!window.isSecureContext || !video || video.hidden || !video.srcObject) return false;
    if (video.readyState < 2 || video.videoWidth < 2 || !blocked || !blocked.hidden) return false;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 4, 4);
    const px = ctx.getImageData(0, 0, 1, 1).data;
    return px[0] + px[1] + px[2] > 24;
  });
}

async function contrastOf(page, selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    const deck = document.getElementById('scan-deck');
    const light = getComputedStyle(deck).getPropertyValue('--cd-theme-light').trim();
    const fg = getComputedStyle(node).color;
    const parse = (value) => {
      const raw = value.trim();
      if (raw.startsWith('#')) {
        const hex = raw.slice(1);
        const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
        return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      }
      return raw.match(/[\d.]+/g).slice(0, 3).map(Number);
    };
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const L = (rgb) => {
      const [r, g, b] = parse(rgb).map(lin);
      return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    };
    const a = L(fg);
    const b = L(light);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { fg, light, ratio, theme: deck.classList.contains('cd-theme') };
  }, selector);
}

async function mockLookup(page, base) {
  const card = {
    id: 46986414,
    name: 'Dark Magician',
    desc: 'The ultimate wizard in terms of attack and defense.',
    card_images: [{ image_url: `${base}/scan/test/fixture-art.svg` }],
    card_sets: [{ set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-005', set_rarity: 'Ultra Rare', set_price: '5.00' }],
  };
  await page.route('**/cardsetsinfo.php**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ id: card.id, set_code: 'LOB-005', set_name: card.card_sets[0].set_name, set_rarity: 'Ultra Rare', set_price: '5.00' }),
  }));
  await page.route('**/cardinfo.php**', (route) => {
    const url = route.request().url();
    if (url.includes('staple=yes')) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ ...card, name: 'Ash Blossom & Joyous Spring', card_sets: [{ set_name: 'Maximum Gold', set_code: 'MAGO-EN001', set_rarity: 'Rare', set_price: '2.50' }] }] }),
      });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [card] }) });
  });
  await page.route('**/api.frankfurter.dev/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ rates: { CAD: 1.36 }, date: '2026-11-09' }),
  }));
}

test('scanner screens at phone and desktop-site sizes', async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await phone.addInitScript(() => {
      localStorage.setItem('carddeals-coll-v1', JSON.stringify([{ name: 'Dark Magician', code: 'LOB-005', usd: 5 }]));
    });
    const page = await phone.newPage();
    await phone.grantPermissions(['camera']);
    await mockLookup(page, base);
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await waitLive(page);
    await shot(page, 'phone-scan.png');
    await page.locator('#scan-tab-search').click();
    await page.locator('#scan-code').fill('LOB-005');
    await page.locator('#scan-lookup').click();
    await page.waitForSelector('#scan-add-card');
    const matchContrast = await contrastOf(page, '#scan-match h2');
    assert.ok(matchContrast.theme, JSON.stringify(matchContrast));
    assert.ok(matchContrast.ratio >= 4.5, JSON.stringify(matchContrast));
    assert.match(await page.locator('#scan-match').innerText(), /Dark Magician/);
    assert.match(await page.locator('#scan-match').innerText(), /Test fixture/);
    await shot(page, 'phone-match.png');
    await page.locator('#scan-tab-card').click();
    const detailContrast = await contrastOf(page, '#scan-card h2');
    assert.ok(detailContrast.ratio >= 4.5, JSON.stringify(detailContrast));
    for (const id of ['pricing', 'grade', 'text']) {
      await page.locator(`#scan-seg-${id}`).click();
      await shot(page, `phone-card-${id}.png`);
    }
    await page.locator('#scan-tab-collection').click();
    await shot(page, 'phone-collection.png');
    await page.locator('#scan-tab-prices').click();
    await page.waitForFunction(() => document.getElementById('scan-guide')?.textContent?.includes('Ash Blossom'));
    await shot(page, 'phone-prices.png');
    await phone.close();

    const blocked = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await blocked.addInitScript(() => {
      const reject = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: reject, enumerateDevices: async () => [] } });
    });
    const denied = await blocked.newPage();
    await denied.goto(base + '/');
    await denied.locator('nav button[data-v="scan"]').click();
    await denied.locator('#scan-front-cam').click();
    await denied.waitForFunction(() => document.querySelector('#scan-cam-msg')?.textContent?.includes('Camera is blocked'));
    await shot(denied, 'phone-blocked.png');
    await blocked.close();

    const desk = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    await desk.addInitScript(() => {
      localStorage.setItem('carddeals-coll-v1', JSON.stringify([{ name: 'Dark Magician', code: 'LOB-005', usd: 5 }]));
    });
    await desk.grantPermissions(['camera']);
    const wide = await desk.newPage();
    await mockLookup(wide, base);
    await wide.goto(base + '/');
    const client = await desk.newCDPSession(wide);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await wide.locator('nav button[data-v="scan"]').click();
    await waitLive(wide);
    await saveCdp(client, 's22-scan.png');
    await wide.locator('#scan-tab-search').click();
    await wide.locator('#scan-code').fill('LOB-005');
    await wide.locator('#scan-lookup').click();
    await wide.waitForSelector('#scan-add-card');
    const wideContrast = await contrastOf(wide, '#scan-match h2');
    assert.ok(wideContrast.ratio >= 4.5, JSON.stringify(wideContrast));
    await saveCdp(client, 's22-match.png');
    await wide.locator('#scan-tab-card').click();
    for (const id of ['pricing', 'grade', 'text']) {
      await wide.locator(`#scan-seg-${id}`).click();
      await saveCdp(client, `s22-card-${id}.png`);
    }
    await wide.locator('#scan-tab-collection').click();
    await saveCdp(client, 's22-collection.png');
    await wide.locator('#scan-tab-prices').click();
    await wide.waitForFunction(() => document.getElementById('scan-guide')?.textContent?.includes('Ash Blossom'));
    await saveCdp(client, 's22-prices.png');
    await desk.close();
  } finally {
    await browser.close();
    server.close();
  }
});
