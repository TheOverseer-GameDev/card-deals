import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const lib = fileURLToPath(new URL('../lib/', import.meta.url));

test('bench image helpers do not import the scanner', () => {
  for (const name of fs.readdirSync(lib)) {
    const text = fs.readFileSync(path.join(lib, name), 'utf8');
    assert.equal(/from ['"][^'"]*scan\//.test(text), false, name);
  }
});

test('bench tests do not skip', () => {
  const dir = fileURLToPath(new URL('./', import.meta.url));
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(/\{\s*skip\b/.test(text), false, name);
  }
});
