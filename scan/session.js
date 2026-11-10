/**
 * A scan session stays in memory on this phone.
 * Totals use only figures that were already stored. A missing price stays null.
 */

export function createSession() {
  return { items: [] };
}

export function addToSession(session, item) {
  const cad = Number(item && item.cad);
  session.items.push({
    name: (item && item.name) || 'Unnamed card',
    set: (item && item.set) || '',
    number: (item && item.number) || '',
    variant: (item && item.variant) || '',
    foil: false,
    qty: 1,
    condition: (item && item.condition) || '',
    cad: Number.isFinite(cad) && cad > 0 ? Math.round(cad * 100) / 100 : null,
  });
  return session.items[session.items.length - 1];
}

export function sessionTotal(session) {
  const items = (session && session.items) || [];
  let count = 0;
  let cad = 0;
  let priced = items.length > 0;
  for (const item of items) {
    const qty = Math.max(1, Math.round(Number(item.qty) || 1));
    count += qty;
    if (item.cad == null) priced = false;
    else cad += item.cad * qty;
  }
  return {
    count,
    cad: priced ? Math.round(cad * 100) / 100 : null,
  };
}

export function csvCell(value) {
  let text = value == null ? '' : String(value).normalize('NFKC');
  text = text.replace(/\p{Cf}/gu, '');
  text = text.replace(/^(?:\p{Z}|\p{Cc})+/u, '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = ['name', 'set', 'number', 'variant', 'foil', 'qty', 'condition', 'cad'];
  const cell = csvCell;
  const lines = [keys.join(',')];
  for (const row of list) lines.push(keys.map((key) => cell(row[key])).join(','));
  return lines.join('\n');
}

export function targetNote(target, price) {
  const goal = Number(target);
  const current = Number(price);
  if (!Number.isFinite(goal) || goal <= 0) return 'Set a CAD target. It stays on this phone.';
  if (!Number.isFinite(current) || current <= 0) {
    return `Target CAD ${goal.toFixed(2)}. The current price is unavailable, so it was not compared.`;
  }
  if (current <= goal) return `At or under your CAD ${goal.toFixed(2)} target.`;
  return `Above your CAD ${goal.toFixed(2)} target.`;
}

export function cue(enabled) {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  navigator.vibrate(12);
  return true;
}
