import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checksum } from './lib/image.mjs';
import { sha256 } from './lib/rng.mjs';
import { labelFromParams } from './label.mjs';
import { recipes } from './recipes/sealed.mjs';
import { render } from './procedural/render.mjs';
import { loadSpec, scoreCases, discriminate } from './score/score.mjs';
import { diffMarkdown } from './report.mjs';
import { legacyProbes } from './probes/legacy.mjs';
import { current } from './subjects/current.mjs';
import { honest } from './subjects/honest.mjs';
import { alwaysOk, always5050 } from './subjects/canary.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const specFile = path.join(root, 'bench/spec.json');

const SUBJECTS = {
  current: (label, rgba) => current(label, rgba),
  honest: (label) => honest(label),
  'always-ok': () => alwaysOk(),
  'always-5050': () => always5050(),
};

export function runBench(options) {
  const mode = options.mode || 'quick';
  const seed = options.seed ?? 1;
  const subjectName = options.subject || 'current';
  const subject = SUBJECTS[subjectName];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `scan-bench-${process.pid}-`));
  try {
    const { spec, hash } = loadSpec(specFile);
    const params = recipes(mode, seed);
    const labels = params.map((item) => labelFromParams(item));
    const cases = [];
    const sums = [];
    for (let i = 0; i < labels.length; i += 1) {
      const rgba = render(labels[i], params[i]);
      sums.push(checksum(rgba));
      cases.push({ label: labels[i], report: subject(labels[i], rgba) });
    }
    const again = sha256(JSON.stringify(params.map((item) => labelFromParams(item))));
    const pixel = checksum(render(labels[0], params[0]));
    const mismatches = (again === sha256(JSON.stringify(labels)) ? 0 : 1) + (pixel === sums[0] ? 0 : 1);
    const probes = subjectName === 'current' ? legacyProbes() : { M5: 0, M13: 0, M14: 0, M15: 0, M16: 0, M17: 0, M18: 0, M18b: 0, M20: 0 };
    probes.M19 = mismatches;
    const metrics = scoreCases(cases, probes, spec);
    const determinism = sha256(JSON.stringify(labels) + sums.join(','));
    const truth = sha256(JSON.stringify(labels));
    return { spec, specHash: hash, metrics, determinism, truth, labels, tmp };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = { mode: 'quick', split: 'dev', seed: 1, subject: 'current', writeBaseline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--write-baseline') out.writeBaseline = true;
    else if (key.startsWith('--')) out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    if (key.startsWith('--') && key !== '--write-baseline') i += 1;
  }
  out.seed = Number(out.seed);
  return out;
}

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function writeReport(result, phase) {
  const outDir = path.join(root, 'bench/out');
  fs.mkdirSync(outDir, { recursive: true });
  const head = git('git rev-parse --short HEAD');
  const parent = git('git rev-parse --short HEAD~1');
  const baselinePath = path.join(root, 'bench/baseline.json');
  let baseline = {};
  if (fs.existsSync(baselinePath)) baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const prev = {};
  for (const [id, row] of Object.entries(baseline.metrics || {})) prev[id] = row.value;
  const verdict = Object.values(result.metrics).every((row) => row.pass) ? 'PASS' : 'FAIL';
  const honestRun = runBench({ mode: 'quick', seed: 1, subject: 'honest' });
  const canaryRun = runBench({ mode: 'quick', seed: 1, subject: 'always-5050' });
  const nondiscriminating = discriminate(honestRun.metrics, canaryRun.metrics).length;
  result.metrics.E15.value = nondiscriminating;
  result.metrics.E15.n = 3;
  result.metrics.E15.pass = nondiscriminating === 0;
  const info = {
    head,
    parent,
    phase,
    specHash: result.specHash,
    baselineHash: sha256(fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : ''),
    truthHash: result.truth,
    determinism: result.determinism,
    verdict: Object.values(result.metrics).every((row) => row.pass) ? 'PASS' : 'FAIL',
    metrics: result.metrics,
    prev,
    nondiscriminating,
    specDiff: 'none',
  };
  void verdict;
  const numbers = {
    head,
    phase,
    specHash: result.specHash,
    determinism: result.determinism,
    truth: result.truth,
    nondiscriminating,
    metrics: Object.fromEntries(Object.entries(result.metrics).map(([id, row]) => [id, {
      value: row.value,
      n: row.n,
      pass: row.pass,
      cases: row.cases || [],
    }])),
  };
  fs.writeFileSync(path.join(outDir, 'numbers.json'), JSON.stringify(numbers));
  fs.writeFileSync(path.join(outDir, 'diff.md'), diffMarkdown(info));
  fs.mkdirSync(path.join(root, 'bench/truth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bench/truth/manifest.json'), JSON.stringify({ hash: result.truth, cases: result.labels.length }));
  return info;
}

const invoked = process.argv[1] && process.argv[1].endsWith('run.mjs');
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  const result = runBench(args);
  const info = writeReport(result, '0');
  if (args.writeBaseline) {
    const baseline = {
      head: git('git rev-parse HEAD'),
      specHash: result.specHash,
      metrics: Object.fromEntries(Object.entries(result.metrics).map(([id, row]) => [id, { value: row.value, n: row.n }])),
    };
    fs.writeFileSync(path.join(root, 'bench/baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  }
  process.stdout.write(fs.readFileSync(path.join(root, 'bench/out/diff.md'), 'utf8'));
  if (info.nondiscriminating > 0) process.exitCode = 1;
}
