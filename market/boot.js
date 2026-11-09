import { prefillFromSaved } from './prefill.js';
import { psaCertUrl } from './vault.js';
import { isConfigured, openRemote } from './remote.js';

const GAMES = { ygo: 'Yu-Gi-Oh', mtg: 'Magic' };

export async function mountMarket(doc, options = {}) {
  const root = options.root || doc.querySelector('main') || doc.body;
  let section = doc.getElementById('v-market');
  if (!section) {
    section = doc.createElement('section');
    section.id = 'v-market';
    section.className = 'view';
    root.append(section);
  }
  const link = doc.getElementById('market-css');
  if (!link) {
    const node = doc.createElement('link');
    node.id = 'market-css';
    node.rel = 'stylesheet';
    node.href = new URL('market.css', import.meta.url).href;
    doc.head.append(node);
  }
  let client = options.client || null;
  if (!client && isConfigured()) client = await openRemote();
  const testData = options.testData === true;
  const paint = async () => {
    section.replaceChildren();
    section.append(notice());
    if (testData) section.append(el('p', 'Test data', 'market-banner'));
    if (!client) {
      section.append(el('h2', 'Market not connected yet'));
      section.append(el('p', 'Add the project URL and anon key in market/config.js. Nothing here is sample data.', 'market-muted'));
      section.append(termsLink());
      return;
    }
    let view;
    try {
      view = await client.view();
    } catch (err) {
      section.append(el('p', err.message || 'The market could not be read.'));
      return;
    }
    if (testData && options.users?.length) section.append(userPick(options.users, view.me && view.me.id, client, paint));
    if (!view.me) {
      section.append(signIn(client, paint));
      section.append(termsLink());
      return;
    }
    if (!view.me.name) section.append(nameForm(client, paint));
    section.append(toolbar(view, client, paint, doc));
    section.append(handlesForm(view, client, paint));
    section.append(feed(view, client, paint, doc));
    section.append(termsLink());
  };
  await paint();
  return { section, paint };
}

function notice() {
  return el('p', 'Card Deals does not hold money or guarantee trades. Payment is directly between people, by Interac e-Transfer or PayPal. For buyer protection, use PayPal Goods & Services.', 'market-note');
}

function termsLink() {
  const a = el('a', 'Market terms and privacy');
  a.href = new URL('terms.html', import.meta.url).href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function signIn(client, paint) {
  const box = el('form', null, 'market-box');
  box.append(el('h2', 'Sign in'));
  const email = input('email', 'Email');
  email.id = 'market-email';
  const button = el('button', 'Email me a sign-in link');
  button.type = 'submit';
  box.append(email, button);
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = await client.dispatch({ type: 'sign-in', email: email.value });
    box.append(el('p', result.ok ? 'Check your email for the sign-in link.' : result.error));
    if (result.ok) await paint();
  });
  return box;
}

function userPick(users, selected, client, paint) {
  const pick = document.createElement('select');
  pick.id = 'market-test-user';
  pick.setAttribute('aria-label', 'Test user');
  for (const user of users) {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.name;
    pick.append(option);
  }
  if (selected) pick.value = selected;
  pick.addEventListener('change', async () => {
    await client.dispatch({ type: 'sign', user: users.find((row) => row.id === pick.value) });
    await paint();
  });
  return pick;
}

function nameForm(client, paint) {
  const box = el('form', null, 'market-box');
  const name = input('text', 'Display name');
  name.id = 'market-display-name';
  const save = el('button', 'Save name');
  save.type = 'submit';
  box.append(el('p', 'Choose a display name. It is shown on your listings.'), name, save);
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await send(client, paint, { type: 'name', name: name.value });
  });
  return box;
}

function handlesForm(view, client, paint) {
  const box = el('form', null, 'market-box');
  box.id = 'market-own-handles';
  const interac = input('email', 'Your Interac email');
  interac.id = 'market-interac';
  interac.value = view.handles?.interac || '';
  const paypal = input('text', 'Your PayPal.me name');
  paypal.id = 'market-paypal';
  paypal.value = view.handles?.paypal || '';
  const save = el('button', 'Save payment handles');
  save.type = 'submit';
  box.append(el('p', 'Buyers can see these only after you accept their offer on a listing.'), interac, paypal, save);
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await send(client, paint, { type: 'handles', interac: interac.value, paypal: paypal.value });
  });
  return box;
}

function toolbar(view, client, paint, doc) {
  const bar = el('div', null, 'market-toolbar');
  bar.append(el('h2', view.me.name ? `Market · ${view.me.name}` : 'Market'));
  const search = input('search', 'Search name or set code');
  search.id = 'market-search';
  const game = document.createElement('select');
  game.id = 'market-game';
  for (const [value, label] of [['', 'All games'], ['ygo', 'Yu-Gi-Oh'], ['mtg', 'Magic']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    game.append(option);
  }
  const sell = el('button', 'Sell Card');
  sell.id = 'market-sell';
  sell.type = 'button';
  const saved = readSaved();
  if (saved.length) {
    const use = el('button', 'Prefill from a saved scan');
    use.type = 'button';
    use.addEventListener('click', () => openSell(doc, client, paint, saved[0]));
    bar.append(use);
  }
  sell.addEventListener('click', () => openSell(doc, client, paint, null));
  search.addEventListener('input', () => paintFeed(doc, view, client, paint, search.value, game.value));
  game.addEventListener('change', () => paintFeed(doc, view, client, paint, search.value, game.value));
  bar.append(search, game, sell);
  return bar;
}

function feed(view, client, paint, doc) {
  const wrap = el('div');
  wrap.id = 'market-feed';
  wrap.append(grid(view, client, paint, doc, '', ''));
  if (view.trades.length) wrap.append(trades(view, client, paint));
  return wrap;
}

function paintFeed(doc, view, client, paint, query, game) {
  const host = doc.getElementById('market-feed');
  if (!host) return;
  const gridNode = host.querySelector('.market-feed-grid');
  const next = grid(view, client, paint, doc, query, game);
  if (gridNode) gridNode.replaceWith(next);
}

function grid(view, client, paint, doc, query, game) {
  const box = el('div', null, 'market-feed-grid');
  const q = query.trim().toLowerCase();
  const rows = view.feed.filter((row) => {
    if (game && row.game !== game) return false;
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || String(row.setCode || '').toLowerCase().includes(q);
  });
  if (!rows.length) box.append(el('p', 'No listings.', 'market-muted'));
  for (const row of rows) box.append(card(row, view, client, paint, doc));
  return box;
}

function card(row, view, client, paint, doc) {
  const node = el('article', null, 'm-card');
  node.append(el('h3', row.name));
  node.append(el('p', [GAMES[row.game] || row.game, row.setCode, row.edition, row.rarity].filter(Boolean).join(' · '), 'market-muted'));
  node.append(el('p', `Asking ${cad(row.askCad)}`, 'market-price'));
  node.append(el('p', `Seller: ${row.sellerName || 'Unnamed'}`, 'market-muted'));
  if (row.estimateNote) node.append(el('p', row.estimateNote, 'market-muted'));
  if (row.vaulted) {
    node.classList.add('vaulted');
    node.append(el('p', 'Vaulted', 'vault-badge'));
    node.append(el('p', 'A vaulted card is stored at PSA in Delaware and is bought and transferred through PSA or eBay. Card Deals does not transfer the card or ship it.', 'market-muted'));
    node.append(safeLink('View vault listing', row.vaultUrl, 'vault-link'));
    const cert = safeLink('PSA cert', psaCertUrl(row.psaCert), 'psa-cert');
    const label = el('p', null, 'market-muted');
    label.append(cert, document.createTextNode(' · Seller-provided. Not checked by Card Deals.'));
    node.append(label);
  } else if (view.me && view.me.id !== row.sellerId && row.status === 'active') {
    const offer = el('button', 'Make Offer');
    offer.type = 'button';
    offer.addEventListener('click', () => openOffer(doc, client, paint, row));
    node.append(offer);
  }
  return node;
}

function trades(view, client, paint) {
  const box = el('div', null, 'settlement-box');
  box.id = 'market-settlement';
  box.append(el('h3', 'Your trades'));
  for (const trade of view.trades) {
    const block = el('div', null, 'market-trade');
    block.append(el('p', `${trade.listing?.name || 'Listing'} · ${cad(trade.offer.amountCad)} · ${trade.offer.status}`));
    if (trade.offer.paymentDue && (trade.offer.status === 'accepted' || trade.offer.status === 'paid')) {
      block.append(el('p', `Payment window ends ${new Date(trade.offer.paymentDue).toLocaleString()}`));
    }
    if (trade.listing?.vaulted) {
      block.append(el('p', 'A vaulted card is stored at PSA in Delaware and is bought and transferred through PSA or eBay. Card Deals does not transfer the card or ship it.', 'market-muted'));
      block.append(safeLink('View vault listing', trade.listing.vaultUrl, 'vault-link'));
      const cert = safeLink('PSA cert', psaCertUrl(trade.listing.psaCert), 'psa-cert');
      const label = el('p', null, 'market-muted');
      label.append(cert, document.createTextNode(' · Seller-provided. Not checked by Card Deals.'));
      block.append(label);
    } else if (trade.handles) {
      const handles = el('div');
      handles.id = 'market-handles';
      handles.append(el('p', trade.handles.interac ? `Interac: ${trade.handles.interac}` : 'Interac: not provided'));
      handles.append(el('p', trade.handles.paypal ? `PayPal.me: ${trade.handles.paypal}` : 'PayPal.me: not provided'));
      block.append(handles);
    } else if (trade.offer.buyerId === view.me.id && trade.offer.status === 'pending') {
      block.append(el('p', 'Payment details stay hidden until the seller accepts.', 'market-muted'));
    }
    const actions = actionsFor(trade, view, client, paint);
    if (actions) block.append(actions);
    box.append(block);
  }
  return box;
}

function actionsFor(trade, view, client, paint) {
  const row = el('div', null, 'market-actions');
  const mine = view.me.id;
  const offer = trade.offer;
  const waiting = offer.lastActor !== mine;
  if (trade.listing?.vaulted) {
    return row.childNodes.length ? row : null;
  }
  if ((offer.status === 'pending' || offer.status === 'countered') && waiting) {
    row.append(actionButton('Accept', () => send(client, paint, { type: 'accept', offerId: offer.id })));
    row.append(actionButton('Decline', () => send(client, paint, { type: 'decline', offerId: offer.id })));
    const amount = input('number', 'Counter in CAD');
    amount.id = 'market-counter';
    const counter = actionButton('Counter', () => send(client, paint, { type: 'counter', offerId: offer.id, amount: amount.value }));
    row.append(amount, counter);
  }
  if (offer.status === 'accepted' && offer.buyerId === mine) {
    row.append(actionButton('Mark paid', () => send(client, paint, { type: 'paid', offerId: offer.id })));
  }
  if (offer.status === 'paid' && offer.sellerId === mine) {
    row.append(actionButton('Confirm received', () => send(client, paint, { type: 'received', offerId: offer.id })));
  }
  if (offer.status === 'received') {
    const stars = document.createElement('select');
    stars.id = 'market-stars';
    for (let n = 1; n <= 5; n += 1) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `${n} star${n === 1 ? '' : 's'}`;
      stars.append(option);
    }
    row.append(stars, actionButton('Save rating', () => send(client, paint, { type: 'rate', offerId: offer.id, stars: Number(stars.value) })));
  }
  if (offer.sellerId !== mine) {
    row.append(actionButton('Block seller', () => send(client, paint, { type: 'block', userId: offer.sellerId })));
  }
  const reason = input('text', 'Report reason');
  reason.id = 'market-report-reason';
  row.append(reason, actionButton('Report', () => send(client, paint, { type: 'report', listingId: offer.listingId, userId: offer.sellerId === mine ? offer.buyerId : offer.sellerId, reason: reason.value })));
  return row;
}

function openOffer(doc, client, paint, listing) {
  closeModal(doc);
  const modal = el('div', null, 'market-modal');
  modal.id = 'market-offer';
  const card = el('div', null, 'market-box');
  card.append(el('h3', listing.name));
  card.append(el('p', `Asking ${cad(listing.askCad)}`));
  const amount = input('number', 'Your offer in CAD');
  amount.id = 'market-offer-amount';
  const make = el('button', 'Make Offer');
  make.type = 'button';
  make.id = 'market-make-offer';
  const buy = el('button', 'Buy It Now');
  buy.type = 'button';
  buy.id = 'market-buy-now';
  const cancel = el('button', 'Close');
  cancel.type = 'button';
  make.addEventListener('click', () => send(client, paint, { type: 'offer', listingId: listing.id, amount: amount.value }).then(() => closeModal(doc)));
  buy.addEventListener('click', () => send(client, paint, { type: 'buy', listingId: listing.id }).then(() => closeModal(doc)));
  cancel.addEventListener('click', () => closeModal(doc));
  card.append(amount, make, buy, cancel);
  modal.append(card);
  (doc.getElementById('v-market') || doc.body).append(modal);
}

function openSell(doc, client, paint, saved) {
  closeModal(doc);
  const pre = saved ? prefillFromSaved(saved, globalThis.D) : null;
  const modal = el('div', null, 'market-modal');
  modal.id = 'market-sell-form';
  const card = el('form', null, 'market-box');
  card.append(el('h3', 'Sell Card'));
  const name = input('text', 'Card name');
  name.id = 'market-name';
  name.value = pre?.name || '';
  const game = document.createElement('select');
  game.id = 'market-sell-game';
  for (const [value, label] of [['', 'Game'], ['ygo', 'Yu-Gi-Oh'], ['mtg', 'Magic']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    game.append(option);
  }
  if (pre?.game) game.value = pre.game;
  const setCode = input('text', 'Set code');
  setCode.value = pre?.setCode || '';
  const edition = input('text', 'Edition');
  edition.value = pre?.edition || '';
  const rarity = input('text', 'Rarity');
  rarity.value = pre?.rarity || '';
  const notes = input('text', 'Condition notes');
  notes.value = pre?.conditionNotes || '';
  const centering = input('text', 'Centering');
  centering.value = pre?.centering || '';
  const ask = input('number', 'Asking price in CAD');
  ask.id = 'market-ask';
  const vaultLabel = document.createElement('label');
  const vaulted = document.createElement('input');
  vaulted.type = 'checkbox';
  vaulted.id = 'market-vaulted';
  vaultLabel.append(vaulted, doc.createTextNode(' This card is in the PSA Vault'));
  const cert = input('text', 'PSA cert number');
  cert.id = 'market-psa-cert';
  const vaultUrl = input('url', 'Vault listing URL');
  vaultUrl.id = 'market-vault-url';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.id = 'market-photo';
  const consent = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'market-photo-consent';
  consent.append(box, doc.createTextNode(' I agree to upload this photo to the market database. Otherwise no photo is stored.'));
  const submit = el('button', 'Publish listing');
  submit.type = 'submit';
  const cancel = el('button', 'Close');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal(doc));
  card.append(name, game, setCode, edition, rarity, notes, centering, ask, vaultLabel, cert, vaultUrl, el('p', 'A vaulted card is stored at PSA in Delaware and is bought and transferred through PSA or eBay. Card Deals does not transfer the card or ship it.', 'market-muted'), file, consent);
  if (pre) {
    const note = el('div', null, 'market-muted');
    note.id = 'market-estimates';
    for (const line of pre.notes) note.append(el('p', line));
    card.append(note);
  }
  card.append(submit, cancel);
  card.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = await client.dispatch({
      type: 'list',
      name: name.value,
      game: game.value,
      setCode: setCode.value,
      edition: edition.value,
      rarity: rarity.value,
      conditionNotes: notes.value,
      centering: centering.value,
      estimateNote: pre ? pre.notes.join(' ') : '',
      askCad: ask.value,
      vaulted: vaulted.checked,
      psaCert: cert.value,
      vaultUrl: vaultUrl.value,
      photoConsent: box.checked,
      photoFile: box.checked ? file.files?.[0] : null,
    });
    if (!result.ok) {
      card.append(el('p', result.error));
      return;
    }
    closeModal(doc);
    await paint();
  });
  modal.append(card);
  (doc.getElementById('v-market') || doc.body).append(modal);
}

function safeLink(label, href, className) {
  const link = el('a', label, className);
  if (href) link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function actionButton(label, onClick) {
  const button = el('button', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

async function send(client, paint, action) {
  const result = await client.dispatch(action);
  await paint();
  return result;
}

function closeModal(doc) {
  doc.querySelectorAll('.market-modal').forEach((node) => node.remove());
}

function readSaved() {
  try {
    const rows = JSON.parse(localStorage.getItem('carddeals-coll-v1') || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row && row.name) : [];
  } catch {
    return [];
  }
}

function cad(value) {
  return `CAD ${Number(value).toFixed(2)}`;
}

function input(type, label) {
  const node = document.createElement('input');
  node.type = type;
  node.placeholder = label;
  node.setAttribute('aria-label', label);
  return node;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function boot() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const sectionPromise = mountMarket(document);
  document.addEventListener('click', (ev) => {
    const button = ev.target.closest && ev.target.closest('nav button');
    if (!button) return;
    const on = button.dataset.v === 'market';
    sectionPromise.then(({ section }) => section.classList.toggle('on', on));
  });
}

if (typeof document !== 'undefined' && document.querySelector('nav') && !globalThis.MARKET_TEST) boot();
