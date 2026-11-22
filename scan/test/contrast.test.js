/**
 * Every visible text node sits on frosted glass and clears WCAG AA
 * against the brightest or darkest rain pixel behind that glass.
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
  const parts = String(color).match(/[\d.]+/g);
  if (!parts) return { rgb: [0, 0, 0], a: 0 };
  const rgb = parts.slice(0, 3).map(Number);
  return { rgb, a: parts.length > 3 ? Number(parts[3]) : 1 };
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

test('every visible line sits on glass and clears the rain', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  try {
    for (const theme of ['dark', 'light']) {
      const page = await (await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      })).newPage();
      await page.addInitScript((mode) => localStorage.setItem('cd-theme', mode), theme);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#intro-skip').click();
      await page.waitForSelector('#card-rain');
      await page.waitForSelector('#cnt');
      const sample = await page.evaluate((mode) => {
        const parse = (color) => {
          const parts = String(color).match(/[\d.]+/g);
          if (!parts) return { rgb: [0, 0, 0], a: 0 };
          return { rgb: parts.slice(0, 3).map(Number), a: parts.length > 3 ? Number(parts[3]) : 1 };
        };
        const canvas = document.getElementById('card-rain');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let worst = [128, 128, 128];
        let score = mode === 'light' ? 999 : -1;
        for (let i = 0; i < data.length; i += 16) {
          const rgb = [data[i], data[i + 1], data[i + 2]];
          const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          if (mode === 'light' ? y < score : y > score) {
            score = y;
            worst = rgb;
          }
        }
        const lines = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          const el = node.parentElement;
          node = walker.nextNode();
          if (!text || !el || el.closest('#app-intro')) continue;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          let hidden = false;
          let frost = false;
          const layers = [];
          let current = el;
          while (current && current !== document.body) {
            const parentStyle = getComputedStyle(current);
            if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') hidden = true;
            const bg = parse(parentStyle.backgroundColor);
            if (bg.a >= 0.6) frost = true;
            if (bg.a > 0) layers.push(bg);
            current = current.parentElement;
          }
          if (hidden) continue;
          lines.push({
            text: text.slice(0, 48),
            color: style.color,
            size: parseFloat(style.fontSize),
            weight: parseInt(style.fontWeight, 10) || 400,
            frost,
            layers,
          });
        }
        return { worst, lines };
      }, theme);
      assert.ok(sample.lines.length > 8, `${theme} saw ${sample.lines.length} lines`);
      const misses = [];
      for (const line of sample.lines) {
        if (!line.frost) {
          misses.push(`${theme} bare "${line.text}"`);
          continue;
        }
        let surface = sample.worst.slice();
        for (let i = line.layers.length - 1; i >= 0; i -= 1) surface = over(line.layers[i], surface);
        const ink = parseColor(line.color).rgb;
        const score = ratio(ink, surface);
        const large = line.size >= 24 || (line.size >= 18.66 && line.weight >= 700);
        const bar = large ? 3 : 4.5;
        if (score < bar) misses.push(`${theme} "${line.text}" ${score.toFixed(2)} < ${bar}`);
      }
      assert.deepEqual(misses, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
