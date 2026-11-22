/**
 * The store build uses a native camera preview.
 * The browser camera is only the preview fallback, and a frame is not uploaded.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';
import { captureKind, startNativePreview } from '../camera-source.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('native preview wins, and the browser camera is the fallback', () => {
  const web = { navigator: { mediaDevices: { getUserMedia() {} } } };
  assert.equal(captureKind(web), 'web');
  assert.equal(captureKind({}), 'none');
  const native = {
    Capacitor: { Plugins: { CameraPreview: { start() {}, capture() {} } } },
    navigator: { mediaDevices: { getUserMedia() {} } },
  };
  assert.equal(captureKind(native), 'native');
});

test('native start keeps the frame in memory and off the gallery', async () => {
  const calls = [];
  const scope = {
    Capacitor: {
      Plugins: {
        CameraPreview: {
          start(options) { calls.push(['start', options]); },
          capture(options) { calls.push(['capture', options]); return { value: 'abc' }; },
          stop() { calls.push(['stop']); },
        },
      },
    },
  };
  const source = await startNativePreview(scope, 'environment');
  assert.equal(source.kind, 'native');
  assert.equal(calls[0][1].toBack, true);
  assert.equal(calls[0][1].storeToFile, false);
  assert.equal(calls[0][1].saveToGallery, false);
  assert.equal(calls[0][1].position, 'rear');
  assert.equal(await source.capture(), 'abc');
  assert.equal(calls[1][1].saveToGallery, false);
  await source.stop();
  const src = fs.readFileSync(path.join(root, 'scan/camera-source.js'), 'utf8');
  assert.equal(src.includes('fetch('), false);
  assert.equal(src.includes('upload'), true);
});
