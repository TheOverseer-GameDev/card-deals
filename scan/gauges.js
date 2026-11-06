/**
 * Three separate scores. They are not shares of one total.
 * Future potential stays unavailable when no scenario list was supplied.
 */
import { COPY } from './engine.js';

export const GAUGE_WEIGHTS = {
  unconfirmed: 30,
  unknownRegion: 8,
  unknownCap: 32,
  stale: 15,
  noSold: 20,
  wideSpread: 15,
  shippingFlag: 10,
  backMissing: 8,
};

export function median(nums) {
  const xs = (nums || []).filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function spreadIsWide(soldPrices, askPrices) {
  const sold = median(soldPrices);
  const ask = median(askPrices);
  if (!(sold > 0) || !(ask > 0)) return false;
  return Math.max(sold, ask) / Math.min(sold, ask) >= 1.5;
}

function valueBase(count) {
  if (count >= 9) return 80;
  if (count >= 4) return 65;
  if (count >= 2) return 45;
  if (count >= 1) return 25;
  return null;
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function buildGauges(input = {}) {
  const factors = [];
  let risk = 0;
  if (!input.printConfirmed) {
    risk += GAUGE_WEIGHTS.unconfirmed;
    factors.push('Print is not confirmed.');
  }
  const unknowns = Number.isFinite(input.photoUnknowns) ? Math.max(0, input.photoUnknowns) : 0;
  if (unknowns > 0) {
    risk += Math.min(GAUGE_WEIGHTS.unknownCap, unknowns * GAUGE_WEIGHTS.unknownRegion);
    factors.push(`${unknowns} photo region(s) are unknown or failed.`);
  }
  if (input.pricesStale) {
    risk += GAUGE_WEIGHTS.stale;
    factors.push('At least one stored price is older than 45 days.');
  }
  const soldPrices = Array.isArray(input.soldPrices) ? input.soldPrices.filter((n) => typeof n === 'number' && n > 0) : [];
  const askPrices = Array.isArray(input.askPrices) ? input.askPrices.filter((n) => typeof n === 'number' && n > 0) : [];
  if (!soldPrices.length) {
    risk += GAUGE_WEIGHTS.noSold;
    factors.push('No sourced completed sales.');
  }
  if (spreadIsWide(soldPrices, askPrices)) {
    risk += GAUGE_WEIGHTS.wideSpread;
    factors.push('Completed sales and asking prices differ widely.');
  }
  const flags = Array.isArray(input.flags) ? input.flags : [];
  if (flags.includes('shipping-unverified') || flags.includes('cad-stored')) {
    risk += GAUGE_WEIGHTS.shippingFlag;
    if (flags.includes('shipping-unverified')) factors.push('Tracker flag: shipping was not verified.');
    if (flags.includes('cad-stored')) factors.push('Tracker flag: a stored CAD figure is present. This screen does not convert currencies.');
  }
  if (input.backMissing) {
    risk += GAUGE_WEIGHTS.backMissing;
    factors.push('Back photo is missing.');
  }
  if (!factors.length) factors.push('None of the listed risk factors fired.');

  const valueFactors = [];
  let value = null;
  if (!soldPrices.length) {
    valueFactors.push('No sourced completed sales, so current-value data quality is unavailable.');
  } else {
    value = valueBase(soldPrices.length);
    valueFactors.push(`${soldPrices.length} sourced completed sale(s).`);
    if (input.newestSoldAt) {
      const ageDays = (Number(input.now) - Date.parse(input.newestSoldAt)) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > 45) {
        value -= 25;
        valueFactors.push('Newest completed sale is older than 45 days.');
      } else if (Number.isFinite(ageDays) && ageDays <= 14) {
        value += 10;
        valueFactors.push('A completed sale is within 14 days.');
      }
    }
    const hi = Math.max(...soldPrices);
    const lo = Math.min(...soldPrices);
    if (soldPrices.length >= 2 && lo > 0 && hi / lo >= 2) {
      value -= 20;
      valueFactors.push('Completed sales in this set are not consistent.');
    }
    value = clampScore(value);
  }

  const scenarios = [];
  for (const raw of input.scenarios || []) {
    if (!raw || typeof raw.tag !== 'string' || !raw.tag.trim()) continue;
    const item = { tag: raw.tag.trim(), note: typeof raw.note === 'string' ? raw.note : '' };
    if (raw.lean === 'up' || raw.lean === 'down' || raw.lean === 'mixed') item.lean = raw.lean;
    if (typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight >= -1 && raw.weight <= 1) {
      item.weight = raw.weight;
    }
    scenarios.push(item);
  }
  let futureScore = null;
  if (scenarios.length && scenarios.every((item) => typeof item.weight === 'number')) {
    const mean = scenarios.reduce((sum, item) => sum + item.weight, 0) / scenarios.length;
    futureScore = clampScore((mean + 1) * 50);
  }
  return {
    risk: {
      score: clampScore(risk),
      factors,
      disclaimer: COPY.risk,
    },
    value: {
      score: value,
      factors: valueFactors,
      disclaimer: COPY.value,
    },
    future: {
      score: scenarios.length ? futureScore : null,
      available: scenarios.length > 0,
      scenarios,
      disclaimer: COPY.future,
    },
  };
}
