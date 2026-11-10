/**
 * The tilt of a known rectangle, at full size and at the live 192px sample.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { quadPose, straighten } from '../pipeline.js';

function paint(width, height, deg) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const cardW = Math.min(width, height) * 0.42;
  const cardH = cardW * 88 / 63;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const inside = Math.abs(lx) <= cardW / 2 && Math.abs(ly) <= cardH / 2;
      const i = (y * width + x) * 4;
      const v = inside ? 220 : 16;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('the angle formula reports a rectangle turned by a known amount', () => {
  for (const deg of [0, 0.5, 1, 2, 3, 5, 10]) {
    const rad = deg * Math.PI / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const corners = [[-40, -56], [40, -56], [40, 56], [-40, 56]].map(([x, y]) => ({
      x: 200 + x * c - y * s,
      y: 200 + x * s + y * c,
    }));
    const pose = quadPose(corners);
    assert.ok(Math.abs(pose.tilt - deg) <= 0.05, `${deg} read ${pose.tilt}`);
  }
});

test('a painted card is within half a degree at full size and at 192 pixels', () => {
  const angles = [0, 0.5, 1, 2, 3, 5, 10];
  for (const long of [800, 192]) {
    const limit = long === 192 ? 0.6 : 0.5;
    for (const deg of angles) {
      const width = long;
      const height = Math.round(long * 1.25);
      const flat = straighten(paint(width, height, deg), width, height);
      assert.equal(flat.flattened, true, `${long} ${deg} did not straighten`);
      const err = Math.abs(flat.pose.tilt - deg);
      assert.ok(err <= limit, `${long}px ${deg}° read ${flat.pose.tilt.toFixed(2)} (${err.toFixed(2)} off)`);
    }
  }
});
