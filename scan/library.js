/**
 * Saved-guide refresh and the Prices feed. A failed check keeps the old number.
 * A failed feed does not borrow another printing.
 */

export async function refreshSaved(rows, lookup) {
  const next = (rows || []).map((row) => ({ ...row }));
  let failed = false;
  const batch = next.slice(0, 12);
  for (const row of batch) {
    let result = null;
    try {
      result = await lookup(row);
    } catch {
      failed = true;
      continue;
    }
    if (!result || result.error) {
      failed = true;
      continue;
    }
    if (result.price != null) row.usd = result.price;
  }
  return { rows: next, checked: batch.length, failed };
}

export function priceFeed(items) {
  const kept = [];
  const seen = new Map();
  for (const item of items || []) {
    const price = Number(item && item.price);
    if (!item || !item.name || !Number.isFinite(price) || price <= 0) continue;
    const count = seen.get(item.name) || 0;
    if (count >= 2) continue;
    const newerRare = item.game === 'mtg' && (item.rarity === 'rare' || item.rarity === 'mythic') && Number(item.releasedDays) <= 180;
    const played = item.game === 'mtg' && Number(item.edhrec) >= 1 && Number(item.edhrec) <= 400;
    const staple = item.game === 'ygo' && item.staple === true;
    if (!newerRare && !played && !staple) continue;
    seen.set(item.name, count + 1);
    kept.push({ ...item, price });
  }
  return kept;
}

export const FEED_FAIL = 'The price feed did not load. No other printing was substituted.';
