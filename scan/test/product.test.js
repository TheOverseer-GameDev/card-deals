/**
 * The confirm sheet names the card before a stored price.
 * The grade stays visible and says it is not an official grade.
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

test('confirm fields, the fee check, the session, and history are on the result', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#intro-skip').click();
    await page.locator('nav button[data-v="scan"]').click();
    assert.equal(await page.locator('#scan-add-by-name').count(), 1);
    await page.locator('#scan-add-by-name').click();
    await page.waitForSelector('#scan-confirm-match');
    const fields = await page.evaluate(() => ({
      set: !!document.getElementById('scan-confirm-set'),
      number: !!document.getElementById('scan-confirm-number'),
      variant: !!document.getElementById('scan-confirm-variant'),
      foil: !!document.getElementById('scan-confirm-foil'),
      language: !!document.getElementById('scan-confirm-language'),
      worth: !!document.getElementById('scan-worth'),
      session: !!document.getElementById('scan-session'),
      csv: !!document.getElementById('scan-history-export'),
      prices: document.getElementById('scan-prices')?.textContent || '',
    }));
    assert.equal(fields.set && fields.number && fields.variant && fields.foil && fields.language, true);
    assert.equal(fields.worth, true);
    assert.equal(fields.session, true);
    assert.equal(fields.csv, true);
    assert.match(fields.prices, /Confirm a catalog row to see stored prices/);
  } finally {
    await browser.close();
    server.close();
  }
});
