import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceHold, judgePreview, quadShift } from '../detect.js';

function fill(width, height, paint) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function card(width, height, box, color = [214, 208, 196]) {
  return fill(width, height, (x, y) => {
    const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    return inside ? color : [16, 18, 22];
  });
}

test('a centered card is lined up and a dark frame is too dark', () => {
  const width = 240;
  const height = 320;
  const ready = judgePreview(card(width, height, { x: 50, y: 40, w: 140, h: 220 }), width, height);
  assert.equal(ready.code, 'lined-up', JSON.stringify(ready));
  assert.equal(ready.ready, true);
  assert.equal(ready.quad.length, 4);
  const dark = judgePreview(fill(width, height, () => [8, 8, 8]), width, height);
  assert.equal(dark.code, 'too-dark');
  assert.equal(dark.ready, false);
});

test('distance and glare are named instead of treated as lined up', () => {
  const width = 240;
  const height = 320;
  const far = judgePreview(card(width, height, { x: 100, y: 130, w: 40, h: 60 }), width, height);
  assert.equal(far.code, 'too-far', JSON.stringify(far));
  const close = judgePreview(card(width, height, { x: 2, y: 2, w: 236, h: 316 }), width, height);
  assert.equal(close.code, 'too-close', JSON.stringify(close));
  const glare = judgePreview(card(width, height, { x: 50, y: 40, w: 140, h: 220 }, [255, 255, 255]), width, height);
  assert.equal(glare.code, 'too-glary', JSON.stringify(glare));
});

test('auto-capture waits through the steady window and resets when the card jumps', () => {
  const quad = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
  const ready = { ready: true, quad };
  let hold = advanceHold(null, ready, 1000);
  assert.equal(hold.fire, false);
  assert.equal(hold.progress, 0);
  hold = advanceHold(hold, ready, 1000 + 699);
  assert.equal(hold.fire, false);
  assert.ok(hold.progress > 0.9 && hold.progress < 1);
  hold = advanceHold(hold, ready, 1000 + 700);
  assert.equal(hold.fire, true);
  assert.equal(hold.progress, 1);
  const jumped = { ready: true, quad: quad.map((p) => ({ x: p.x + 30, y: p.y })) };
  const reset = advanceHold(hold, jumped, 2000);
  assert.equal(reset.fire, false);
  assert.equal(reset.progress, 0);
  const lost = advanceHold(hold, { ready: false, quad: null }, 2000);
  assert.equal(lost.since, null);
  assert.ok(quadShift(quad, quad) === 0);
});
