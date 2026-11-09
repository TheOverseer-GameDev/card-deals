/**
 * Catalog lookups. Photos are never sent. A zero guide stays null.
 * User-Agent is Card Deals, not the draft name.
 */
import { positiveGuide, rowsFromCardInfo } from './pipeline.js';

const UA = 'CardDeals/1.0';

export async function lookupSetCode(code, fetchImpl = globalThis.fetch) {
  const printed = String(code || '');
  const infoUrl = `https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=${encodeURIComponent(printed)}`;
  let info;
  try {
    const res = await fetchImpl(infoUrl, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (res.status === 400 || res.status === 404) return [];
    if (!res.ok) return { error: 'Lookup failure' };
    info = await res.json();
  } catch {
    return { error: 'Lookup failure' };
  }
  const ids = [];
  const list = Array.isArray(info) ? info : [info];
  for (const row of list) {
    if (row && row.id != null && !ids.includes(row.id)) ids.push(row.id);
  }
  const cards = [];
  for (const id of ids) {
    try {
      const res = await fetchImpl(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!res.ok) return { error: 'Lookup failure' };
      const body = await res.json();
      cards.push(...(body.data || []));
    } catch {
      return { error: 'Lookup failure' };
    }
  }
  return rowsFromCardInfo(printed, { data: cards });
}

export async function cadRate(fetchImpl = globalThis.fetch, now = Date.now()) {
  const cached = cadRate.cache;
  if (cached && now - cached.at < 3600e3) return cached;
  try {
    const res = await fetchImpl('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD', { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) return null;
    const body = await res.json();
    const rate = positiveGuide(body.rates && body.rates.CAD);
    if (rate == null) return null;
    cadRate.cache = { rate, date: body.date || null, at: now };
    return cadRate.cache;
  } catch {
    return null;
  }
}
