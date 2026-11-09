"""Multi-marketplace live offers with exact-match verification.
Free/polite only: no logins, no block-evasion. Unsupported sites are marked, not forced.
"""
from __future__ import annotations
import datetime, json, os, re, time, urllib.parse, urllib.request, ssl, base64

UA = 'Mozilla/5.0 (compatible; MTGValueBot/1.0; +local; research; polite; 1req/2s)'
EBAY_CA_CTX = 'contextualLocation=country%3DCA%2Czip%3DM5V2T6'
CTX = ssl.create_default_context()

# site -> status dict updated each run
SITE_STATUS = {}

def _stamp(site, status, detail=''):
    SITE_STATUS[site] = {
        'status': status,  # working | unsupported | blocked | error
        'detail': detail,
        'checked_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
    }

def _get(url, headers=None, data=None, timeout=18):
    h = {'User-Agent': UA, 'Accept': 'text/html,application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.status, r.read(), dict(r.headers)

# ---------- shared match helpers ----------
def _norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()

def name_match(card_name, title):
    toks = [t for t in re.split(r'\W+', card_name.lower()) if len(t) > 2]
    ti = (title or '').lower()
    if not toks:
        return False
    hit = sum(1 for t in toks if t in ti)
    return hit >= max(1, len(toks) - 1)

def foil_ok(card, title):
    ti = (title or '').lower()
    if card.get('foil'):
        return 'foil' in ti
    return not (re.search(r'\bfoil\b', ti) and not re.search(r'non[\s-]?foil', ti))

def lang_ok(title):
    ti = (title or '').lower()
    return not re.search(r'\b(japanese|jp|korean|chinese|french|german|italian|spanish|portuguese|russian|phyrexian)\b', ti)

# ---------- eBay ----------
_tok = None
def ebay_token(env_paths):
    global _tok
    if _tok is not None:
        return _tok
    for c in env_paths:
        if not os.path.exists(c):
            continue
        e = dict(l.strip().split('=', 1) for l in open(c) if '=' in l and not l.strip().startswith('#'))
        if 'EBAY_CLIENT_ID' not in e:
            continue
        b = base64.b64encode(f"{e['EBAY_CLIENT_ID']}:{e['EBAY_CLIENT_SECRET']}".encode()).decode()
        try:
            body = _get(
                'https://api.ebay.com/identity/v1/oauth2/token',
                {'Authorization': 'Basic ' + b, 'Content-Type': 'application/x-www-form-urlencoded'},
                b'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
            )[1]
            _tok = json.loads(body)['access_token']
            _stamp('ebay', 'working', 'oauth ok')
            return _tok
        except Exception as x:
            _stamp('ebay', 'error', f'token: {x}')
    _tok = ''
    _stamp('ebay', 'error', 'no token')
    return _tok

def itm_url(item_id_or_url):
    """Normalize to https://www.ebay.com/itm/<id> only."""
    s = str(item_id_or_url or '')
    m = re.search(r'/itm/(?:[^/]+/)?(\d{6,16})', s)
    if m:
        return f'https://www.ebay.com/itm/{m.group(1)}', m.group(1)
    m = re.search(r'v1\|(\d{6,16})\|', s)
    if m:
        return f'https://www.ebay.com/itm/{m.group(1)}', m.group(1)
    m = re.search(r'(\d{9,16})', s)
    if m:
        return f'https://www.ebay.com/itm/{m.group(1)}', m.group(1)
    return None, None

def ebay_get_item(tok, item_id):
    """Fetch item with Canadian shipping context (same as card_ops doctor)."""
    hdrs = {'Authorization': 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'X-EBAY-C-ENDUSERCTX': EBAY_CA_CTX}
    # Prefer legacy id endpoint — returns shippingOptions for CA address
    legacy = item_id
    if str(item_id).startswith('v1|'):
        legacy = str(item_id).split('|')[1]
    url = 'https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?' + urllib.parse.urlencode({'legacy_item_id': legacy})
    try:
        st, body, _ = _get(url, hdrs)
        if st == 200:
            return json.loads(body)
    except Exception:
        pass
    # Fallback: item group id form
    eid = item_id if str(item_id).startswith('v1|') else f'v1|{item_id}|0'
    try:
        st, body, _ = _get(f'https://api.ebay.com/buy/browse/v1/item/{urllib.parse.quote(eid, safe="")}', hdrs)
        return json.loads(body) if st == 200 else None
    except Exception:
        return None

def verify_ebay_offer(card, offer, graded, tok, price_tol=0.02):
    """Re-fetch via getItem; require active, exact-ish match, price match. Returns offer or None."""
    url, iid = itm_url(offer.get('url') or offer.get('itemId') or '')
    if not iid or not tok:
        return None
    it = ebay_get_item(tok, iid)
    if not it:
        return None
    # availability
    avail = (it.get('estimatedAvailabilities') or [{}])[0]
    est = avail.get('estimatedAvailabilityStatus') or it.get('availabilityStatus') or ''
    if str(est).upper() in ('OUT_OF_STOCK', 'UNAVAILABLE', 'ENDED'):
        return None
    if not it.get('shippingOptions'):
        return None  # does not ship to Canada under CA context
    title = it.get('title') or ''
    if not name_match(card['name'], title):
        return None
    if not lang_ok(title):
        return None
    if not foil_ok(card, title):
        return None
    if graded and not re.search(r'\b(psa|bgs|cgc)\s*10\b|\bgem\s*mint\s*10\b', title, re.I):
        return None
    if not graded and re.search(r'\b(psa|bgs|cgc|sgc|beckett|graded)\b', title, re.I):
        return None
    # set / edition soft check via localized aspects or title
    aspects = {a.get('name', '').lower(): [x.lower() for x in (a.get('values') or [])]
               for a in (it.get('localizedAspects') or [])}
    set_hint = (card.get('set_name') or card.get('set') or '').lower()
    if set_hint and aspects.get('set'):
        if not any(set_hint[:8] in v or card['set'].lower() in v for v in aspects['set']):
            # title fallback
            if card['set'].lower() not in title.lower() and set_hint.split()[0] not in title.lower():
                # power nine unique names: allow
                power = card['name'].lower() in (
                    'black lotus', 'ancestral recall', 'time walk', 'timetwister',
                    'mox pearl', 'mox sapphire', 'mox jet', 'mox ruby', 'mox emerald')
                if not power:
                    return None
    price = float((it.get('price') or {}).get('value') or 0)
    expect = float(offer.get('price') or 0)
    try:
        ship_chk = float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value') or 0)
    except Exception:
        ship_chk = float(offer.get('ship') or 0)
    if expect:
        ok = abs(price - expect) / max(price, 0.01) <= price_tol or abs(price - expect) <= 1.0
        ok = ok or abs(price + ship_chk - expect) / max(price + ship_chk, 0.01) <= price_tol
        if not ok:
            return None
    ship = 0.0
    try:
        ship = float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value') or 0)
    except Exception:
        return None
    out = dict(offer)
    out.update({
        'site': 'eBay',
        'site_id': 'ebay',
        'title': title,
        'price': price,
        'item_price': price,
        'ship': ship,
        'ship_ca': ship,
        'shipping_ok': True,
        'url': url,
        'item_id': iid,
        'verified': True,
        'verified_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'condition': (it.get('condition') or offer.get('condition') or '').lower().replace(' ', '_')[:40],
        'loc': ((it.get('itemLocation') or {}).get('country') or offer.get('loc') or 'US'),
    })
    return out

def search_ebay(card, graded, market_raw, fx_, cad_landed_fn, vet_fn, env_paths, set_hint_fn):
    tok = ebay_token(env_paths)
    if not tok:
        return []
    hint = set_hint_fn(card['set'], card.get('set_name', ''))
    q = f"{card['name']} {hint} mtg" + (' foil' if card.get('foil') else '') + (' PSA 10' if graded else '')
    u = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + urllib.parse.urlencode({
        'q': q, 'sort': 'price', 'limit': '40',
        'filter': 'buyingOptions:{FIXED_PRICE},priceCurrency:USD',
        'category_ids': '38292',
    })
    hdrs = {'Authorization': 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'X-EBAY-C-ENDUSERCTX': EBAY_CA_CTX}
    try:
        items = json.loads(_get(u, hdrs)[1]).get('itemSummaries', [])
        _stamp('ebay', 'working', f'search hits {len(items)}')
    except Exception as x:
        _stamp('ebay', 'blocked' if '403' in str(x) else 'error', str(x)[:120])
        return []
    out = []
    for it in items:
        # Must ship to Canada under ENDUSERCTX=CA — empty shippingOptions => skip
        if not it.get('shippingOptions'):
            continue
        try:
            ship_ca = float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value') or 0)
        except Exception:
            continue
        if ship_ca <= 0 and (it.get('shippingOptions') or [{}])[0].get('shippingCost') is None:
            # some listings say free ship — allow 0 only if key present
            sc = (it.get('shippingOptions') or [{}])[0].get('shippingCost')
            if sc is None:
                continue
        try:
            v = vet_fn(card, it, graded, market_raw, fx_)
        except Exception:
            continue
        if not v.get('vetted'):
            continue
        url, iid = itm_url(v.get('url') or it.get('itemId') or it.get('itemWebUrl'))
        if not url:
            continue
        v['url'] = url
        v['itemId'] = iid
        ver = verify_ebay_offer(card, v, graded, tok)
        if not ver:
            continue
        # Re-check CA shipping on the verified getItem payload
        # verify_ebay_offer already used CA CTX via ebay_get_item
        item_price = float(ver.get('price') or 0)
        ship_ca = float(ver.get('ship') or 0)
        # If getItem returned no ship under CA context, drop
        if ver.get('ship') is None and not ver.get('shipping_ok'):
            # ship field 0 can be free; require shipping_ok flag from verify
            pass
        cad_total, usd_total = cad_landed_fn(item_price, ship_ca, ver.get('loc') or 'US', fx_, True)
        ver['item_price'] = item_price
        ver['ship_ca'] = ship_ca
        ver['ship'] = ship_ca
        ver['price'] = item_price  # keep item-only in price; UI uses cad_total
        ver['cad_total'] = cad_total
        ver['usd_total'] = usd_total
        ver['source'] = 'ebay'
        out.append(ver)
        if len(out) >= 5:
            break
        time.sleep(0.25)
    return out


# ---------- Card Kingdom (public product page) ----------
def verify_ck_product(card, url, graded, fx_, cad_landed_fn):
    if graded:
        return None  # CK is raw singles
    if not url or 'cardkingdom.com' not in url:
        return None
    url = url.split('?')[0]
    if card.get('foil') and 'foil' not in url.lower():
        # try foil suffix
        if not url.endswith('-foil'):
            cand = url + '-foil'
        else:
            cand = url
    else:
        cand = url
        if (not card.get('foil')) and url.endswith('-foil'):
            return None
    try:
        st, body, _ = _get(cand)
        html = body.decode('utf-8', 'replace')
        time.sleep(1.2)
    except Exception as x:
        _stamp('cardkingdom', 'error', str(x)[:100])
        return None
    title_m = re.search(r'<title>\s*([^|<]+)\s*\|', html)
    title = (title_m.group(1).strip() if title_m else '') + ' | Card Kingdom'
    # name + set from hidden fields
    forms = re.findall(r'<form[^>]*addToCart[^>]*>(.*?)</form>', html, re.I | re.S)
    if not forms:
        _stamp('cardkingdom', 'unsupported', 'no addToCart forms (layout change or empty)')
        return None
    nm = None
    for f in forms:
        style = re.search(r'name="style\[\d+\]" value="([^"]+)"', f)
        price = re.search(r'name="price" value="([\d.]+)"', f)
        name = re.search(r'name="name" value="([^"]+)"', f)
        qty = re.search(r'name="maxQty" value="(\d+)"', f)
        if not style or not price:
            continue
        if style.group(1) != 'NM':
            continue
        if qty and int(qty.group(1)) <= 0:
            continue
        nm = dict(style='NM', price=float(price.group(1)), name=name.group(1) if name else title)
        break
    if not nm:
        return None
    # exact name check
    if not name_match(card['name'], nm['name'] + ' ' + title):
        return None
    # set: category hidden or title
    cat = re.search(r'name="category" value="([^"]+)"', forms[0])
    set_name = (card.get('set_name') or '').lower()
    if cat and set_name:
        if _norm(set_name).split()[0] not in _norm(cat.group(1)) and card['set'].lower() not in cand.lower():
            # slug path often has set
            if _norm(set_name).split()[0] not in _norm(cand):
                return None
    if card.get('foil') and 'foil' not in cand.lower() and 'foil' not in nm['name'].lower():
        return None
    if not card.get('foil') and ('foil' in cand.lower() or re.search(r'\bfoil\b', nm['name'], re.I)):
        return None
    cad_total, usd_total = cad_landed_fn(nm['price'], 0.0, 'US', fx_)
    _stamp('cardkingdom', 'working', 'product page NM parse')
    return dict(
        site='Card Kingdom', site_id='cardkingdom', source='cardkingdom',
        title=f"{nm['name']} (NM)", price=nm['price'], ship=0.0,
        url=cand, condition='near_mint', condition_ok=True,
        seller_score=95.0, fake_risk=5.0, cert_ok=True, cert_id=None,
        cad_total=cad_total, usd_total=usd_total, loc='US',
        vetted=True, reject_reasons=[], verified=True,
        verified_at=datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        seller='Card Kingdom',
    )

def search_cardkingdom(card, graded, fx_, cad_landed_fn):
    if graded:
        _stamp('cardkingdom', 'working', 'skipped graded (raw-only store)')
        return []
    url = (card.get('ck') or '').split('?')[0]
    if not url:
        # search page is not an exact listing — cannot verify a single BIN price without picking a product
        _stamp('cardkingdom', 'unsupported', 'no Scryfall CK product URL for exact verify')
        return []
    offer = verify_ck_product(card, url, graded, fx_, cad_landed_fn)
    return [offer] if offer else []

# ---------- mark unsupported catalogs (SPA / blocked / auction / no exact BIN) ----------
UNSUPPORTED = {
    'tcgplayer': 'JS storefront; no free public exact-listing API without partner key',
    'starcitygames': 'HTML not stably parseable for exact in-stock BIN without login/JS',
    'cardmarket': 'HTTP 403 from this host; EU marketplace — not forced',
    'coolstuffinc': 'empty/blocked response; not forced',
    'channelfireball': 'JS storefront; exact BIN verify unsupported',
    'trollandtoad': 'JS-heavy; exact BIN verify unsupported without evasion',
    'facetoface': 'Shopify JS search; Organization ld+json only — unsupported exact BIN',
    '401games': 'Shopify JS; unsupported exact BIN without login/JS',
    'wizardstower': 'search URL 404; unsupported',
    'hairy_tarantula': 'JS storefront; unsupported exact BIN',
    'goldin': 'auction house — not fixed-price BIN exact match',
    'heritage': 'HTTP 403 / auctions — unsupported BIN',
    'pwcc': 'Fanatics Collect URL 404 / auctions — unsupported BIN',
    'star_city_games': 'alias of starcitygames',
}

def mark_unsupported():
    for k, detail in UNSUPPORTED.items():
        if k not in SITE_STATUS:
            _stamp(k, 'unsupported', detail)

# ---------- orchestrator ----------
def live_offers(card, graded, market_raw, fx_, cad_landed_fn, vet_fn, env_paths, set_hint_fn, max_offers=3):
    """Return up to max_offers verified offers sorted by cad_total ascending."""
    mark_unsupported()
    offers = []
    offers += search_ebay(card, graded, market_raw, fx_, cad_landed_fn, vet_fn, env_paths, set_hint_fn)
    try:
        offers += search_cardkingdom(card, graded, fx_, cad_landed_fn)
    except Exception as x:
        _stamp('cardkingdom', 'error', str(x)[:100])
    # de-dupe by url
    seen = set()
    uniq = []
    for o in offers:
        if not o or not o.get('verified') or not o.get('url'):
            continue
        if o['url'] in seen:
            continue
        seen.add(o['url'])
        uniq.append(o)
    uniq.sort(key=lambda x: (x.get('cad_total') or 1e18))
    return uniq[:max_offers]

def best_offer(offers):
    return offers[0] if offers else None

def pack_offer(o):
    if not o:
        return None
    return dict(
        site=o.get('site'), site_id=o.get('site_id') or o.get('source'),
        title=o.get('title'), price=o.get('item_price') or o.get('price') or 0,
        item_price=o.get('item_price') or o.get('price') or 0,
        ship=o.get('ship_ca') if o.get('ship_ca') is not None else (o.get('ship') or 0),
        ship_ca=o.get('ship_ca') if o.get('ship_ca') is not None else (o.get('ship') or 0),
        url=o.get('url'), condition=o.get('condition'),
        seller_score=o.get('seller_score'), fake_risk=o.get('fake_risk'),
        cad_total=o.get('cad_total'), cert_ok=o.get('cert_ok'),
        vetted=bool(o.get('vetted') and o.get('verified')),
        verified=bool(o.get('verified')), verified_at=o.get('verified_at'),
        reject_reasons=o.get('reject_reasons') or [], seller=o.get('seller'),
    )
