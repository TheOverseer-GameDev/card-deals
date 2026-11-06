/**
 * Same-origin lookups only. History and verified prices are fetched once
 * per id and reused. Failures are not cached, so a later retry can succeed.
 */
import { localPath, priceReport, validateVerifiedFile } from './engine.js';

export function createLookup(fetchImpl = globalThis.fetch) {
  const values = new Map();
  const inflight = new Map();

  function once(key, load) {
    if (values.has(key)) return Promise.resolve(values.get(key));
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = Promise.resolve()
      .then(load)
      .then((value) => {
        values.set(key, value);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, job);
    return job;
  }

  function verified(now = Date.now()) {
    return once('verified', async () => {
      try {
        const res = await fetchImpl(localPath('scan/verified-prices.json'), { cache: 'no-store' });
        if (!res || !res.ok) return { prints: {}, rejected: [] };
        const json = await res.json();
        return validateVerifiedFile(json, now);
      } catch {
        return { prints: {}, rejected: [] };
      }
    });
  }

  function history(game, id) {
    if (game !== 'ygo' && game !== 'mtg') return Promise.resolve(null);
    if (typeof id !== 'string' || !/^[a-z0-9]+$/i.test(id)) return Promise.resolve(null);
    const path = localPath(`h/${game}/${id}.json`);
    return once(`h:${path}`, async () => {
      const res = await fetchImpl(path, { cache: 'no-store' });
      if (res && res.status === 404) return null;
      if (!res || !res.ok) throw new Error('history request failed');
      return res.json();
    });
  }

  async function report(row, now = Date.now()) {
    const file = await verified(now);
    let hist = null;
    if (row && row.id) {
      try {
        hist = await history(row.game, row.id);
      } catch {
        hist = null;
      }
    }
    const printKey = `${row.game}:${row.id}`;
    const verifiedPrint = file.prints[printKey] || null;
    return priceReport(row, hist, verifiedPrint, now);
  }

  return { verified, history, report };
}
