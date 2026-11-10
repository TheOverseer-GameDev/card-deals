/**
 * An offline Scan screen can only open modules the service worker stored.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('the publisher writes that same scan list', () => {
  const files = fs.readdirSync(path.join(root, 'scan')).filter((name) => /\.(js|css|json)$/.test(name));
  const out = spawnSync('python3', ['-c', [
    'import importlib.util',
    'spec = importlib.util.spec_from_file_location("build", "ops/deploy/card_app/build.py")',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'print("\\n".join(mod.precache_files()))',
  ].join('\n')], { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const listed = new Set(out.stdout.trim().split('\n'));
  for (const name of files) {
    assert.equal(listed.has(`scan/${name}`), true, `build.py does not precache scan/${name}`);
  }
  assert.equal([...listed].some((item) => item.includes('scan/vendor') || item.includes('scan/market')), false);
});

test('the service worker file the publisher writes lists those modules', () => {
  const dest = path.join(fs.mkdtempSync(path.join('/tmp', 'cd-sw-')), 'sw.js');
  const out = spawnSync('python3', ['-c', [
    'import importlib.util, json, os',
    'spec = importlib.util.spec_from_file_location("build", "ops/deploy/card_app/build.py")',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'text = mod.SW.replace("__V__", "ci").replace("__FILES__", json.dumps(mod.precache_files(), separators=(",", ":")))',
    'open(os.environ["OUT"], "w").write(text)',
  ].join('\n')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, OUT: dest },
  });
  assert.equal(out.status, 0, out.stderr);
  const sw = fs.readFileSync(dest, 'utf8');
  const files = fs.readdirSync(path.join(root, 'scan')).filter((name) => /\.(js|css|json)$/.test(name));
  for (const name of files) {
    assert.equal(sw.includes(`scan/${name}`), true, `built sw.js does not precache scan/${name}`);
  }
});
