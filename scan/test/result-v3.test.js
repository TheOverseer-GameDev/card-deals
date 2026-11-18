/**
 * Result screen regressions: grade copy, photo thumb, score tiles,
 * history rows, the confirm switch, the name sheet, and the action bar.
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

test('the result screen keeps grade copy, the photo, and the first-viewport actions', async () => {
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
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, 200, 280);
      ctx.fillStyle = '#c8c2b6';
      ctx.fillRect(4, 4, 192, 272);
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
    await page.waitForSelector('#scan-grade-range .scan-chip');
    await page.waitForSelector('#scan-history-list .scan-history-row');
    const facts = await page.evaluate(() => {
      const why = document.querySelector('#scan-grade-range .scan-why');
      const note = why.querySelector('p');
      const style = getComputedStyle(note);
      const centering = [...document.querySelectorAll('#scan-grade-range .scan-score')]
        .find((cell) => cell.querySelector('span')?.textContent === 'Centering');
      const corners = [...document.querySelectorAll('#scan-grade-range .scan-score')]
        .find((cell) => cell.querySelector('span')?.textContent === 'Corners');
      const row = document.querySelector('#scan-history-list .scan-history-row');
      const historyNote = row.querySelector('.scan-history-note');
      const noteStyle = getComputedStyle(historyNote);
      const heroCanvas = document.querySelector('#scan-hero-art canvas');
      const pixel = heroCanvas.getContext('2d').getImageData(90, 130, 1, 1).data;
      const label = document.querySelector('#scan-session .scan-switch span').getBoundingClientRect();
      const knob = document.getElementById('scan-session-sound').getBoundingClientRect();
      const next = document.getElementById('scan-next-card').getBoundingClientRect();
      const retake = document.getElementById('scan-retake-main').getBoundingClientRect();
      const tabs = document.getElementById('scan-tabs').getBoundingClientRect();
      const scroller = document.querySelector('.scan-panel-scroll');
      return {
        explanation: note.textContent,
        whyLabel: why.querySelector('summary').textContent,
        whyClosed: why.open === false,
        fontSize: parseFloat(style.fontSize),
        fontWeight: parseInt(style.fontWeight, 10) || 400,
        chips: [...document.querySelectorAll('#scan-grade-range .scan-chip')].map((chip) => chip.textContent),
        centeringValue: centering.querySelector('b').textContent,
        centeringHint: centering.querySelector('small')?.textContent || '',
        centeringRaw: centering.textContent,
        cornersValue: corners.querySelector('b').textContent,
        cornersBar: corners.querySelector('i').style.width,
        heroPixel: [pixel[0], pixel[1], pixel[2]],
        priceCta: document.getElementById('scan-confirm-price')?.textContent || '',
        identifyHidden: document.getElementById('scan-identify').hidden,
        when: row.querySelector('time').textContent,
        name: row.querySelector('strong').textContent,
        status: row.querySelector('.scan-chip').textContent,
        hasThumb: !!row.querySelector('canvas'),
        noteNowrap: noteStyle.whiteSpace === 'nowrap',
        noteOverflow: noteStyle.textOverflow,
        noteOneLine: noteStyle.whiteSpace === 'nowrap' && historyNote.scrollHeight <= noteStyle.lineHeight.replace('px', '') * 1.6 + 2,
        switchOnRight: knob.left > label.right - 4,
        soundLabel: document.querySelector('#scan-session .scan-switch').textContent,
        soundHint: document.querySelector('#scan-session .note').textContent,
        scrollTop: scroller.scrollTop,
        actionsAboveTabs: next.top >= 0 && next.bottom <= tabs.top + 1 && retake.bottom <= tabs.top + 1 && next.bottom <= window.innerHeight,
      };
    });
    assert.match(facts.explanation, /Estimate unavailable — retake required\.\s+\S/);
    assert.match(facts.explanation, /Low confidence\./);
    assert.match(facts.explanation, /Centering is not measured\./);
    assert.doesNotMatch(facts.explanation, /required Low|required Limited|required This/);
    assert.equal(facts.whyLabel, 'Why?');
    assert.equal(facts.whyClosed, true);
    assert.ok(facts.fontSize >= 14 && facts.fontSize <= 15.5, `font ${facts.fontSize}`);
    assert.ok(facts.fontWeight < 650, `weight ${facts.fontWeight}`);
    assert.ok(facts.chips.includes('Retake needed'));
    assert.ok(facts.chips.includes('Low confidence') || facts.chips.includes('Limited confidence'));
    assert.equal(facts.centeringValue, '—');
    assert.equal(facts.centeringHint, 'Not measured');
    assert.doesNotMatch(facts.centeringRaw, /Centering: not measured/);
    assert.match(facts.cornersValue, /^\d+$/, facts.cornersValue);
    assert.notEqual(facts.cornersBar, '0%');
    assert.ok(Math.abs(facts.heroPixel[0] - 200) < 8 && Math.abs(facts.heroPixel[1] - 194) < 8, facts.heroPixel.join(','));
    assert.equal(facts.priceCta, 'Confirm card to see price');
    assert.equal(facts.identifyHidden, true);
    assert.match(facts.when, /^Today /);
    assert.doesNotMatch(facts.when, /\d{1,2}\/\d{1,2}\/\d{4}/);
    assert.doesNotMatch(facts.when, /:\d{2}:\d{2}/);
    assert.equal(facts.name, 'Unnamed card');
    assert.equal(facts.status, 'Retake needed');
    assert.equal(facts.hasThumb, true);
    assert.equal(facts.noteNowrap, true);
    assert.equal(facts.noteOverflow, 'ellipsis');
    assert.equal(facts.switchOnRight, true);
    assert.match(facts.soundLabel, /Sound on confirm/);
    assert.match(facts.soundHint, /Off by default/);
    assert.match(facts.soundHint, /Nothing is uploaded/);
    assert.equal(facts.scrollTop, 0);
    assert.equal(facts.actionsAboveTabs, true);
    await page.locator('#scan-confirm-price').click();
    await page.waitForFunction(() => document.getElementById('scan-identify').hidden === false);
    assert.equal(await page.locator('#scan-search').isVisible(), true);
    await page.locator('#scan-identify-close').click();
    await page.waitForFunction(() => document.getElementById('scan-identify').hidden === true);
  } finally {
    await browser.close();
    server.close();
  }
});
