import { spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));
const chromeVersion = spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim();

function typeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.gz')) return 'application/octet-stream';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('missing');
    return;
  }
  res.writeHead(200, { 'content-type': typeFor(file), 'cache-control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const urls = [];
page.on('request', (req) => urls.push(req.url()));
page.on('pageerror', (err) => console.error('PAGE', err));
await page.goto(base + '/scan/bench/bench.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#out').textContent !== 'running', null, { timeout: 180000 });
const measured = JSON.parse(await page.locator('#out').innerText());
await browser.close();
await new Promise((resolve) => server.close(resolve));
const foreign = urls.filter((url) => new URL(url).host !== new URL(base).host);
const result = {
  measuredAt: new Date().toISOString(),
  environment: 'Headless Chrome on this Linux VM. Desktop browser engine. Not a phone.',
  emulation: 'No phone CPU was used. A mobile-viewport test elsewhere checks layout only. These times are not phone times.',
  hardware: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0] && os.cpus()[0].model,
    memoryBytes: os.totalmem(),
    node: process.version,
    chrome: chromeVersion,
  },
  requests: {
    total: urls.length,
    foreign,
    sample: urls.map((url) => url.replace(base, '')),
  },
  timings: measured,
};
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  coldMs: measured.coldMs,
  warmSameMs: measured.warmSameMs,
  warmOtherMs: measured.warmOtherMs,
  codes: measured.cold && measured.cold.codes,
  other: measured.other && measured.other.codes,
  soft: measured.soft && measured.soft.codes,
  foreign,
  error: measured.error || null,
}, null, 2));
if (measured.error || foreign.length) process.exit(1);
