/**
 * Glass text stays WCAG AA over a worst-case bright card back.
 * Body text needs 4.5:1. Large text needs 3:1.
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
const WORST = {
  dark: [255, 246, 208],
  light: [12, 12, 14],
};

function channel(value) {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function ratio(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(color) {
  const parts = color.match(/[\d.]+/g).map(Number);
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

function over(panel, back) {
  const a = panel.a == null ? 1 : panel.a;
  return panel.rgb.map((c, i) => Math.round(c * a + back[i] * (1 - a)));
}

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

async function colors(page) {
  return page.evaluate(() => {
    const panel = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
    const text = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { color: style.color, size: parseFloat(style.fontSize) };
    };
    return {
      amount: { ...text('.hero-amount'), background: panel('.hero') },
      label: { ...text('.hero-label'), background: panel('.hero') },
      sub: { ...text('.hero-sub'), background: panel('.hero') },
      name: { ...text('.scan-hero-name'), background: panel('.scan-hero') },
    };
  });
}

test('hero and scan text clear a bright card back', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  try {
    for (const theme of ['dark', 'light']) {
      const page = await (await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block',
      })).newPage();
      await page.addInitScript((mode) => localStorage.setItem('cd-theme', mode), theme);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('nav button[data-v="scan"]').click();
      await page.waitForSelector('.scan-hero-name', { state: 'attached' });
      const sample = await colors(page);
      const back = WORST[theme];
      for (const [key, item] of Object.entries(sample)) {
        const text = parseColor(item.color);
        const panel = parseColor(item.background);
        const surface = over(panel, back);
        const score = ratio(text.rgb, surface);
        const bar = item.size >= 24 || (item.size >= 18.66 && key === 'amount') ? 3 : 4.5;
        assert.ok(score >= bar, `${theme} ${key} ${score.toFixed(2)} < ${bar} on ${surface.join(',')}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
