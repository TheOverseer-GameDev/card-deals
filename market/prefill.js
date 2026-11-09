function positive(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(n) {
  return positive(n).toFixed(2);
}

export function prefillFromSaved(row, catalog) {
  const saved = row && typeof row === 'object' ? row : {};
  const name = String(saved.name || '').trim();
  const setCode = String(saved.code || saved.set_code || '').trim();
  const match = findCard(catalog, name, setCode);
  const notes = [];
  const usd = positive(saved.usd);
  if (usd != null) notes.push(`Saved guide: USD ${money(usd)}. CAD estimate unavailable.`);
  const card = match && match.card;
  if (card) {
    const sold = [
      ['Raw', positive(card.raw)],
      ['PSA 9', positive(card.p9)],
      ['PSA 10', positive(card.p10)],
    ].filter((pair) => pair[1] != null);
    if (sold.length) {
      notes.push(`Card Deals stored sold figures: ${sold.map(([label, n]) => `${label} USD ${money(n)}`).join(', ')}. Not a sale price.`);
    }
    notes.push(sold.length >= 2
      ? 'Sold range is not stored as its own figure. The lines above are the stored sold figures only.'
      : 'Sold range unavailable.');
    const ask = card.lr && positive(card.lr.cad_total);
    if (ask != null) notes.push(`Card Deals asking example: CAD ${money(ask)}. Not a sale price.`);
  } else {
    notes.push('Sold range unavailable.');
    notes.push('CAD estimate unavailable.');
  }
  const edition = String(saved.edition || '').trim() || bracket(name) || (card ? bracket(card.name) : '');
  return {
    name,
    game: saved.game === 'ygo' || saved.game === 'mtg' ? saved.game : (match ? match.game : ''),
    setCode,
    edition,
    rarity: String(saved.rarity || '').trim(),
    conditionNotes: String(saved.conditionNotes || saved.condition_notes || '').trim(),
    centering: String(saved.centering || '').trim(),
    notes,
  };
}

function bracket(name) {
  const hit = String(name || '').match(/\[([^[\]]+)\]/);
  return hit ? hit[1].trim() : '';
}

function findCard(catalog, name, setCode) {
  if (!catalog) return null;
  const rows = [];
  for (const game of ['ygo', 'mtg']) {
    const list = catalog[game] && Array.isArray(catalog[game].cards) ? catalog[game].cards : [];
    list.forEach((card) => rows.push({ game, card }));
  }
  const code = setCode.toLowerCase();
  if (code) {
    const hit = rows.find(({ card }) => String(card.name || '').toLowerCase().includes(code));
    if (hit) return hit;
  }
  const wanted = name.toLowerCase();
  if (!wanted) return null;
  return rows.find(({ card }) => String(card.name || '').toLowerCase().startsWith(wanted)) || null;
}
