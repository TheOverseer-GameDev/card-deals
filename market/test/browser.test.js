import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((item) => fs.existsSync(item));
const out = '/tmp/market-shots';
fs.mkdirSync(out, { recursive: true });

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const type = pathname.endsWith('.js') ? 'text/javascript'
      : pathname.endsWith('.css') ? 'text/css'
      : pathname.endsWith('.svg') ? 'image/svg+xml'
      : pathname.endsWith('.png') ? 'image/png'
      : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shot(page, name) {
  fs.writeFileSync(path.join(out, name), await page.screenshot({ type: 'png' }));
}

test('market tab, mock trades, and unchanged list pixels', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await phone.newPage();
    await page.goto(base + '/');
    await page.waitForSelector('#v-ygo .c');
    const aboveNav = () => page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 400 } });
    const before = await aboveNav();
    const navTop = await page.evaluate(() => document.querySelector('nav').getBoundingClientRect().top);
    await page.evaluate(() => { document.querySelector('nav button[data-v="market"]').style.display = 'none'; });
    const after = await aboveNav();
    const navTopHidden = await page.evaluate(() => document.querySelector('nav').getBoundingClientRect().top);
    assert.equal(navTop, navTopHidden);
    assert.equal(Buffer.compare(before, after), 0);
    await page.evaluate(() => { document.querySelector('nav button[data-v="market"]').style.display = ''; });
    await page.locator('nav button[data-v="market"]').click();
    await page.waitForSelector('#v-market.on');
    assert.match(await page.locator('#v-market').innerText(), /Market not connected yet/);
    assert.doesNotMatch(await page.locator('#v-market').innerText(), /Test data/);
    await shot(page, 'phone-market-offline.png');
    const fit = await page.evaluate(() => {
      const nav = document.querySelector('nav').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('nav button')].map((button) => {
        const r = button.getBoundingClientRect();
        return { text: button.innerText, inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 20 && r.bottom <= window.innerHeight + 1 };
      });
      return { height: nav.height, buttons };
    });
    assert.ok(fit.height < 72, JSON.stringify(fit));
    for (const button of fit.buttons) assert.equal(button.inside, true, JSON.stringify(button));
    await phone.close();

    const land = await browser.newContext({ viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const landPage = await land.newPage();
    await landPage.goto(base + '/');
    const landFit = await landPage.evaluate(() => [...document.querySelectorAll('nav button')].every((button) => {
      const r = button.getBoundingClientRect();
      return r.width > 20 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
    }));
    assert.equal(landFit, true);
    await land.close();

    const desk = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    const wide = await desk.newPage();
    await wide.goto(base + '/');
    const client = await desk.newCDPSession(wide);
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await wide.locator('nav button[data-v="market"]').click();
    await wide.waitForSelector('#v-market.on');
    const wideFit = await wide.evaluate(() => {
      const vv = visualViewport;
      return [...document.querySelectorAll('nav button')].every((button) => {
        const r = button.getBoundingClientRect();
        return r.width > 8 && r.left >= vv.offsetLeft - 1 && r.right <= vv.offsetLeft + vv.width + 1 && r.bottom <= vv.offsetTop + vv.height + 1;
      });
    });
    assert.equal(wideFit, true);
    const frame = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 's22-market-offline.png'), Buffer.from(frame.data, 'base64'));
    await desk.close();

    const mock = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const trade = await mock.newPage();
    await trade.goto(base + '/market/test/harness.html');
    await trade.waitForFunction(() => window.__memory && window.__mount);
    await trade.evaluate(async () => {
      const memory = window.__memory;
      memory.dispatch({ type: 'sign', user: { id: 's', name: 'Test Seller' } });
      memory.dispatch({ type: 'handles', interac: 'seller@example.com', paypal: 'testseller' });
      memory.dispatch({ type: 'list', name: '<img src=x onerror=alert(1)>', game: 'ygo', setCode: 'LOB-005', askCad: 12, estimateNote: 'Saved guide: USD 5.00. CAD estimate unavailable.' });
      memory.dispatch({ type: 'sign', user: { id: 'b', name: 'Test Buyer' } });
      await window.__mount([
        { id: 's', name: 'Test Seller' },
        { id: 'b', name: 'Test Buyer' },
        { id: 'o', name: 'Test Other' },
      ]);
    });
    await trade.waitForSelector('.m-card');
    assert.equal(await trade.locator('.m-card img').count(), 0);
    assert.match(await trade.locator('.m-card h3').innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await trade.locator('#market-handles').count(), 0);
    await shot(trade, 'phone-market-feed.png');
    await trade.getByRole('button', { name: 'Make Offer', exact: true }).click();
    await shot(trade, 'phone-market-offer.png');
    await trade.locator('#market-offer-amount').fill('8');
    await trade.locator('#market-make-offer').click();
    await trade.selectOption('#market-test-user', 's');
    await trade.locator('#market-counter').fill('10');
    await trade.getByRole('button', { name: 'Counter', exact: true }).click();
    await trade.selectOption('#market-test-user', 'b');
    await trade.getByRole('button', { name: 'Accept', exact: true }).click();
    await trade.waitForSelector('#market-handles');
    assert.match(await trade.locator('#market-handles').innerText(), /seller@example.com/);
    await shot(trade, 'phone-market-settlement.png');
    await trade.selectOption('#market-test-user', 'o');
    assert.equal(await trade.locator('#market-handles').count(), 0);
    assert.doesNotMatch(await trade.locator('#v-market').innerText(), /seller@example.com/);
    await trade.selectOption('#market-test-user', 'b');
    await trade.getByRole('button', { name: 'Mark paid', exact: true }).click();
    await trade.selectOption('#market-test-user', 's');
    await trade.getByRole('button', { name: 'Confirm received', exact: true }).click();
    await trade.selectOption('#market-test-user', 'b');
    await trade.locator('#market-stars').selectOption('5');
    await trade.getByRole('button', { name: 'Save rating', exact: true }).click();
    await trade.locator('#market-report-reason').fill('Wrong card');
    await trade.getByRole('button', { name: 'Report', exact: true }).click();
    const saved = await trade.evaluate(() => window.__memory.view());
    assert.equal(saved.trades[0].offer.status, 'received');
    await trade.getByRole('button', { name: 'Sell Card', exact: true }).click();
    await shot(trade, 'phone-market-sell.png');
    await mock.close();

    const mockWide = await browser.newContext({
      viewport: { width: 980, height: 2178 },
      screen: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      serviceWorkers: 'block',
    });
    const wideTrade = await mockWide.newPage();
    await wideTrade.goto(base + '/market/test/harness.html');
    await wideTrade.waitForFunction(() => window.__mount);
    const wideClient = await mockWide.newCDPSession(wideTrade);
    await wideClient.send('Emulation.setPageScaleFactor', { pageScaleFactor: 980 / 360 });
    await wideTrade.evaluate(async () => {
      const memory = window.__memory;
      memory.dispatch({ type: 'sign', user: { id: 's', name: 'Test Seller' } });
      memory.dispatch({ type: 'list', name: 'Test Magician', game: 'ygo', askCad: 12 });
      memory.dispatch({ type: 'sign', user: { id: 'b', name: 'Test Buyer' } });
      await window.__mount([{ id: 's', name: 'Test Seller' }, { id: 'b', name: 'Test Buyer' }]);
    });
    await wideTrade.waitForSelector('.m-card');
    for (const [name, selector] of [['s22-market-feed.png', '.m-card'], ['s22-market-offer.png', 'offer']]) {
      if (selector === 'offer') await wideTrade.getByRole('button', { name: 'Make Offer', exact: true }).evaluate((node) => node.click());
      const png = await wideClient.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, name), Buffer.from(png.data, 'base64'));
    }
    await wideTrade.locator('#market-buy-now').evaluate((node) => node.click());
    await wideTrade.waitForSelector('#market-settlement');
    const settled = await wideClient.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 's22-market-settlement.png'), Buffer.from(settled.data, 'base64'));
    await wideTrade.getByRole('button', { name: 'Sell Card', exact: true }).evaluate((node) => node.click());
    const sell = await wideClient.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, 's22-market-sell.png'), Buffer.from(sell.data, 'base64'));
    await mockWide.close();
  } finally {
    await browser.close();
    server.close();
  }
});
