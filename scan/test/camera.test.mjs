import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';

const boot = fs.readFileSync(new URL('../boot.js', import.meta.url), 'utf8');

test('v2 hid the camera list by waiting for the shutter and never enumerating devices', () => {
  assert.match(boot, /enumerateDevices/);
  assert.match(boot, /id = 'scan-camera'/);
  assert.match(boot, /facing:environment/);
  assert.match(boot, /Rear 1×/);
  assert.match(boot, /openCamera\(activeSlot\(\)\)/);
  assert.match(boot, /card-scan-camera/);
  assert.match(boot, /ui\.video\.hidden = false/);
});
