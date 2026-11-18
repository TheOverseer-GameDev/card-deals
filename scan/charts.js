/**
 * Monthly bars for real observations only. Empty months stay null.
 * Asks are never titled as completed sales.
 */
import { COPY } from './engine.js';

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

function monthKey(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthLabel(key) {
  const year = Math.floor(key / 12);
  const month = key % 12;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

export function buildSalesSeries(points, options = {}) {
  const kind = options.kind === 'ask' ? 'ask' : 'sold';
  const title = kind === 'ask' ? 'Asking prices over time' : COPY.sold;
  const gap = COPY.gap;
  const cleaned = [];
  for (const point of points || []) {
    const t = Date.parse(point && point.observedAt);
    const price = point && point.price;
    if (!Number.isFinite(t)) continue;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    cleaned.push({ t, price });
  }
  if (!cleaned.length) {
    return { title, gap, buckets: [], empty: true, cardAgeKnown: false, kind };
  }
  const end = Math.max(...cleaned.map((point) => point.t));
  let start = end - FIVE_YEARS_MS;
  let cardAgeKnown = false;
  if (options.releasedAt) {
    const released = Date.parse(options.releasedAt);
    if (Number.isFinite(released) && released <= end) {
      cardAgeKnown = true;
      if (released > start) start = released;
    }
  }
  const buckets = [];
  for (let key = monthKey(start); key <= monthKey(end); key++) {
    const inMonth = cleaned.filter((point) => point.t >= start && point.t <= end && monthKey(point.t) === key);
    let value = null;
    if (inMonth.length) {
      inMonth.sort((a, b) => a.t - b.t);
      value = inMonth[inMonth.length - 1].price;
    }
    buckets.push({ label: monthLabel(key), value, count: inMonth.length });
  }
  return { title, gap, buckets, empty: false, cardAgeKnown, kind };
}

export function drawSalesChart(canvas, series) {
  if (!canvas || !canvas.getContext || !series || !series.buckets.length) return;
  const width = Math.max(280, Math.round(canvas.clientWidth || 320));
  const height = 168;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  const values = series.buckets.map((bucket) => bucket.value).filter((value) => typeof value === 'number');
  if (!values.length) return;
  const max = Math.max(...values);
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const slot = plotW / series.buckets.length;
  ctx.fillStyle = '#7C5CFF';
  series.buckets.forEach((bucket, index) => {
    if (typeof bucket.value !== 'number' || !(max > 0)) return;
    const barH = Math.max(2, (bucket.value / max) * plotH);
    const x = padL + index * slot + slot * 0.2;
    const y = padT + plotH - barH;
    ctx.fillRect(x, y, Math.max(1, slot * 0.6), barH);
  });
  ctx.fillStyle = '#8b95b0';
  ctx.font = '11px sans-serif';
  const first = series.buckets[0];
  const last = series.buckets[series.buckets.length - 1];
  ctx.fillText(first.label, padL, height - 8);
  const endLabel = last.label;
  ctx.fillText(endLabel, Math.max(padL, width - padR - ctx.measureText(endLabel).width), height - 8);
}
