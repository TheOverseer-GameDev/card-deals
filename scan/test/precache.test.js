/**
 * An offline Scan screen can only open modules the service worker stored.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the service worker precaches every scan module', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/scan\/[A-Za-z0-9._-]+/g)].map((match) => match[0]));
  const files = fs.readdirSync(path.join(root, 'scan')).filter((name) => /\.(js|css|json)$/.test(name));
  assert.ok(files.length >= 15, `scan modules found ${files.length}`);
  for (const name of files) {
    assert.equal(listed.has(`scan/${name}`), true, `sw.js does not precache scan/${name}`);
  }
});
