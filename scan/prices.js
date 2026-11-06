/**
 * Sold comps and asking prices. Rows are kept only when the file already
 * has a positive price, currency, source, observation time, and print id.
 * A sold row is never relabelled as an ask, or the other way around.
 */
import { localPath, safeHttpUrl, STALE_AFTER_MS } from './engine.js';

const PRINT_KEY = /^(ygo|mtg):[A-Za-z0-9_-]+$/;
const FLAGS = new Set(['shipping-unverified', 'cad-stored']);

export function emptyMarket() {
  return {
    sold: [],
    ask: [],
    rejected: [],
    scenarios: [],
    flags: [],
    releasedAt: null,
    printId: null,
  };
}

function cleanListing(raw, now) {
  if (!raw || typeof raw !== 'object') return [null, 'listing is not an object'];
  const price = raw.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return [null, 'price must be a positive number'];
  const currency = raw.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return [null, 'currency must be a 3-letter code'];
  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  if (source.length < 2 || source.length > 80) return [null, 'source is missing'];
  const observedRaw = raw.observedAt || raw.observed_at;
  const t = Date.parse(observedRaw || '');
  if (!Number.isFinite(t)) return [null, 'observed_at is missing'];
  if (t - now > 2 * 864e5) return [null, 'observed_at is far in the future'];
  let sourceUrl = null;
  const u = raw.sourceUrl || raw.source_url || '';
  if (u) {
    sourceUrl = safeHttpUrl(u);
    if (!sourceUrl) return [null, 'source_url must be http or https'];
  }
  let condition = null;
  const conditionRaw = raw.condition;
  if (conditionRaw != null && conditionRaw !== '') {
    if (typeof conditionRaw !== 'string') return [null, 'condition must be text'];
    condition = conditionRaw.trim();
    if (!condition) condition = null;
  }
  return [{
    price,
    currency,
    source,
    sourceUrl,
    observedAt: new Date(t).toISOString(),
    condition,
    stale: now - t > STALE_AFTER_MS,
  }, null];
}

function take(list, bucket, now, sold, ask, rejected) {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    if (raw && typeof raw.kind === 'string' && raw.kind !== bucket) {
      rejected.push({ kind: bucket, reason: 'cross-label' });
      continue;
    }
    const [clean, reason] = cleanListing(raw, now);
    if (!clean) {
      rejected.push({ kind: bucket, reason });
      continue;
    }
    const row = { ...clean, kind: bucket };
    if (bucket === 'sold') sold.push(row);
    else ask.push(row);
  }
}

export function splitMarket(doc, now = Date.now()) {
  const sold = [];
  const ask = [];
  const rejected = [];
  const scenarios = [];
  const flags = [];
  if (!doc || typeof doc !== 'object') return emptyMarket();
  const printId = typeof doc.print_id === 'string'
    ? doc.print_id
    : (typeof doc.game === 'string' && typeof doc.id === 'string' ? `${doc.game}:${doc.id}` : '');
  if (!PRINT_KEY.test(printId)) {
    rejected.push({ kind: '', reason: 'exact print id missing' });
    return { sold, ask, rejected, scenarios, flags, releasedAt: null, printId: null };
  }
  take(doc.sales, 'sold', now, sold, ask, rejected);
  take(doc.asks, 'ask', now, sold, ask, rejected);
  if (Array.isArray(doc.scenarios)) {
    for (const raw of doc.scenarios) {
      if (!raw || typeof raw.tag !== 'string' || !raw.tag.trim()) {
        rejected.push({ kind: 'scenario', reason: 'scenario tag missing' });
        continue;
      }
      const item = {
        tag: raw.tag.trim(),
        note: typeof raw.note === 'string' ? raw.note.trim() : '',
      };
      if (raw.lean === 'up' || raw.lean === 'down' || raw.lean === 'mixed') item.lean = raw.lean;
      if (typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight >= -1 && raw.weight <= 1) {
        item.weight = raw.weight;
      }
      scenarios.push(item);
    }
  }
  if (Array.isArray(doc.flags)) {
    for (const flag of doc.flags) {
      if (FLAGS.has(flag) && !flags.includes(flag)) flags.push(flag);
    }
  }
  let releasedAt = null;
  if (typeof doc.released_at === 'string') {
    const t = Date.parse(doc.released_at);
    if (Number.isFinite(t)) releasedAt = new Date(t).toISOString();
  }
  return { sold, ask, rejected, scenarios, flags, releasedAt, printId };
}

export function rowsForCondition(rows, condition) {
  if (!condition) return [];
  return (rows || []).filter((row) => row && row.condition === condition);
}

export function createPriceBook(fetchImpl = globalThis.fetch) {
  const values = new Map();
  return {
    load(game, id) {
      if ((game !== 'ygo' && game !== 'mtg') || typeof id !== 'string' || !id) return Promise.resolve(emptyMarket());
      const key = `${game}:${id}`;
      if (values.has(key)) return values.get(key);
      let path;
      try {
        path = localPath(`scan/market/${game}/${id}.json`);
      } catch {
        return Promise.resolve(emptyMarket());
      }
      const job = Promise.resolve()
        .then(() => fetchImpl(path, { cache: 'no-store' }))
        .then(async (res) => {
          if (!res || res.status === 404 || !res.ok) return emptyMarket();
          return splitMarket(await res.json());
        })
        .catch(() => emptyMarket());
      values.set(key, job);
      return job;
    },
  };
}
