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

test('scanner screens at phone and desktop-site sizes', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const tabs = [['scan', 'scan'], ['card', 'card'], ['collection', 'collection'], ['prices', 'prices']];
  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await phone.newPage();
    await page.goto(base + '/');
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    await shot(page, 'phone-scan.png');
    await page.evaluate(() => {
      const deck = document.getElementById('scan-deck');
      deck.hidden = false;
      document.getElementById('v-scan').classList.add('scan-sheet');
      for (const node of deck.children) node.hidden = node.id !== 'scan-match';
    });
    await shot(page, 'phone-match.png');
    for (const [id, name] of [['card', 'card'], ['collection', 'collection'], ['prices', 'prices']]) {
      await page.locator(`#scan-tab-${id}`).click();
      await page.waitForSelector('#scan-deck:not([hidden])');
      await shot(page, `phone-${name}.png`);
    }
    await page.locator('#scan-tab-search').click();
    await page.locator('#scan-code').fill('LOB-005');
    await shot(page, 'phone-search.png');
    await phone.close();

    const desk = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    const wide = await desk.newPage();
    await wide.goto(base + '/');
    const client = await desk.newCDPSession(wide);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await wide.locator('nav button[data-v="scan"]').click();
    await wide.waitForSelector('html.scan-cam');
    const png = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 's22-scan.png'), Buffer.from(png.data, 'base64'));
    await wide.evaluate(() => {
      const deck = document.getElementById('scan-deck');
      deck.hidden = false;
      document.getElementById('v-scan').classList.add('scan-sheet');
      for (const node of deck.children) node.hidden = node.id !== 'scan-match';
    });
    const match = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 's22-match.png'), Buffer.from(match.data, 'base64'));
    for (const [id, name] of tabs) {
      if (id === 'scan') continue;
      await wide.locator(`#scan-tab-${id}`).click();
      const frame = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `s22-${name}.png`), Buffer.from(frame.data, 'base64'));
    }
    await desk.close();
  } finally {
    await browser.close();
    server.close();
  }
});
