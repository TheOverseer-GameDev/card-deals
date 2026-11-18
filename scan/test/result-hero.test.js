/**
 * The review screen leads with the card, the price, and the grade.
 * History utilities stay behind History options. Scan next leaves the review.
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

test('the review hero leads, and scan next returns to the camera', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-mode-front').click();
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 280;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#c8c2b6';
      ctx.fillRect(0, 0, 200, 280);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'card.png', { type: 'image/png' });
      const input = document.querySelector('#scan-front-file');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector('#scan-next')?.hidden);
    await page.locator('#scan-next').click();
    await page.waitForSelector('#v-scan.scan-review');
    const layout = await page.evaluate(() => {
      const hero = document.getElementById('scan-hero');
      const history = document.getElementById('scan-history');
      const tools = document.getElementById('scan-history-tools');
      const toggle = document.querySelector('#scan-session .scan-toggle');
      const box = document.getElementById('scan-session-sound');
      return {
        heroFirst: !!(hero && history && hero.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING),
        hasArt: !!hero.querySelector('#scan-hero-art'),
        hasGrade: !!hero.querySelector('#scan-psa') && !!hero.querySelector('#scan-grade-range'),
        hasCenter: !!hero.querySelector('#scan-centering') && !!hero.querySelector('#scan-auto-center'),
        hasPrice: !!hero.querySelector('#scan-prices'),
        next: document.getElementById('scan-next-card')?.textContent || '',
        retake: document.getElementById('scan-retake-main')?.textContent || '',
        deleteInside: !!(tools && tools.contains(document.getElementById('scan-history-delete'))),
        toggleText: toggle ? toggle.textContent : '',
        boxInToggle: !!(toggle && box && toggle.contains(box)),
        identifyHasSearch: !!document.querySelector('#scan-identify #scan-search'),
      };
    });
    assert.equal(layout.heroFirst, true);
    assert.equal(layout.hasArt, true);
    assert.equal(layout.hasGrade, true);
    assert.equal(layout.hasCenter, true);
    assert.equal(layout.hasPrice, true);
    assert.equal(layout.next, 'Scan next card');
    assert.equal(layout.retake, 'Retake');
    assert.equal(layout.deleteInside, true);
    assert.match(layout.toggleText, /Optional click when a card is confirmed/);
    assert.equal(layout.boxInToggle, true);
    assert.equal(layout.identifyHasSearch, true);
    await page.locator('#scan-next-card').click();
    await page.waitForFunction(() => !document.getElementById('v-scan').classList.contains('scan-review'));
  } finally {
    await browser.close();
    server.close();
  }
});
