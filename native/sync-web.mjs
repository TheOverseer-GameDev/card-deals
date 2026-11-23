/**
 * Copy this app into www/ for the Capacitor webDir.
 * The native project loads these files. It does not point at the hosted site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'www');

function fromPrecache() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const list = sw.match(/F=\[(.*?)\]/);
  if (!list) throw new Error('sw.js has no precache list');
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((item) => item !== './');
}

function walk(dir) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (fs.statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(rel);
  }
  return found;
}

const files = new Set(fromPrecache());
if (fs.existsSync(path.join(root, 'scan/vendor'))) {
  for (const rel of walk(path.join(root, 'scan/vendor'))) files.add(rel);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const rel of files) {
  const from = path.join(root, rel);
  if (!from.startsWith(root) || !fs.existsSync(from) || fs.statSync(from).isDirectory()) {
    throw new Error(`Missing app file ${rel}`);
  }
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}
fs.writeFileSync(path.join(out, '.gitkeep'), '');
console.log(`copied ${files.size} app files into www/`);
