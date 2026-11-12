/**
 * Camera-screen regressions: a front shutter in Front & back must come back
 * to a clean live preview on step 2, the step line must not clip, the
 * developer price sentence must stay off the camera, and the guide keeps
 * a 16px corner with the card's real aspect.
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

function typeFor(file) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-type': typeFor(file), 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function flatFeed(file) {
  const width = 640;
  const height = 480;
  const ySize = width * height;
  const cSize = (width / 2) * (height / 2);
  const parts = [Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let frame = 0; frame < 8; frame++) {
    parts.push(Buffer.from('FRAME\n'), Buffer.alloc(ySize, 26), Buffer.alloc(cSize, 128), Buffer.alloc(cSize, 128));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

function launch(feed) {
  return chromium.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${feed}`,
    ],
  });
}

test('a front shutter in Front & back returns to a clean live preview on step 2', async () => {
  const feed = flatFeed('/tmp/scan-phase2/camera-flat.y4m');
  const browser = await launch(feed);
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.context().grantPermissions(['camera']);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.locator('#scan-mode-both').click();
    await page.waitForFunction(() => {
      const video = document.querySelector('#scan-cam-video');
      return video && video.videoWidth > 2 && !video.hidden;
    });
    await page.locator('#scan-front-cam').click();
    await page.waitForFunction(() => (document.querySelector('#scan-step')?.textContent || '').includes('Step 2 of 2'));
    await page.waitForFunction(() => {
      const video = document.querySelector('#scan-cam-video');
      return video && !video.hidden && video.videoWidth > 2;
    });
    const state = await page.evaluate(() => {
      const step = document.getElementById('scan-step');
      const outline = document.getElementById('scan-outline');
      const video = document.getElementById('scan-cam-video');
      const viewport = document.getElementById('scan-viewport');
      const edge = document.getElementById('scan-live-edge');
      let ink = 0;
      if (edge && edge.width > 1 && edge.height > 1) {
        const data = edge.getContext('2d').getImageData(0, 0, edge.width, edge.height).data;
        for (let i = 3; i < data.length; i += 16) if (data[i] > 20) ink += 1;
      }
      const outlineStyle = getComputedStyle(outline);
      const capture = document.querySelector('.scan-capture');
      return {
        step: step.textContent,
        outlineHidden: outline.hidden,
        radius: outlineStyle.borderRadius,
        videoHidden: video.hidden,
        videoVisibility: getComputedStyle(video).visibility,
        transform: video.style.transform,
        viewportHidden: viewport.hidden,
        viewportDisplay: getComputedStyle(viewport).display,
        thumbs: document.querySelectorAll('#scan-thumbs canvas').length,
        edgeInk: ink,
        capture: capture ? capture.innerText : '',
      };
    });
    assert.match(state.step, /Step 2 of 2/);
    assert.match(state.step, /back/i);
    assert.equal(state.outlineHidden, false);
    assert.equal(state.radius, '16px');
    assert.equal(state.videoHidden, false);
    assert.equal(state.videoVisibility, 'visible');
    assert.equal(state.viewportHidden, true);
    assert.equal(state.viewportDisplay, 'none');
    assert.ok(state.thumbs >= 1, 'front thumbnail missing');
    assert.equal(state.edgeInk, 0, 'stale edge overlay still has pixels');
    assert.ok(state.transform === '' || state.transform === 'scale(1)' || state.transform === 'scale(1)', state.transform);
    assert.doesNotMatch(state.capture, /verified-prices\.json/);
    assert.doesNotMatch(state.capture, /Market shards/);
  } finally {
    await browser.close();
    server.close();
  }
});

test('the step line is fully visible from 360px through 430px', async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#v-scan.on');
    for (const width of [360, 390, 412, 430]) {
      await page.setViewportSize({ width, height: 915 });
      await page.waitForTimeout(50);
      const fault = await page.evaluate(() => {
        const step = document.getElementById('scan-step');
        const style = getComputedStyle(step);
        const box = step.getBoundingClientRect();
        const clipped = step.scrollWidth > step.clientWidth + 1 || step.scrollHeight > step.clientHeight + 1;
        let parent = step.parentElement;
        let outside = false;
        while (parent && parent !== document.body) {
          const ps = getComputedStyle(parent);
          if (/(auto|hidden|clip|scroll)/.test(ps.overflow + ps.overflowY)) {
            const pb = parent.getBoundingClientRect();
            if (box.bottom > pb.bottom + 1 || box.top < pb.top - 1 || box.right > pb.right + 1) outside = true;
          }
          parent = parent.parentElement;
        }
        let overlap = false;
        let nextId = '';
        let node = step.nextElementSibling;
        while (node) {
          const shown = !node.hidden && getComputedStyle(node).display !== 'none';
          const nb = node.getBoundingClientRect();
          if (shown && nb.height > 2 && nb.width > 2) {
            nextId = node.id || node.className;
            overlap = box.bottom > nb.top + 1 && nb.bottom > box.top + 1;
            break;
          }
          node = node.nextElementSibling;
        }
        return {
          clipped,
          outside,
          overlap,
          nextId,
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          text: step.textContent,
        };
      });
      assert.equal(fault.clipped, false, `${width}px clips the step (${fault.text})`);
      assert.equal(fault.outside, false, `${width}px step sits outside its scroller`);
      assert.equal(fault.overlap, false, `${width}px step overlaps ${fault.nextId}`);
      assert.notEqual(fault.whiteSpace, 'nowrap', `${width}px step cannot wrap`);
      assert.match(fault.text, /Step 1 of 2/);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test('the guide is a portrait card on first paint and after the camera starts', async () => {
  const feed = flatFeed('/tmp/scan-phase2/guide-aspect.y4m');
  const browser = await launch(feed);
  const server = await startServer();
  const expectRatio = async (page, target, label) => {
    const state = await page.evaluate(() => {
      const outline = document.getElementById('scan-outline');
      const box = outline.getBoundingClientRect();
      const style = getComputedStyle(outline);
      return {
        ratio: box.height ? box.width / box.height : 0,
        radius: style.borderRadius,
        w: box.width,
        h: box.height,
      };
    });
    assert.ok(state.h > 24 && state.w > 24, `${label} guide is ${state.w}x${state.h}`);
    assert.ok(Math.abs(state.ratio - target) < 0.02, `${label} ratio ${state.ratio} wanted ${target}`);
    assert.ok(Math.abs(state.ratio - 1) > 0.08, `${label} guide is square`);
    assert.equal(state.radius, '16px', label);
  };
  try {
    for (const width of [360, 390, 412]) {
      const page = await (await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      })).newPage();
      await page.context().grantPermissions(['camera']);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('nav button[data-v="scan"]').click();
      await page.waitForSelector('#scan-outline');
      await expectRatio(page, 59 / 86, `${width}px first paint`);
      await page.waitForFunction(() => {
        const video = document.querySelector('#scan-cam-video');
        return video && video.videoWidth > 2 && !video.hidden;
      });
      await expectRatio(page, 59 / 86, `${width}px after camera start`);
      await page.evaluate(() => {
        const finder = document.getElementById('scan-finder');
        finder.style.flex = 'none';
        finder.style.height = '720px';
      });
      await expectRatio(page, 59 / 86, `${width}px tall finder`);
      await page.setViewportSize({ width, height: 1100 });
      await expectRatio(page, 59 / 86, `${width}px tall resize`);
      await page.setViewportSize({ width: Math.max(width, 800), height: 360 });
      await expectRatio(page, 59 / 86, `${width}px landscape`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test('the guide uses the card aspect for the selected game and keeps a 16px corner', async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })).newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('nav button[data-v="scan"]').click();
    await page.waitForSelector('#scan-outline');
    const read = () => page.evaluate(() => {
      const outline = document.getElementById('scan-outline');
      const style = getComputedStyle(outline);
      const box = outline.getBoundingClientRect();
      return {
        aspect: style.aspectRatio,
        radius: style.borderRadius,
        ratio: box.height ? box.width / box.height : 0,
      };
    });
    const ygo = await read();
    assert.equal(ygo.radius, '16px');
    assert.ok(Math.abs(ygo.ratio - (59 / 86)) < 0.02, `Yu-Gi-Oh guide ratio ${ygo.ratio} aspect ${ygo.aspect}`);
    const choose = (value) => page.evaluate((next) => {
      const game = document.getElementById('scan-game');
      game.value = next;
      game.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await choose('mtg');
    const mtg = await read();
    assert.equal(mtg.radius, '16px');
    assert.ok(Math.abs(mtg.ratio - (63 / 88)) < 0.02, `Magic guide ratio ${mtg.ratio} aspect ${mtg.aspect}`);
    await choose('ygo');
    const again = await read();
    assert.equal(again.radius, '16px');
    assert.ok(Math.abs(again.ratio - (59 / 86)) < 0.02, `Yu-Gi-Oh guide ratio ${again.ratio}`);
  } finally {
    await browser.close();
    server.close();
  }
});
