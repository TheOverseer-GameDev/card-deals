/**
 * The PSA unavailable note has to be in the visible scan text.
 * The publish gate reads #v-scan innerText and ignores hidden sheets.
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
const NOTE = 'PSA 5 through PSA 8 stay unavailable';

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

test('the PSA unavailable note is visible when Scan opens', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('nav button[data-v="scan"]').click();
  await page.waitForSelector('#v-scan.on');
  const body = await page.locator('#v-scan').innerText();
  assert.match(body, new RegExp(NOTE));
  const place = await page.evaluate(() => {
    const info = document.getElementById('scan-info-sheet');
    const live = document.getElementById('scan-price-limit-live');
    const beside = document.getElementById('scan-price-limit');
    return {
      liveOutsideInfo: !!(live && info && !info.contains(live) && !live.hidden),
      besidePrices: !!(beside && beside.previousElementSibling && beside.nextElementSibling && beside.nextElementSibling.id === 'scan-prices'),
    };
  });
  assert.equal(place.liveOutsideInfo, true);
  assert.equal(place.besidePrices, true);
  await browser.close();
  server.close();
});
