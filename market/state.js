export const PAY_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MAX_OPEN_LISTINGS = 20;
export const MAX_OPEN_OFFERS = 10;

export function emptyMarket() {
  return {
    seq: 1,
    me: null,
    profiles: [],
    listings: [],
    offers: [],
    handles: [],
    reports: [],
    ratings: [],
  };
}

export function reduceMarket(state, action, now) {
  const next = structuredClone(state);
  expireOffers(next, now);
  const error = apply(next, action, now);
  if (error) return { ok: false, error, state };
  return { ok: true, state: next };
}

export function projectMarket(state, now) {
  const next = structuredClone(state);
  expireOffers(next, now);
  const me = next.me;
  const blocked = new Set(profile(next, me && me.id)?.blocked || []);
  const feed = next.listings.filter((row) => row.status === 'active' && !blocked.has(row.sellerId));
  const trades = next.offers.filter((row) => me && (row.buyerId === me.id || row.sellerId === me.id)).map((offer) => ({
    offer,
    listing: next.listings.find((row) => row.id === offer.listingId) || null,
    handles: canReadHandles(next, me.id, offer, now) ? handlesFor(next, offer.sellerId) : null,
  }));
  return {
    me,
    feed,
    trades,
    mine: next.listings.filter((row) => me && row.sellerId === me.id),
    handles: me ? handlesFor(next, me.id) : null,
  };
}

export function canReadHandles(state, viewerId, offer, now) {
  if (!viewerId || !offer || offer.buyerId !== viewerId) return false;
  if (offer.status === 'paid') return true;
  return offer.status === 'accepted' && Number(offer.paymentDue) > now;
}

function apply(state, action, now) {
  if (!action || !action.type) return 'Missing action.';
  if (action.type === 'load') return null;
  if (action.type === 'sign') return sign(state, action);
  if (!state.me) return 'Sign in before using the market.';
  if (action.type === 'name') return rename(state, action);
  if (action.type === 'handles') return saveHandles(state, action);
  if (action.type === 'list') return list(state, action);
  if (action.type === 'withdraw') return withdraw(state, action);
  if (action.type === 'offer') return offer(state, action, now);
  if (action.type === 'buy') return buy(state, action, now);
  if (action.type === 'counter') return counter(state, action);
  if (action.type === 'accept') return accept(state, action, now);
  if (action.type === 'decline') return decline(state, action);
  if (action.type === 'paid') return paid(state, action, now);
  if (action.type === 'received') return received(state, action);
  if (action.type === 'rate') return rate(state, action);
  if (action.type === 'report') return report(state, action);
  if (action.type === 'block') return block(state, action);
  return 'Unknown action.';
}

function sign(state, action) {
  const id = String(action.user?.id || '').trim();
  const name = String(action.user?.name || '').trim();
  if (!id || id.length > 80) return 'A signed-in user is required.';
  if (name && (name.length < 1 || name.length > 40)) return 'Display name must be 40 characters or less.';
  state.me = { id, name: name || profile(state, id)?.name || '' };
  if (!profile(state, id)) state.profiles.push({ id, name: state.me.name, blocked: [] });
  return null;
}

function rename(state, action) {
  const name = String(action.name || '').trim();
  if (name.length < 1 || name.length > 40) return 'Display name must be 1 to 40 characters.';
  const row = profile(state, state.me.id);
  row.name = name;
  state.me = { ...state.me, name };
  return null;
}

function saveHandles(state, action) {
  const interac = clean(action.interac, 120);
  const paypal = clean(action.paypal, 80);
  if (interac.error || paypal.error) return 'A payment handle is too long.';
  if (!interac.value && !paypal.value) return 'Add an Interac email or a PayPal.me name.';
  const row = handlesFor(state, state.me.id);
  if (row) {
    row.interac = interac.value;
    row.paypal = paypal.value;
  } else {
    state.handles.push({ userId: state.me.id, interac: interac.value, paypal: paypal.value });
  }
  return null;
}

function list(state, action) {
  const name = String(action.name || '').trim();
  if (!name || name.length > 120) return 'Card name is required and must be 120 characters or less.';
  if (action.game !== 'ygo' && action.game !== 'mtg') return 'Choose Yu-Gi-Oh or Magic.';
  const ask = money(action.askCad);
  if (ask == null) return 'Asking price must be a CAD amount above 0.';
  const seller = profile(state, state.me.id);
  if (!seller?.name) return 'Set a display name before listing.';
  const open = state.listings.filter((row) => row.sellerId === state.me.id && (row.status === 'active' || row.status === 'reserved')).length;
  if (open >= MAX_OPEN_LISTINGS) return 'You already have 20 open listings.';
  const notes = optional(action.conditionNotes, 500);
  const centering = optional(action.centering, 160);
  const estimate = optional(action.estimateNote, 500);
  const setCode = optional(action.setCode, 24);
  const edition = optional(action.edition, 80);
  const rarity = optional(action.rarity, 40);
  if ([notes, centering, estimate, setCode, edition, rarity].some((row) => row.error)) return 'One of the text fields is too long.';
  if (action.photoPath && action.photoConsent !== true) return 'Photo was not stored because upload was not agreed to.';
  state.listings.push({
    id: nid(state),
    sellerId: state.me.id,
    sellerName: seller.name,
    game: action.game,
    name,
    setCode: setCode.value,
    edition: edition.value,
    rarity: rarity.value,
    conditionNotes: notes.value,
    centering: centering.value,
    estimateNote: estimate.value,
    askCad: ask,
    photoPath: action.photoConsent === true ? (action.photoPath || null) : null,
    status: 'active',
  });
  return null;
}

function withdraw(state, action) {
  const listing = mine(state, action.listingId);
  if (!listing) return 'That listing is not yours.';
  if (listing.status !== 'active') return 'Only an active listing can be withdrawn.';
  listing.status = 'withdrawn';
  return null;
}

function offer(state, action, now) {
  const listing = activeListing(state, action.listingId);
  if (!listing) return 'That listing is not available.';
  if (listing.sellerId === state.me.id) return 'You cannot offer on your own listing.';
  const amount = money(action.amount);
  if (amount == null) return 'Offer must be a CAD amount above 0.';
  if (openOffers(state, state.me.id).length >= MAX_OPEN_OFFERS) return 'You already have 10 open offers.';
  if (liveOffer(state, listing.id, state.me.id)) return 'You already have an open offer on this listing.';
  state.offers.push(baseOffer(state, listing, amount, 'pending', now));
  return null;
}

function buy(state, action, now) {
  const listing = activeListing(state, action.listingId);
  if (!listing) return 'That listing is not available.';
  if (listing.sellerId === state.me.id) return 'You cannot buy your own listing.';
  if (liveOffer(state, listing.id, state.me.id)) return 'You already have an open offer on this listing.';
  const row = baseOffer(state, listing, listing.askCad, 'accepted', now);
  row.paymentDue = now + PAY_WINDOW_MS;
  state.offers.push(row);
  reserve(state, listing, row.id);
  return null;
}

function counter(state, action) {
  const row = partyOffer(state, action.offerId);
  if (!row) return 'That offer is not visible to you.';
  if (row.status !== 'pending' && row.status !== 'countered') return 'This offer cannot be countered.';
  if (row.lastActor === state.me.id) return 'Wait for the other person to answer.';
  const amount = money(action.amount);
  if (amount == null) return 'Counter must be a CAD amount above 0.';
  row.amountCad = amount;
  row.status = 'countered';
  row.lastActor = state.me.id;
  return null;
}

function accept(state, action, now) {
  const row = partyOffer(state, action.offerId);
  if (!row) return 'That offer is not visible to you.';
  if (row.status !== 'pending' && row.status !== 'countered') return 'This offer cannot be accepted.';
  if (row.lastActor === state.me.id) return 'Wait for the other person to answer.';
  const listing = state.listings.find((item) => item.id === row.listingId);
  if (!listing || listing.status !== 'active') return 'That listing is not available.';
  row.status = 'accepted';
  row.paymentDue = now + PAY_WINDOW_MS;
  reserve(state, listing, row.id);
  return null;
}

function decline(state, action) {
  const row = partyOffer(state, action.offerId);
  if (!row) return 'That offer is not visible to you.';
  if (row.status !== 'pending' && row.status !== 'countered') return 'This offer cannot be declined.';
  if (row.lastActor === state.me.id) return 'Wait for the other person to answer.';
  row.status = 'declined';
  return null;
}

function paid(state, action, now) {
  const row = partyOffer(state, action.offerId);
  if (!row || row.buyerId !== state.me.id) return 'Only the buyer can mark this paid.';
  if (row.status !== 'accepted') return 'Payment is not open.';
  if (!(Number(row.paymentDue) > now)) return 'The 2-hour payment window has ended.';
  row.status = 'paid';
  return null;
}

function received(state, action) {
  const row = partyOffer(state, action.offerId);
  if (!row || row.sellerId !== state.me.id) return 'Only the seller can confirm receipt.';
  if (row.status !== 'paid') return 'The buyer has not marked this paid.';
  row.status = 'received';
  const listing = state.listings.find((item) => item.id === row.listingId);
  if (listing) listing.status = 'completed';
  return null;
}

function rate(state, action) {
  const row = partyOffer(state, action.offerId);
  if (!row) return 'That trade is not visible to you.';
  if (row.status !== 'received') return 'Rating opens after the seller confirms receipt.';
  const stars = Number(action.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return 'Rating must be a whole number from 1 to 5.';
  if (state.ratings.some((item) => item.offerId === row.id && item.raterId === state.me.id)) return 'You already rated this trade.';
  state.ratings.push({
    id: nid(state),
    offerId: row.id,
    raterId: state.me.id,
    rateeId: state.me.id === row.buyerId ? row.sellerId : row.buyerId,
    stars,
  });
  return null;
}

function report(state, action) {
  const reason = String(action.reason || '').trim();
  if (!reason || reason.length > 500) return 'A report needs a reason of 500 characters or less.';
  state.reports.push({
    id: nid(state),
    reporterId: state.me.id,
    listingId: action.listingId || null,
    reportedUser: action.userId || null,
    reason,
  });
  return null;
}

function block(state, action) {
  const id = String(action.userId || '').trim();
  if (!id || id === state.me.id) return 'You cannot block yourself.';
  const row = profile(state, state.me.id);
  if (!row.blocked.includes(id)) row.blocked.push(id);
  return null;
}

function expireOffers(state, now) {
  for (const row of state.offers) {
    if (row.status === 'accepted' && !(Number(row.paymentDue) > now)) {
      row.status = 'expired';
      const listing = state.listings.find((item) => item.id === row.listingId);
      if (listing && listing.status === 'reserved' && listing.reservedOfferId === row.id) {
        listing.status = 'active';
        listing.reservedOfferId = null;
      }
    }
  }
}

function reserve(state, listing, offerId) {
  listing.status = 'reserved';
  listing.reservedOfferId = offerId;
  for (const other of state.offers) {
    if (other.listingId === listing.id && other.id !== offerId && (other.status === 'pending' || other.status === 'countered')) {
      other.status = 'declined';
    }
  }
}

function baseOffer(state, listing, amount, status, now) {
  return {
    id: nid(state),
    listingId: listing.id,
    buyerId: state.me.id,
    sellerId: listing.sellerId,
    amountCad: amount,
    status,
    lastActor: state.me.id,
    paymentDue: null,
    createdAt: now,
  };
}

function activeListing(state, id) {
  const listing = state.listings.find((row) => row.id === id);
  return listing && listing.status === 'active' ? listing : null;
}

function partyOffer(state, id) {
  const row = state.offers.find((item) => item.id === id);
  if (!row) return null;
  if (row.buyerId !== state.me.id && row.sellerId !== state.me.id) return null;
  return row;
}

function liveOffer(state, listingId, buyerId) {
  return state.offers.find((row) => row.listingId === listingId && row.buyerId === buyerId && ['pending', 'countered', 'accepted', 'paid'].includes(row.status));
}

function openOffers(state, buyerId) {
  return state.offers.filter((row) => row.buyerId === buyerId && ['pending', 'countered', 'accepted', 'paid'].includes(row.status));
}

function mine(state, id) {
  const listing = state.listings.find((row) => row.id === id);
  return listing && listing.sellerId === state.me.id ? listing : null;
}

function profile(state, id) {
  return state.profiles.find((row) => row.id === id) || null;
}

function handlesFor(state, userId) {
  return state.handles.find((row) => row.userId === userId) || null;
}

function nid(state) {
  state.seq += 1;
  return `m${state.seq}`;
}

function money(value) {
  const n = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isFinite(n) || n <= 0 || n >= 1000000) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

function clean(value, max) {
  const text = String(value || '').trim();
  if (text.length > max) return { error: true, value: null };
  return { error: false, value: text || null };
}

function optional(value, max) {
  if (value == null || String(value).trim() === '') return { error: false, value: null };
  return clean(value, max);
}
