import assert from 'node:assert/strict';
import test from 'node:test';
import { matchArtwork } from '../artmatch.js';

function picture(width, height, fn) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = 255 - v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('the same artwork matches and a different picture does not', () => {
  const art = picture(80, 112, (x) => Math.round(255 * x / 80));
  const same = matchArtwork(art, 80, 112, art, 80, 112);
  assert.equal(same.state, 'similar', JSON.stringify(same));
  assert.match(same.note, /not proof/);
  const other = picture(80, 112, (x, y) => Math.round(255 * y / 112));
  const different = matchArtwork(art, 80, 112, other, 80, 112);
  assert.notEqual(different.state, 'similar');
  const missing = matchArtwork(art, 80, 112, null, 0, 0);
  assert.equal(missing.state, 'unavailable');
});
