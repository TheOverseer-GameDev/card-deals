/**
 * Scanner sheets. CAD is listed before USD. A missing figure stays Unavailable.
 */
import { formatGuide } from './pipeline.js';

export function matchCard(host, row, rate) {
  host.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = 'Matches';
  host.append(title);
  if (!row) {
    host.append(line('No card was returned for that set code.'));
    return;
  }
  const card = document.createElement('article');
  card.className = 'cd-match';
  const name = document.createElement('h3');
  name.textContent = row.name;
  const meta = document.createElement('p');
  meta.textContent = [row.setName, row.code, row.rarity, 'English'].filter(Boolean).join(' · ');
  const guide = formatGuide(row.price, rate && rate.rate, rate && rate.date);
  const price = document.createElement('p');
  price.className = 'cd-price';
  price.textContent = `Guide ${guide.cadText}`;
  const usd = document.createElement('p');
  usd.textContent = guide.usdText;
  card.append(name, meta, price, usd);
  if (guide.note) card.append(line(guide.note));
  if (row.code === 'RA01-EN008') {
    card.append(line('RA01-EN008 is printed in more than one rarity. Each rarity is separate. A missing price is not copied from another rarity.'));
  }
  if (row.code === 'RA04-EN025') {
    card.append(line('RA04-EN025 shows only this code’s own row. A zero price stays Unavailable.'));
  }
  host.append(card);
}

export function gradeBlock(host, grade) {
  host.replaceChildren();
  if (!grade) return;
  const head = document.createElement('h3');
  head.textContent = grade.headline || 'Estimate unavailable';
  host.append(head);
  if (grade.half) host.append(line(grade.half));
  host.append(line(grade.detail || 'Photo estimate only, not a PSA grade.'));
  for (const side of ['front', 'back']) {
    const marks = grade.marks && grade.marks[side];
    if (!marks) continue;
    const list = document.createElement('ul');
    for (const key of ['centering', 'corners', 'edges', 'surface']) {
      const mark = marks[key];
      const item = document.createElement('li');
      item.textContent = `${side} ${key}: ${mark ? mark.note : 'Tilted. Not checked.'}`;
      list.append(item);
    }
    host.append(list);
  }
  const notes = document.createElement('ul');
  const label = document.createElement('h3');
  label.textContent = 'On this photo';
  host.append(label, notes);
  for (const note of grade.notes || []) {
    const item = document.createElement('li');
    item.textContent = note;
    notes.append(item);
  }
}

export function collectionList(host, rows) {
  host.replaceChildren();
  const known = (rows || []).filter((row) => row && row.usd != null);
  const sum = known.reduce((total, row) => total + row.usd, 0);
  host.append(line(`Sum of saved guides: ${known.length ? sum.toFixed(2) : '—'} across ${known.length} prints. This is not a portfolio value.`));
  if (!(rows || []).length) host.append(line('No saved prints.'));
  for (const row of rows || []) {
    const item = document.createElement('p');
    item.textContent = `${row.name} · ${row.code || ''} · ${row.usd == null ? '—' : 'USD ' + Number(row.usd).toFixed(2)}`;
    host.append(item);
  }
}

export function priceRows(host, grades) {
  host.replaceChildren();
  const order = [
    ['Guide', grades.guide],
    ['PSA 8', grades.psa8],
    ['PSA 9', grades.psa9],
    ['PSA 10', grades.psa10],
  ];
  for (const [label, value] of order) {
    const row = document.createElement('p');
    if (value && value.price != null && value.source) {
      row.textContent = `${label}: CAD ${value.cad == null ? 'Unavailable' : Number(value.cad).toFixed(2)} · USD ${Number(value.price).toFixed(2)} · ${value.source}`;
    } else {
      row.textContent = `${label}: Price unavailable`;
    }
    host.append(row);
  }
  host.append(line('Delivered cost: Unavailable'));
}

function line(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}
