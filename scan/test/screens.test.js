import fs from 'fs';
import http from 'http';
import path from 'path';
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

async function mockLookup(page, base) {
  const card = {
    id: 46986414,
    name: 'Blue-Eyes White Dragon',
    desc: 'This legendary dragon is a powerful engine of destruction.',
    card_images: [{ image_url: `${base}/icon-512.png` }],
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
      localStorage.setItem('carddeals-coll-v1', JSON.stringify([{ name: 'Blue-Eyes White Dragon', code: 'LOB-005', usd: 5 }]));
    });
    const page = await phone.newPage();
    await mockLookup(page, base);
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForFunction(() => {
      const video = document.getElementById('scan-cam-video');
      return video && video.hidden === false && video.readyState >= 2;
    });
    await shot(page, 'phone-scan.png');
    await page.locator('#scan-tab-search').click();
    await page.locator('#scan-code').fill('LOB-005');
    await page.locator('#scan-lookup').click();
    await page.waitForSelector('#scan-add-card');
    await shot(page, 'phone-match.png');
    await page.locator('#scan-tab-card').click();
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

    const desk = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    await desk.addInitScript(() => {
      localStorage.setItem('carddeals-coll-v1', JSON.stringify([{ name: 'Blue-Eyes White Dragon', code: 'LOB-005', usd: 5 }]));
    });
    const wide = await desk.newPage();
    await mockLookup(wide, base);
    await wide.goto(base + '/');
    const client = await desk.newCDPSession(wide);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await wide.locator('nav button[data-v="scan"]').click();
    await wide.waitForFunction(() => {
      const video = document.getElementById('scan-cam-video');
      return video && video.hidden === false && video.readyState >= 2;
    });
    await saveCdp(client, 's22-scan.png');
    await wide.locator('#scan-tab-search').click();
    await wide.locator('#scan-code').fill('LOB-005');
    await wide.locator('#scan-lookup').click();
    await wide.waitForSelector('#scan-add-card');
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
