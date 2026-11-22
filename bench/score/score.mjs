import fs from 'node:fs';
import { sha256 } from '../lib/rng.mjs';

export function loadSpec(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { spec: JSON.parse(text), hash: sha256(text) };
}

export function scoreCases(cases, probes, spec) {
  const metrics = {};
  for (const row of spec.metrics) metrics[row.id] = { ...row, value: null, n: 0, pass: false, cases: [] };
  for (const [id, value] of Object.entries(probes || {})) {
    if (!metrics[id]) continue;
    metrics[id].value = value;
    metrics[id].n = 1;
  }
  centering(metrics, cases);
  geometry(metrics, cases);
  speed(metrics, cases);
  metrics.M19.value = metrics.M19.value ?? 0;
  metrics.M19.n = 1;
  for (const row of Object.values(metrics)) finish(row);
  return metrics;
}

export function ruleOfThree(value, n) {
  if (value !== 0 || !n) return null;
  return 3 / n;
}

function centering(metrics, cases) {
  let dangerous = 0;
  let valued = 0;
  let guided = 0;
  let guidedHit = 0;
  let guidedValue = 0;
  let ineligibleValue = 0;
  const ids = [];
  for (const item of cases) {
    const got = item.report && item.report.centering;
    const eligible = item.label.gate === 'ok' && item.label.pxPerMm >= 8 && Math.abs(item.label.tiltDeg) <= 3;
    if (got && got.state === 'ok' && Number.isFinite(got.lr)) {
      valued += 1;
      if (!eligible) {
        ineligibleValue += 1;
        ids.push(item.label.id);
      }
      const err = Math.abs(got.lr - item.label.centering.lr);
      if (err > 3) {
        dangerous += 1;
        ids.push(item.label.id);
      }
      if (item.label.family === 'G') {
        guidedValue += 1;
        if (err <= 2) guidedHit += 1;
      }
    }
    if (item.label.family === 'G') guided += 1;
  }
  metrics.M1.value = dangerous;
  metrics.M1.n = cases.length;
  metrics.M1.cases = ids.slice(0, 5);
  const coverage = guided ? guidedValue / guided : 0;
  const within = guidedValue ? guidedHit / guidedValue : 0;
  metrics.M2.value = within;
  metrics.M2.coverage = coverage;
  metrics.M2.n = guided;
  metrics.M2.passParts = coverage >= 0.5 && within >= 0.95 && guided > 0;
  metrics.M5b.value = ineligibleValue;
  metrics.M5b.n = cases.length;
}

function geometry(metrics, cases) {
  const errors = [];
  let invented = 0;
  let defectsMeasured = false;
  let threw = 0;
  const ids = [];
  for (const item of cases) {
    if (item.report && item.report.threw) {
      threw += 1;
      ids.push(item.label.id);
    }
    if (item.report && item.report.defectsMeasured) {
      defectsMeasured = true;
      if (item.report.defectInvented && item.label.defects.length === 0) invented += 1;
    }
    if (!item.report || !item.report.quad || item.label.gate !== 'ok') continue;
    const mm = cornerErrorMm(item.label.quad, item.report.quad, item.label.pxPerMm);
    if (Number.isFinite(mm)) errors.push(mm);
  }
  errors.sort((a, b) => a - b);
  metrics.M8.value = errors.length ? percentile(errors, 0.95) : null;
  metrics.M8.max = errors.length ? errors[errors.length - 1] : null;
  metrics.M8.n = errors.length;
  metrics.M8.cases = ids.slice(0, 5);
  metrics.M4.value = defectsMeasured ? invented : null;
  metrics.M4.n = defectsMeasured ? cases.length : 0;
  metrics.M17.value = (metrics.M17.value || 0) + threw;
  metrics.M17.n = cases.length;
}

function speed(metrics, cases) {
  const times = cases.map((item) => item.report && item.report.ms).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  metrics.M11.value = times.length ? percentile(times, 0.95) : null;
  metrics.M11.n = times.length;
}

function finish(row) {
  if (row.id === 'M2') {
    row.pass = Boolean(row.passParts) && row.n >= 1 && (row.minN ? row.n >= row.minN : true);
    return;
  }
  if (row.value == null) {
    row.pass = false;
    return;
  }
  const enough = row.minN ? row.n >= row.minN : true;
  const direction = row.better === 'higher' ? row.value >= row.bar : row.value <= row.bar;
  const maxOk = row.maxBar == null || row.max == null || row.max <= row.maxBar;
  row.pass = Boolean(direction && enough && maxOk);
  if (row.value === 0 && row.better === 'lower') row.bound = ruleOfThree(0, row.n || 1);
}

function cornerErrorMm(truth, got, pxPerMm) {
  if (!truth || !got || truth.length !== 4 || got.length !== 4 || !(pxPerMm > 0)) return NaN;
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const dx = truth[i].x - got[i].x;
    const dy = truth[i].y - got[i].y;
    sum += Math.hypot(dx, dy);
  }
  return (sum / 4) / pxPerMm;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(sorted[idx] * 1000) / 1000;
}

export function discriminate(honestMetrics, canaryMetrics) {
  const bad = [];
  for (const id of ['M1', 'M2', 'M5b']) {
    const honest = honestMetrics[id];
    const canary = canaryMetrics[id];
    if (!honest || !canary) {
      bad.push(id);
      continue;
    }
    if (honest.pass && canary.pass) bad.push(id);
    if (!honest.pass && !canary.pass && honest.value === canary.value) bad.push(id);
  }
  return bad;
}
