/**
 * Live prompts stay plain, and a bad frame is not called ready.
 * M10 counts false lined-up frames. M11 is the analyze time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { judgePreview } from '../detect.js';
import { recipes } from '../../bench/recipes/sealed.mjs';
import { labelFromParams } from '../../bench/label.mjs';
import { render } from '../../bench/procedural/render.mjs';
import { current } from '../../bench/subjects/current.mjs';

function paint(width, height, box, color = [214, 208, 196]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      const [r, g, b] = inside ? color : [16, 18, 22];
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('bad live frames are not called ready', () => {
  const width = 240;
  const height = 320;
  const bad = [];
  for (let i = 0; i < 56; i += 1) {
    bad.push(paint(width, height, { x: 88 + (i % 5), y: 108, w: 36 + (i % 6), h: 54 }));
    bad.push(paint(width, height, { x: 1, y: 1, w: 236, h: 316 }));
  }
  for (let i = 0; i < 40; i += 1) bad.push(paint(width, height, { x: 50, y: 40, w: 140, h: 210 }, [255, 255, 255]));
  for (let i = 0; i < 32; i += 1) bad.push(paint(width, height, { x: 50, y: 40, w: 140, h: 210 }, [8, 8, 8]));
  for (let i = 0; i < 51; i += 1) bad.push(paint(width, height, { x: 70, y: 90, w: 70, h: 90 }));
  assert.ok(bad.length >= 112 + 123, `frames ${bad.length}`);
  let falseReady = 0;
  for (const frame of bad) {
    const view = judgePreview(frame, width, height);
    if (view.code === 'lined-up') falseReady += 1;
    assert.match(view.hint, /Move closer|Reduce glare|Show all four edges|Hold still|Add light/);
  }
  assert.ok(falseReady <= 15, `false lined-up ${falseReady}`);
  console.log(JSON.stringify({ frames: bad.length, falseReady }));
  const ready = judgePreview(paint(width, height, { x: 48, y: 36, w: 144, h: 220 }), width, height);
  assert.equal(ready.code, 'lined-up');
  assert.equal(ready.hint, 'Hold still.');
});

test('analyze stays under 80 ms at the 95th percentile', () => {
  const times = [];
  for (const params of recipes('ci', 1)) {
    const label = labelFromParams(params);
    times.push(current(label, render(label, params)).ms);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(0.95 * times.length) - 1];
  assert.ok(p95 <= 80, `p95 ${p95}`);
});
