import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTilt } from '../tilt.js';

function paint(width, height, fn) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height };
}

test('one photo is not compared and two copies of it are too similar', () => {
  const flat = paint(80, 110, () => 140);
  assert.equal(compareTilt([flat]).status, 'need-more');
  const same = compareTilt([flat, paint(80, 110, () => 180)]);
  assert.equal(same.status, 'too-similar');
  assert.equal(same.findings.length, 0);
});

test('a bright line that appears at a second angle is flagged without calling it certain', () => {
  const flat = paint(80, 110, () => 120);
  const angled = paint(80, 110, (x, y) => (y > 40 && y < 48 ? 230 : 120));
  const report = compareTilt([flat, angled]);
  assert.equal(report.status, 'marked');
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0].text, /cannot/);
  assert.ok(report.box.w > 0 && report.box.h > 0);
});
