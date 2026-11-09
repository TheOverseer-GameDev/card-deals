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
  appendArt(card, row.image);
  const name = document.createElement('h3');
  name.textContent = row.name;
  const meta = document.createElement('p');
  meta.textContent = [row.setName, row.number || row.code, row.rarity, 'English'].filter(Boolean).join(' · ');
  const guide = formatGuide(row.price, rate && rate.rate, rate && rate.date);
  const guideBox = document.createElement('div');
  guideBox.className = 'cd-guide';
  const cad = document.createElement('p');
  cad.className = 'cd-cad';
  cad.textContent = guide.cadText;
  const usd = document.createElement('p');
  usd.className = 'cd-usd';
  usd.textContent = guide.usdText;
  guideBox.append(cad, usd);
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'scan-add-card';
  add.className = 'cd-add';
  add.textContent = 'Add this card';
  card.append(name, meta, guideBox, add);
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
      const names = { centering: 'Centering', corners: 'Corners', edges: 'Edges', surface: 'Surface' };
      const item = document.createElement('li');
      item.textContent = `${side === 'front' ? 'Front' : 'Back'} ${names[key]}: ${mark ? mark.note : 'Tilted. Not checked.'}`;
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
  const sum = known.reduce((total, row) => total + Number(row.usd), 0);
  host.append(line(`Sum of saved guides: ${known.length ? sum.toFixed(2) : '—'} across ${known.length} prints. This is not a portfolio value.`));
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.id = 'scan-refresh';
  refresh.textContent = 'Refresh';
  host.append(refresh);
  if (!(rows || []).length) host.append(line('No saved prints.'));
  for (const row of rows || []) {
    const item = document.createElement('p');
    item.textContent = `${row.name} · ${row.code || ''} · ${row.usd == null ? '—' : 'USD ' + Number(row.usd).toFixed(2)}`;
    host.append(item);
  }
}

export function cardScreen(host, model) {
  host.replaceChildren();
  const bar = document.createElement('div');
  bar.className = 'cd-top';
  const done = document.createElement('button');
  done.type = 'button';
  done.id = 'scan-done';
  done.className = 'cd-done';
  done.textContent = 'Done';
  const title = document.createElement('h2');
  title.textContent = 'Details';
  bar.append(done, title);
  host.append(bar);
  const sheet = document.createElement('article');
  sheet.className = 'cd-sheet';
  appendArt(sheet, model.image);
  const name = document.createElement('h3');
  name.textContent = model.name || 'No card open';
  const meta = document.createElement('p');
  meta.textContent = [model.setName, model.number || model.code, model.rarity, model.language || 'English', model.finish].filter(Boolean).join(' · ');
  sheet.append(name, meta);
  const seg = document.createElement('div');
  seg.className = 'cd-seg';
  const panels = {};
  for (const id of ['pricing', 'grade', 'text']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `scan-seg-${id}`;
    button.textContent = id[0].toUpperCase() + id.slice(1);
    const panel = document.createElement('div');
    panel.id = `scan-panel-${id}`;
    panel.hidden = id !== 'grade';
    panels[id] = panel;
    button.classList.toggle('on', id === 'grade');
    button.addEventListener('click', () => {
      for (const key of Object.keys(panels)) panels[key].hidden = key !== id;
      for (const child of seg.children) child.classList.toggle('on', child === button);
    });
    seg.append(button);
  }
  sheet.append(seg, panels.pricing, panels.grade, panels.text);
  host.append(sheet);
  priceRows(panels.pricing, model.grades || {});
  gradeBlock(panels.grade, model.grade);
  panels.text.append(line(model.text || 'Rules text is unavailable until a catalog row is open.'));
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
    if (label !== 'Guide' && !(value && value.price != null && value.source)) continue;
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

function appendArt(parent, url) {
  if (!url) return;
  const art = document.createElement('img');
  art.className = 'cd-art';
  art.alt = String(url).includes('fixture-art') ? 'Test fixture. Not card art.' : '';
  art.src = url;
  parent.append(art);
  if (String(url).includes('fixture-art')) parent.append(line('Test fixture. Not card art.'));
}

function line(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}
