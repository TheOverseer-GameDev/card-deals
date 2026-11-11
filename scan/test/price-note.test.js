/**
 * The camera must not show the developer price sentence.
 * The price panel still says PSA 5 through PSA 8 stay unavailable,
 * beside the stored prices. The publish gate reads that sentence.
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

test('the camera omits the developer price note and the price panel keeps it', async () => {
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
  const camera = await page.locator('.scan-capture').innerText();
  assert.doesNotMatch(camera, /verified-prices\.json/);
  assert.doesNotMatch(camera, /Market shards/);
  const place = await page.evaluate(() => {
    const info = document.getElementById('scan-info-sheet');
    const live = document.getElementById('scan-price-limit-live');
    const beside = document.getElementById('scan-price-limit');
    const capture = document.querySelector('.scan-capture');
    return {
      liveInCapture: !!(live && capture && capture.contains(live) && !live.hidden),
      besidePrices: !!(beside && beside.nextElementSibling && beside.nextElementSibling.id === 'scan-prices'),
      priceText: beside ? beside.textContent : '',
      infoText: info ? info.textContent : '',
    };
  });
  assert.equal(place.liveInCapture, false);
  assert.equal(place.besidePrices, true);
  assert.match(place.priceText, new RegExp(NOTE));
  assert.doesNotMatch(place.infoText, /verified-prices\.json/);
  assert.doesNotMatch(place.infoText, /Market shards/);
  await browser.close();
  server.close();
});
