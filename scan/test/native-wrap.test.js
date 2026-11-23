/**
 * Draft Capacitor wrap. No hosted server URL, no microphone, no signing key.
 * Camera permission is requested when Scan opens, because that is when the preview starts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('the native project bundles this app and does not point at a hosted site', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.webDir, 'www');
  assert.equal(config.server, undefined);
  assert.equal(JSON.stringify(config).includes('server'), false);
  for (const rel of ['android/app/src/main/assets/capacitor.config.json', 'ios/App/App/capacitor.config.json']) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const copy = JSON.parse(fs.readFileSync(full, 'utf8'));
    assert.equal(copy.server, undefined, rel);
  }
  const android = read('android/app/src/main/AndroidManifest.xml');
  const ios = read('ios/App/App/Info.plist');
  assert.match(android, /android\.permission\.CAMERA/);
  assert.match(android, /READ_MEDIA_IMAGES/);
  assert.doesNotMatch(android, /RECORD_AUDIO|WRITE_EXTERNAL_STORAGE/);
  assert.match(ios, /Card Deals uses the camera to look at a card on this iPhone\. The photo stays on the device\./);
  assert.match(ios, /Card Deals can open a card photo you choose\. The photo stays on the device\./);
  assert.doesNotMatch(ios, /NSMicrophoneUsageDescription/);
  const camera = read('scan/camera-source.js');
  assert.match(camera, /storeToFile:\s*false/);
  assert.match(camera, /saveToGallery:\s*false/);
  assert.doesNotMatch(read('platform.js'), /CameraPreview\.start/);
  const boot = read('scan/boot.js');
  const openAt = boot.indexOf('openCamera(activeSlot())');
  const scanClick = boot.indexOf("button.dataset.v === 'scan'");
  assert.ok(scanClick !== -1 && openAt > scanClick);
  assert.equal(fs.existsSync(path.join(root, 'android/app/build.gradle')) || fs.existsSync(path.join(root, 'android/app/build.gradle.kts')), true);
  assert.equal(fs.existsSync(path.join(root, 'ios/App/App.xcodeproj')), true);
});

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

test('a native cold launch hides the splash, plays into the intro, and asks for the camera on Scan', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  try {
    await page.addInitScript(() => {
      window.__nativeLog = [];
      window.Capacitor = {
        isNativePlatform() { return true; },
        Plugins: {
          SplashScreen: { hide() { window.__nativeLog.push('splash-hide'); } },
          CameraPreview: {
            start(opts) { window.__nativeLog.push({ start: opts }); return Promise.resolve(); },
            capture() { return Promise.resolve({ value: '' }); },
            stop() { return Promise.resolve(); },
          },
        },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro');
    const launch = await page.evaluate(() => ({
      shell: document.documentElement.dataset.shell,
      splash: document.documentElement.dataset.splash,
      tap: getComputedStyle(document.getElementById('intro-tap')).display,
      log: window.__nativeLog.slice(),
    }));
    assert.equal(launch.shell, 'native');
    assert.equal(launch.splash, 'gone');
    assert.equal(launch.tap, 'none');
    assert.deepEqual(launch.log, ['splash-hide']);
    await page.locator('#intro-skip').click();
    await page.waitForSelector('#app-intro', { state: 'detached' });
    assert.equal(await page.locator('nav button[data-v="lists"]').isVisible(), true);
    await page.context().setOffline(true);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForFunction(() => window.__nativeLog.some((item) => item && item.start));
    const started = await page.evaluate(() => window.__nativeLog.find((item) => item && item.start).start);
    assert.equal(started.storeToFile, false);
    assert.equal(started.saveToGallery, false);
    assert.equal(started.disableAudio, true);
    assert.equal(await page.locator('#scan-add-by-name').isVisible(), true);
  } finally {
    await browser.close();
    server.close();
  }
});
