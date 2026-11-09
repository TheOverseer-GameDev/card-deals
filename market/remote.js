import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

export function isConfigured(url = SUPABASE_URL, key = SUPABASE_ANON_KEY) {
  return Boolean(String(url || '').trim() && String(key || '').trim());
}

export async function openRemote(url = SUPABASE_URL, key = SUPABASE_ANON_KEY) {
  if (!isConfigured(url, key)) return null;
  const { createClient } = await import('./vendor/supabase.js');
  const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return {
    async dispatch(action) {
      try {
        return { ok: true, ...(await run(supabase, action)) };
      } catch (err) {
        return { ok: false, error: err.message || 'The market request failed.' };
      }
    },
    async view() {
      const { data: session } = await supabase.auth.getSession();
      const me = session.session?.user
        ? { id: session.session.user.id, name: '' }
        : null;
      if (me) {
        const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', me.id).maybeSingle();
        me.name = profile?.display_name || '';
      }
      const { data: listings, error } = await supabase.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      let trades = [];
      let mine = [];
      let handles = null;
      if (me) {
        const { data: own } = await supabase.from('listings').select('*').eq('seller_id', me.id);
        mine = (own || []).map(fromListing);
        const { data: offers } = await supabase.from('offers').select('*').or(`buyer_id.eq.${me.id},seller_id.eq.${me.id}`);
        trades = [];
        for (const row of offers || []) {
          const offer = fromOffer(row);
          let seen = null;
          if (offer.buyerId === me.id && (offer.status === 'paid' || offer.status === 'accepted')) {
            const { data: handle } = await supabase.from('payment_handles').select('interac_email, paypal_me').eq('user_id', offer.sellerId).maybeSingle();
            seen = handle ? { interac: handle.interac_email, paypal: handle.paypal_me } : null;
          }
          trades.push({ offer, listing: null, handles: seen });
        }
        const { data: mineHandles } = await supabase.from('payment_handles').select('interac_email, paypal_me').eq('user_id', me.id).maybeSingle();
        handles = mineHandles ? { interac: mineHandles.interac_email, paypal: mineHandles.paypal_me } : null;
      }
      return { me, feed: (listings || []).map(fromListing), trades, mine, handles };
    },
  };
}

async function run(supabase, action) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (action.type === 'sign-in') {
    const { error } = await supabase.auth.signInWithOtp({
      email: String(action.email || '').trim(),
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'sign-out') {
    await supabase.auth.signOut();
    return {};
  }
  if (!uid) throw new Error('Sign in before using the market.');
  if (action.type === 'name') {
    const { error } = await supabase.from('profiles').upsert({ id: uid, display_name: String(action.name || '').trim() });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'handles') {
    const { error } = await supabase.from('payment_handles').upsert({
      user_id: uid,
      interac_email: empty(action.interac),
      paypal_me: empty(action.paypal),
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'list') {
    if (action.photoPath && action.photoConsent !== true) throw new Error('Photo was not stored because upload was not agreed to.');
    let photo = null;
    if (action.photoConsent === true && action.photoFile) {
      const path = `${uid}/${crypto.randomUUID()}`;
      const { error: up } = await supabase.storage.from('listing-photos').upload(path, action.photoFile);
      if (up) throw new Error(up.message);
      photo = path;
    }
    const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', uid).single();
    const { error } = await supabase.from('listings').insert({
      seller_id: uid,
      seller_name: profile.display_name,
      game: action.game,
      name: action.name,
      set_code: empty(action.setCode),
      edition: empty(action.edition),
      rarity: empty(action.rarity),
      condition_notes: empty(action.conditionNotes),
      centering: empty(action.centering),
      estimate_note: empty(action.estimateNote),
      vaulted: action.vaulted === true,
      psa_cert: action.vaulted === true ? empty(action.psaCert) : null,
      vault_url: action.vaulted === true ? empty(action.vaultUrl) : null,
      ask_cad: action.askCad,
      photo_path: photo,
      status: 'active',
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'offer' || action.type === 'buy') {
    const { data: listing, error: read } = await supabase.from('listings').select('seller_id, ask_cad, status, vaulted').eq('id', action.listingId).single();
    if (read) throw new Error(read.message);
    if (listing.vaulted) throw new Error('A vaulted card is bought through the PSA or eBay listing, not an offer here.');
    const buy = action.type === 'buy';
    const { error } = await supabase.from('offers').insert({
      listing_id: action.listingId,
      buyer_id: uid,
      seller_id: listing.seller_id,
      amount_cad: buy ? listing.ask_cad : action.amount,
      status: buy ? 'accepted' : 'pending',
      last_actor: uid,
      payment_due: buy ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() : null,
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (['accept', 'decline', 'counter', 'paid', 'received'].includes(action.type)) {
    const patch = { status: action.type === 'counter' ? 'countered' : action.type === 'paid' ? 'paid' : action.type === 'received' ? 'received' : action.type === 'accept' ? 'accepted' : 'declined' };
    if (action.type === 'counter') patch.amount_cad = action.amount;
    if (action.type === 'accept') patch.payment_due = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    patch.last_actor = uid;
    const { error } = await supabase.from('offers').update(patch).eq('id', action.offerId);
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'rate') {
    const { error } = await supabase.from('ratings').insert({
      offer_id: action.offerId,
      rater_id: uid,
      ratee_id: action.rateeId,
      stars: action.stars,
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'report') {
    const { error } = await supabase.from('reports').insert({
      reporter_id: uid,
      listing_id: action.listingId || null,
      reported_user: action.userId || null,
      reason: action.reason,
    });
    if (error) throw new Error(error.message);
    return {};
  }
  if (action.type === 'block') {
    const { data: profile, error: read } = await supabase.from('profiles').select('blocked').eq('id', uid).single();
    if (read) throw new Error(read.message);
    const blocked = Array.from(new Set([...(profile.blocked || []), action.userId]));
    const { error } = await supabase.from('profiles').update({ blocked }).eq('id', uid);
    if (error) throw new Error(error.message);
    return {};
  }
  throw new Error('Unknown action.');
}

function fromListing(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    game: row.game,
    name: row.name,
    setCode: row.set_code,
    edition: row.edition,
    rarity: row.rarity,
    conditionNotes: row.condition_notes,
    centering: row.centering,
    estimateNote: row.estimate_note,
    vaulted: row.vaulted === true,
    psaCert: row.psa_cert,
    vaultUrl: row.vault_url,
    askCad: Number(row.ask_cad),
    photoPath: row.photo_path,
    status: row.status,
  };
}

function fromOffer(row) {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountCad: Number(row.amount_cad),
    status: row.status,
    lastActor: row.last_actor,
    paymentDue: row.payment_due ? Date.parse(row.payment_due) : null,
  };
}

function empty(value) {
  const text = String(value || '').trim();
  return text || null;
}
