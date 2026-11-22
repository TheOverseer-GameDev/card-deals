/**
 * The intro is still the top layer at 0.2s, 0.7s, 1.2s and 1.8s.
 * Reduced motion is off. The seen-once flag starts clear. Nothing is skipped.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));
const outDir = '/opt/cursor/artifacts/scan-v2/intro-v3';
const MARKS = [200, 700, 1200, 1800];

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

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE((v * 32767) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('the intro covers the home at 0.2s, 0.7s, 1.2s and 1.8s', async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    reducedMotion: 'no-preference',
  })).newPage();
  try {
    await page.addInitScript(() => {
      delete window.__introPlayed;
      delete window.__holdIntro;
      try { localStorage.clear(); } catch { /* a fresh launch has no saved flag */ }
    });
    const originDate = new Date('2026-11-22T00:00:00.000Z');
    await page.clock.install({ time: originDate });
    await page.clock.pauseAt(originDate);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#app-intro.is-full');
    const origin = originDate.getTime();
    for (let i = 0; i < MARKS.length; i += 1) {
      await page.clock.pauseAt(origin + MARKS[i]);
      const state = await page.evaluate((ms) => {
        const intro = document.getElementById('app-intro');
        if (!intro) return { visible: false };
        for (const anim of intro.getAnimations({ subtree: true })) {
          anim.pause();
          anim.currentTime = ms;
        }
        const box = intro.getBoundingClientRect();
        const style = getComputedStyle(intro);
        const hit = document.elementFromPoint(195, 400);
        const hero = document.querySelector('.hero-amount');
        const heroBox = hero ? hero.getBoundingClientRect() : null;
        const heroHit = heroBox ? document.elementFromPoint(heroBox.left + 8, heroBox.top + 8) : null;
        return {
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.9,
          full: intro.classList.contains('is-full') && !intro.classList.contains('is-reduced'),
          covers: box.width >= 380 && box.height >= 800 && box.top <= 1,
          hitIntro: !!(hit && (hit === intro || intro.contains(hit))),
          heroCovered: !heroHit || intro.contains(heroHit) || heroHit === intro,
        };
      }, MARKS[i]);
      assert.equal(state.visible, true, `t=${MARKS[i]} intro hidden ${JSON.stringify(state)}`);
      assert.equal(state.full, true, `t=${MARKS[i]} reduced motion`);
      assert.equal(state.covers, true, `t=${MARKS[i]} does not cover the screen`);
      assert.equal(state.hitIntro, true, `t=${MARKS[i]} the home is in front`);
      assert.equal(state.heroCovered, true, `t=${MARKS[i]} the hero is visible`);
      await page.screenshot({ path: path.join(outDir, `frame-${i + 1}.png`) });
    }
    const pcm = await page.evaluate(async () => {
      const rate = 48000;
      const ctx = new OfflineAudioContext(1, rate * 2, rate);
      window.__scheduleSting(ctx, 0.02);
      const rendered = await ctx.startRendering();
      return Array.from(rendered.getChannelData(0));
    });
    const wavPath = path.join(outDir, 'sting.wav');
    fs.writeFileSync(wavPath, wav(Float32Array.from(pcm), 48000));
    const mux = spawnSync('ffmpeg', [
      '-y', '-framerate', '2', '-i', path.join(outDir, 'frame-%d.png'),
      '-i', wavPath, '-t', '2.05', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', path.join(outDir, 'intro.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(mux.status, 0, mux.stderr);
    fs.unlinkSync(wavPath);
  } finally {
    await browser.close();
    server.close();
  }
});
