/**
 * The S22 dev readout stays hidden unless the page is opened with ?s22=1.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { formatDevLine } from '../live.js';

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

test('the dev line names the lens, the torch, and a measured frame time', () => {
  assert.equal(formatDevLine({ lens: 'Rear 1×', torchOn: false }), 'Rear 1× · torch off');
  assert.equal(formatDevLine({ lens: 'Front', torchOn: true, judgeMs: 12.34 }), 'Front · torch on · 12.3 ms');
  assert.equal(formatDevLine({ judgeMs: Number.NaN }).includes('ms'), false);
});

test('the S22 readout is hidden unless the flag is set', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  try {
    const plain = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
    await plain.goto(`http://127.0.0.1:${server.address().port}/`);
    await plain.locator('#intro-skip').click();
    await plain.locator('nav button[data-v="scan"]').click();
    await plain.waitForSelector('#scan-dev', { state: 'attached' });
    assert.equal(await plain.locator('#scan-dev').isHidden(), true);
    await plain.close();

    const flagged = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
    await flagged.goto(`http://127.0.0.1:${server.address().port}/?s22=1`);
    await flagged.locator('#intro-skip').click();
    await flagged.locator('nav button[data-v="scan"]').click();
    await flagged.waitForSelector('#scan-dev');
    const text = await flagged.locator('#scan-dev').innerText();
    assert.match(text, /Rear 1×/);
    assert.match(text, /torch off/);
    assert.equal(await flagged.locator('#scan-dev').isVisible(), true);
  } finally {
    await browser.close();
    server.close();
  }
});
