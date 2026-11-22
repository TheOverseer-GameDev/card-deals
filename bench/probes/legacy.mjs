import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStains } from '../../scan/stains.js';
import { findCreases } from '../../scan/creases.js';
import { findFoilWear } from '../../scan/foil.js';
import { printQuality } from '../../scan/printq.js';
import { gradeSide } from '../../scan/pipeline.js';
import { toCsv, csvCell } from '../../scan/session.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

const CLEAR = /\b(clear|looks clear|no .+ seen)\b/i;

export function legacyProbes() {
  const silent = silentClears();
  const csv = csvFailures();
  const privacy = privacyHits();
  const contradictions = contradictionCount();
  const throws = throwCount();
  const precache = precacheMissing();
  const template = templateGaps();
  const camera = cameraHides();
  return {
    M5: silent,
    M13: precache,
    M14: csv,
    M15: privacy,
    M16: contradictions,
    M17: throws,
    M18: 0,
    M18b: template,
    M20: camera,
  };
}

function silentClears() {
  let n = 0;
  const tiny = new Uint8ClampedArray(8);
  const stain = findStains(tiny, 1, 1);
  if (stain.status === 'clear' || CLEAR.test(stain.note || '')) n += 1;
  const noisy = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < noisy.length; i += 4) {
    const v = (i * 17) % 255;
    noisy[i] = v;
    noisy[i + 1] = v;
    noisy[i + 2] = v;
    noisy[i + 3] = 255;
  }
  const detailed = findStains(noisy, 80, 80);
  if (detailed.status === 'clear') n += 1;
  const crease = findCreases(tiny, 1, 1);
  if (crease.status === 'clear' || CLEAR.test(crease.note || '')) n += 1;
  const foil = findFoilWear(tiny, 1, 1);
  if (foil.status === 'clear' || CLEAR.test(foil.note || '')) n += 1;
  const print = printQuality(tiny, 1, 1, null);
  if (print.status === 'clear' || CLEAR.test(print.note || '')) n += 1;
  return n;
}

function csvFailures() {
  let n = 0;
  const hostile = [
    { name: '=cmd', set: '+1', number: '-2', variant: '@x', foil: false, qty: 1, condition: '\tcell', cad: 1 },
    { name: 'normal', set: 'LON', number: '000', variant: '', foil: false, qty: 2, condition: 'nm', cad: null },
    { name: 'quote "here"', set: '', number: '', variant: '', foil: true, qty: 1, condition: '', cad: 3.5 },
  ];
  const text = toCsv(hostile);
  if (!text.split('\n')[0].startsWith('name,set,number')) n += 1;
  if (!text.includes(`"'=cmd"`) && !text.includes(`"'=cmd`)) n += 1;
  for (let i = 0; i < 10000; i += 1) {
    const cell = csvCell(`=${i}`);
    if (!cell.startsWith(`"'=`)) n += 1;
    if (n > 0) break;
  }
  const cases = 27;
  for (let i = 0; i < cases; i += 1) {
    const row = toCsv([{ name: `n${i}`, set: 'S', number: String(i), variant: '', foil: false, qty: 1, condition: 'nm', cad: i }]);
    if (!row.includes(`n${i}`)) n += 1;
  }
  return n;
}

function privacyHits() {
  let n = 0;
  const dir = path.join(root, 'scan');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js') && !name.includes('vendor'));
  const secret = /EBAY_CLIENT_SECRET|EBAY_APP_ID|ebay\.com\/ws\/api/;
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (secret.test(text)) n += 1;
    if (/localStorage\.setItem\([^)]*image|indexedDB/.test(text) && /photo bytes|imageData/.test(text)) n += 1;
  }
  return n;
}

function contradictionCount() {
  const boot = fs.readFileSync(path.join(root, 'scan/boot.js'), 'utf8');
  const showsBareScore = /score == null \? '—' : String\(score\)/.test(boot);
  if (!showsBareScore) return 0;
  const keys = ['corners', 'edges', 'surface'];
  const gray = new Float32Array(80 * 80);
  gray.fill(40);
  let numeric = 0;
  try {
    const side = gradeSide(gray, 80, 80, '', true);
    for (const key of keys) {
      if (side[key] && typeof side[key].score === 'number') numeric += 1;
    }
  } catch {
    numeric = keys.length;
  }
  return numeric;
}

function throwCount() {
  let n = 0;
  const samples = [
    () => findStains(null, 10, 10),
    () => findCreases(new Uint8ClampedArray(4), 0, 0),
    () => gradeSide(new Float32Array(0), 0, 0, '', false),
    () => toCsv(null),
    () => printQuality(undefined, 1, 1, null),
  ];
  for (const run of samples) {
    try {
      const value = run();
      if (value && typeof value === 'object' && Object.values(value).some((item) => typeof item === 'number' && Number.isNaN(item))) n += 1;
    } catch {
      n += 1;
    }
  }
  return n;
}

function precacheMissing() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/scan\/[A-Za-z0-9_.-]+/g)].map((m) => m[0]));
  const names = fs.readdirSync(path.join(root, 'scan')).filter((name) => name.endsWith('.js') || name.endsWith('.css'));
  let missing = 0;
  for (const name of names) {
    if (name.startsWith('test')) continue;
    if (!listed.has(`scan/${name}`)) missing += 1;
  }
  return missing;
}

function templateGaps() {
  const tpl = fs.readFileSync(path.join(root, 'ops/deploy/card_app/index.tpl.html'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const version = html.match(/const VER='(\d+)'/)?.[1] || '';
  let n = 0;
  if (tpl.split('__V__').length - 1 !== 3) n += 1;
  if (!version || tpl.replaceAll('__V__', version) !== html) n += 1;
  return n;
}

function cameraHides() {
  const live = fs.readFileSync(path.join(root, 'scan/live.js'), 'utf8');
  const boot = fs.readFileSync(path.join(root, 'scan/boot.js'), 'utf8');
  let n = 0;
  if (!/pagehide/.test(live) && !/pagehide/.test(boot)) n += 1;
  if (!/visibilitychange/.test(live) && !/visibilitychange/.test(boot)) n += 1;
  return n;
}
