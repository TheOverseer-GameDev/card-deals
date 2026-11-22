/**
 * The store shell plays as a native app.
 * The browser stays a preview: no immediate sound, and no desktop chrome when Capacitor is present.
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

test('browser preview keeps the tap gate and names itself preview', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro');
    const state = await page.evaluate(() => ({
      shell: document.documentElement.dataset.shell,
      splash: document.documentElement.dataset.splash,
      audio: window.__intro.audio,
      handoff: typeof window.__splashHandoff === 'number',
    }));
    assert.equal(state.shell, 'preview');
    assert.equal(state.splash, 'gone');
    assert.equal(state.handoff, true);
    assert.equal(state.audio, false);
  } finally {
    await browser.close();
    server.close();
  }
});

test('a native shell hands the splash to the intro, styles the status bar, and handles back', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  try {
    await page.addInitScript(() => {
      window.__native = { back: 0, hide: 0, style: '', impact: 0, opened: '' };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          SplashScreen: { hide() { window.__native.hide += 1; } },
          StatusBar: { setStyle(opts) { window.__native.style = opts.style; }, setBackgroundColor() {}, setOverlaysWebView() {} },
          Haptics: { impact() { window.__native.impact += 1; }, notification() { window.__native.impact += 1; } },
          App: { addListener(name, fn) { window.__native.backListener = name === 'backButton' ? fn : null; }, exitApp() { window.__native.back += 1; } },
          Browser: { open(opts) { window.__native.opened = opts.url; } },
        },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro');
    const state = await page.evaluate(() => ({
      shell: document.documentElement.dataset.shell,
      phone: document.documentElement.classList.contains('phone'),
      desktop: document.documentElement.classList.contains('desktop'),
      splash: document.documentElement.dataset.splash,
      hide: window.__native.hide,
      style: window.__native.style,
      history: history.state && history.state.cd,
      vt: getComputedStyle(document.getElementById('vt')).display,
    }));
    assert.equal(state.shell, 'native');
    assert.equal(state.phone, true);
    assert.equal(state.desktop, false);
    assert.equal(state.splash, 'gone');
    assert.equal(state.hide, 1);
    assert.equal(state.style, 'DARK');
    assert.equal(state.history, 'shell');
    assert.equal(state.vt, 'none');
    const closed = await page.evaluate(() => {
      let hit = false;
      window.CardDealsPlatform.push({ id: 'sheet', close() { hit = true; } });
      window.__native.backListener();
      return { hit, layers: window.CardDealsPlatform.layers().join(',') };
    });
    assert.equal(closed.hit, true);
    assert.equal(closed.layers, '');
    const exited = await page.evaluate(() => {
      window.__native.backListener();
      return window.__native.back;
    });
    assert.equal(exited, 1);
    const haptic = await page.evaluate(() => window.CardDealsPlatform.haptic('capture'));
    assert.equal(haptic, 'native');
  } finally {
    await browser.close();
    server.close();
  }
});
