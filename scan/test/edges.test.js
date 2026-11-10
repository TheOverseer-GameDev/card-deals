import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSide } from '../edges.js';

function sheet(paint) {
  const width = 500;
  const height = 700;
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
  return { rgba, width, height };
}

test('a plain straightened card has eight crops and does not invent damage', () => {
  const photo = sheet(() => [168, 164, 156]);
  const report = inspectSide(photo.rgba, photo.width, photo.height, 'front');
  assert.equal(report.crops.length, 8);
  assert.equal(report.crops.filter((crop) => crop.kind === 'corner').length, 4);
  assert.equal(report.crops.filter((crop) => crop.kind === 'edge').length, 4);
  assert.ok(report.crops.every((crop) => crop.flag === 'clear'), report.crops.map((crop) => crop.flag).join(','));
  assert.match(report.note, /cannot guarantee a grade/);
});

test('a rounded corner, a nicked edge, and a dark photo are labelled separately', () => {
  const rounded = sheet((x, y) => {
    const dx = x;
    const dy = y;
    return Math.hypot(dx, dy) < 28 ? [250, 250, 250] : [150, 146, 140];
  });
  const corner = inspectSide(rounded.rgba, rounded.width, rounded.height, 'front').crops.find((crop) => crop.id === 'front-corner-tl');
  assert.equal(corner.flag, 'rounding', corner.text);

  const nicked = sheet((x, y) => (y < 8 && x > 180 && x < 210 ? [20, 20, 20] : [150, 146, 140]));
  const edge = inspectSide(nicked.rgba, nicked.width, nicked.height, 'back').crops.find((crop) => crop.id === 'back-edge-top');
  assert.equal(edge.flag, 'ding', edge.text);

  const dark = inspectSide(sheet(() => [12, 12, 12]).rgba, 500, 700, 'front');
  assert.equal(dark.crops.every((crop) => crop.trusted === false), true);
  assert.match(dark.note, /too poor to trust/);
  const tilted = inspectSide(new Uint8ClampedArray(10), 20, 30, 'front');
  assert.equal(tilted.crops.length, 0);
  assert.match(tilted.note, /not straightened/);
});
