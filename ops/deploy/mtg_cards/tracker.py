#!/usr/bin/env python3
"""Free zero-token Magic: The Gathering value tracker. ADVICE ONLY: never buys, bids or checks out.
Sources: Scryfall (Reserved List + discovery + daily prices + purchase links), PriceCharting (sold monthly history + graded),
MTGJSON AllPricesToday (retail cross-check, cached), eBay Browse API (live BIN), Frankfurter (FX),
MTGGoldfish + Google News RSS (events). PSA pop is best-effort (psacard blocks bots -> era heuristic).
Focus: Reserved List first (is:reserved; Wizards never reprints these), then continuously discover other
value-holding prints (old/low-print, staples, collector printings) via trends and projected long-term value.
"""
import os, re, json, sys, time, sqlite3, urllib.request, urllib.parse, urllib.error, base64, datetime, html, statistics as st, csv, math, sys
D = os.path.dirname(os.path.abspath(__file__))
P = lambda f: os.path.join(D, f)
C = json.load(open(P('config.json')))
import markets as M
import sys as _sys
_sys.path.insert(0, os.path.join(os.environ.get('CARD_ROOT','/workspace'), 'card_common'))
import categories as CAT
UA = {'User-Agent': 'GrokBotMTGTracker/1.0 (personal price tracker; 1 req/3s; advice-only)', 'Accept': 'application/json,text/html,*/*'}
LANG = r'\b(japanese|jp|korean|kr|german|french|italian|spanish|portuguese|chinese|russian|phyrexian|korean)\b'
FAKE = r'\b(proxy|orica|custom|replica|fan ?made|altered art(?! official)|not authentic|counterfeit|playtest|credit\s*card\s*skin|debit\s*card|card\s*skin|vinyl\s*skin|sticker\s*skin|art\s*print|poster|playmat|sleeve|deck\s*box|bootleg|fake|reproduction|mystery\s*pack|scramble\s*mystery)\b'
DAMAGED = r'\b(damaged|heavily\s*played|\bhp\b|poor\b|for\s*parts|water\s*damage|creased|torn|written\s*on|marked|inked)\b'
# PriceCharting set search hints for classic / RL-heavy sets
SET_HINT = {
    'lea': 'Alpha', 'leb': 'Beta', '2ed': 'Unlimited', '3ed': 'Revised', 'ced': "Collector's Edition",
    'cei': 'International Edition', 'arn': 'Arabian Nights', 'atq': 'Antiquities', 'leg': 'Legends',
    'drk': 'The Dark', 'fem': 'Fallen Empires', 'ice': 'Ice Age', 'hml': 'Homelands', 'all': 'Alliances',
    'chr': 'Chronicles', 'mir': 'Mirage', 'vis': 'Visions', 'wth': 'Weatherlight', 'tmp': 'Tempest',
    'sth': 'Stronghold', 'exo': 'Exodus', 'usg': "Urza's Saga", 'ulg': "Urza's Legacy", 'uds': "Urza's Destiny",
    'mmq': 'Mercadian Masques', 'nem': 'Nemesis', 'pcy': 'Prophecy', 'inv': 'Invasion', 'pls': 'Planeshift',
    'apc': 'Apocalypse', 'ody': 'Odyssey', 'tor': 'Torment', 'jud': 'Judgment', 'ons': 'Onslaught',
    'lgn': 'Legions', 'scg': 'Scourge', '4ed': 'Fourth Edition', '5ed': 'Fifth Edition',
    '6ed': 'Classic Sixth Edition', '7ed': 'Seventh Edition', '8ed': 'Eighth Edition', '9ed': 'Ninth Edition',
    'ptk': 'Portal Three Kingdoms', 'por': 'Portal', 'p02': 'Portal Second Age', 's99': 'Starter 1999',
    'mh2': 'Modern Horizons 2', 'mh3': 'Modern Horizons 3', '2xm': 'Double Masters', '2x2': 'Double Masters 2022',
    'uma': 'Ultimate Masters', 'mm2': 'Modern Masters 2015', 'mm3': 'Modern Masters 2017', 'mma': 'Modern Masters',
    'v09': 'From the Vault Exiled', 'v10': 'From the Vault Relics', 'v11': 'From the Vault Legends',
    'v14': 'From the Vault Annihilation', 'v16': 'From the Vault Lore', 'v17': 'From the Vault Transform',
    'ms1': 'Mystery Booster', 'mb1': 'Mystery Booster', 'plist': 'The List', 'sld': 'Secret Lair',
    'jud': 'Judgment', 'c13': 'Commander 2013', 'c14': 'Commander 2014', 'c15': 'Commander 2015',
    'c16': 'Commander 2016', 'c17': 'Commander 2017', 'c18': 'Commander 2018', 'c19': 'Commander 2019',
    'c20': 'Commander 2020', 'c21': 'Commander 2021', 'cmr': 'Commander Legends', 'clb': 'Battle for Baldur\'s Gate',
    'mh1': 'Modern Horizons', 'tsr': 'Time Spiral Remastered', 'dmr': 'Dominaria Remastered',
    'rvr': 'Ravnica Remastered', 'spg': 'Special Guests', 'otp': 'Breaking News',
}

def get(u, h=None, data=None, t=30, accept_html=False):
    """Same guarded transport as the Yu-Gi-Oh tracker. No local retry loop on 429."""
    root = os.environ.get('CARD_ROOT', '/workspace')
    ygo = os.path.join(root, 'ygo_cards')
    if ygo not in sys.path:
        sys.path.insert(0, ygo)
    import tracker as ygo_tracker
    headers = {**UA, **(h or {})}
    if accept_html:
        headers['Accept'] = 'text/html,application/xhtml+xml,*/*'
    return ygo_tracker.get(u, headers, data, t)

def get_json(u, t=60):
    return json.loads(get(u, t=t)[1])

def fx():
    try:
        return get_json('https://api.frankfurter.app/latest?from=USD&to=CAD')['rates']['CAD']
    except Exception:
        return 1.40

def set_hint(code, set_name=''):
    if code in SET_HINT:
        return SET_HINT[code]
    sn = set_name or ''
    sn = re.sub(r'^(Limited Edition|Magic: The Gathering)\s*', '', sn, flags=re.I)
    sn = re.sub(r'\s*Edition$', '', sn, flags=re.I).strip()
    return sn or code

# ---------- universe (Scryfall) ----------
def scry_pages(query, max_pages=40):
    """Paginate Scryfall search. Polite delay."""
    out = []; url = 'https://api.scryfall.com/cards/search?' + urllib.parse.urlencode({'q': query, 'unique': 'prints', 'order': 'usd', 'dir': 'desc'})
    pages = 0
    while url and pages < max_pages:
        try:
            j = get_json(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break
            raise
        out.extend(j.get('data') or [])
        url = j.get('next_page')
        pages += 1
        time.sleep(C['scryfall_delay_s'])
    return out

def card_key(c, foil=False):
    return f"{c['name']}|{c['set']}|{c.get('collector_number','')}|{'1' if foil else '0'}"

def from_scry(c, foil=False, pri=1.0):
    usd = c.get('prices') or {}
    price = None
    if foil:
        price = usd.get('usd_foil') or usd.get('usd_etched')
    else:
        price = usd.get('usd')
    try:
        price = float(price) if price else 0.0
    except Exception:
        price = 0.0
    return dict(
        name=c['name'], set=c['set'], set_name=c.get('set_name', ''), num=str(c.get('collector_number', '')),
        rarity=c.get('rarity', ''), foil=bool(foil), reserved=bool(c.get('reserved')), lang=c.get('lang', 'en'),
        scryfall_id=c.get('id', ''), uri=c.get('scryfall_uri') or c.get('uri', ''),
        tcg= (c.get('purchase_uris') or {}).get('tcgplayer', ''),
        ck= (c.get('purchase_uris') or {}).get('cardkingdom', ''),
        usd=price, released=c.get('released_at') or '', pri=pri,
        reprint=bool(c.get('reprint')), frame=c.get('frame', ''), promo=bool(c.get('promo')),
        set_type=c.get('set_type', ''), digital=bool(c.get('digital')),
    )

def universe(force=False):
    """Massive Scryfall universe: RL + old sets + staples + collector printings, USD>~C$20."""
    cache = P('scryfall_universe.json')
    ttl = 6 * 3600 if force else 86400
    if (not force) and os.path.exists(cache) and time.time() - os.path.getmtime(cache) < ttl:
        try:
            blob = json.load(open(cache))
            return {k: v for k, v in blob['U'].items()}, blob.get('meta', {})
        except Exception:
            pass
    U = {}; meta = {}
    print('fetching Reserved List prints from Scryfall...')
    rl = scry_pages('is:reserved lang:en -is:digital', max_pages=80)
    print(f'  RL prints: {len(rl)}')
    for c in rl:
        if c.get('digital'):
            continue
        # nonfoil if available
        if c.get('nonfoil', True) and (c.get('prices') or {}).get('usd') is not None or c.get('nonfoil', True):
            k = card_key(c, False)
            pri = C['rl_priority_boost'] * (1 + math.log10(1 + float((c.get('prices') or {}).get('usd') or 1)))
            U[k] = from_scry(c, False, pri)
        if c.get('foil') and (c.get('prices') or {}).get('usd_foil'):
            k = card_key(c, True)
            pri = C['rl_priority_boost'] * (1 + math.log10(1 + float((c.get('prices') or {}).get('usd_foil') or 1)))
            U[k] = from_scry(c, True, pri)
        meta[c['name']] = {
            'reserved': True, 'oracle_id': c.get('oracle_id'),
            'type_line': c.get('type_line', ''), 'n_prints_known': meta.get(c['name'], {}).get('n_prints_known', 0) + 1,
        }
    floor = float(C.get('discover_usd_floor', 14))  # ~C$20
    print(f'fetching discovery prints (usd>={floor}, not reserved)...')
    disc = []
    for q, pages in (
        (f'-is:reserved lang:en -is:digital usd>={floor} year<=2007', 40),
        (f'-is:reserved lang:en -is:digital usd>={floor} (is:masterpiece OR frame:extended OR frame:showcase OR set_type:masters OR set_type:from_the_vault OR set_type:memorabilia)', 30),
        (f'-is:reserved lang:en -is:digital usd>={max(floor,20)} rarity:mythic', 25),
        (f'-is:reserved lang:en -is:digital usd>={max(floor,25)}', 35),
    ):
        print(f'  query: {q[:70]}...')
        disc.extend(scry_pages(q, max_pages=pages))
    # de-dupe by id+foil later via U keys
    print(f'  discovery prints (raw hits): {len(disc)}')
    for c in disc:
        if c.get('digital'):
            continue
        # prefer English paper; boost old / low-print / mythic / special frames
        year = int((c.get('released_at') or '2099')[:4])
        age_boost = 2.0 if year <= 2003 else (1.5 if year <= 2015 else 1.0)
        special = 1.8 if c.get('set_type') in ('masters', 'masterpiece', 'from_the_vault', 'memorabilia', 'commander', 'draft_innovation') else 1.0
        rarity_boost = 1.5 if c.get('rarity') in ('mythic', 'special', 'bonus') else 1.0
        for foil in (False, True):
            if foil and not c.get('foil'):
                continue
            if not foil and c.get('nonfoil') is False:
                continue
            price = float(((c.get('prices') or {}).get('usd_foil' if foil else 'usd')) or 0)
            if price < floor and not foil:
                continue
            if foil and price < floor:
                continue
            k = card_key(c, foil)
            if k in U:
                continue
            pri = age_boost * special * rarity_boost * (1 + math.log10(1 + price))
            U[k] = from_scry(c, foil, pri)
            m = meta.setdefault(c['name'], {'reserved': False, 'oracle_id': c.get('oracle_id'), 'type_line': c.get('type_line', ''), 'n_prints_known': 0})
            m['n_prints_known'] = m.get('n_prints_known', 0) + 1
            m['reprint'] = bool(c.get('reprint'))
    # staples / known long-term holds even if below floor on some prints
    for q in (
        '!"Force of Will" lang:en unique:prints',
        '!"Wasteland" lang:en unique:prints',
        '!"Gaea\'s Cradle" lang:en unique:prints',
        '!"Mana Drain" lang:en unique:prints',
        '!"Imperial Recruiter" lang:en unique:prints',
        '!"Intuition" lang:en unique:prints',
        '!"Survival of the Fittest" lang:en unique:prints',
        '!"Ragavan, Nimble Pilferer" lang:en unique:prints',
        '!"The One Ring" lang:en unique:prints',
        '!"Sheoldred, the Apocalypse" lang:en unique:prints',
        '!"Orcish Bowmasters" lang:en unique:prints',
        '!"Fable of the Mirror-Breaker" lang:en unique:prints',
        '!"Solitude" lang:en unique:prints',
        '!"Fury" lang:en unique:prints',
        '!"Grief" lang:en unique:prints',
        '!"Endurance" lang:en unique:prints',
        '!"Subtlety" lang:en unique:prints',
        '!"Murktide Regent" lang:en unique:prints',
        '!"Chrome Mox" lang:en unique:prints',
        '!"Mox Diamond" lang:en unique:prints',
        '!"Lion\'s Eye Diamond" lang:en unique:prints',
        '!"Mana Crypt" lang:en unique:prints',
        '!"Jeweled Lotus" lang:en unique:prints',
        '!"Dockside Extortionist" lang:en unique:prints',
        '!"Cyclonic Rift" lang:en unique:prints',
        '!"Rhystic Study" lang:en unique:prints',
        '!"Smothering Tithe" lang:en unique:prints',
        '!"Demonic Tutor" lang:en unique:prints',
        '!"Vampiric Tutor" lang:en unique:prints',
        '!"Imperial Seal" lang:en unique:prints',
        '!"Mystical Tutor" lang:en unique:prints',
        '!"Enlightened Tutor" lang:en unique:prints',
        '!"Worldly Tutor" lang:en unique:prints',
        '!"Bitterblossom" lang:en unique:prints',
        '!"Aether Vial" lang:en unique:prints',
        '!"Chalice of the Void" lang:en unique:prints',
        '!"Karakas" lang:en unique:prints',
        '!"Cavern of Souls" lang:en unique:prints',
        '!"Ancient Tomb" lang:en unique:prints',
        '!"City of Traitors" lang:en unique:prints',
        '!"Bazaar of Baghdad" lang:en unique:prints',
        '!"Mishra\'s Workshop" lang:en unique:prints',
        '!"Candelabra of Tawnos" lang:en unique:prints',
        '!"Metalworker" lang:en unique:prints',
        '!"Grim Monolith" lang:en unique:prints',
        '!"Power Artifact" lang:en unique:prints',
        '!"Transmute Artifact" lang:en unique:prints',
        '!"Gilded Drake" lang:en unique:prints',
        '!"Academy Rector" lang:en unique:prints',
        '!"Recurring Nightmare" lang:en unique:prints',
        '!"Goblin Lackey" lang:en unique:prints',
        '!"Goblin Piledriver" lang:en unique:prints',
        '!"True-Name Nemesis" lang:en unique:prints',
        '!"Snapcaster Mage" lang:en unique:prints',
        '!"Dark Confidant" lang:en unique:prints',
        '!"Tarmogoyf" lang:en unique:prints',
        '!"Liliana of the Veil" lang:en unique:prints',
        '!"Jace, the Mind Sculptor" lang:en unique:prints',
        '!"Scalding Tarn" lang:en unique:prints',
        '!"Misty Rainforest" lang:en unique:prints',
        '!"Verdant Catacombs" lang:en unique:prints',
        '!"Arid Mesa" lang:en unique:prints',
        '!"Marsh Flats" lang:en unique:prints',
        '!"Polluted Delta" lang:en unique:prints',
        '!"Flooded Strand" lang:en unique:prints',
        '!"Bloodstained Mire" lang:en unique:prints',
        '!"Wooded Foothills" lang:en unique:prints',
        '!"Windswept Heath" lang:en unique:prints',
    ):
        try:
            for c in scry_pages(q, max_pages=3):
                if c.get('digital'):
                    continue
                for foil in (False, True):
                    if foil and not c.get('foil'):
                        continue
                    if not foil and c.get('nonfoil') is False:
                        continue
                    k = card_key(c, foil)
                    if k not in U:
                        U[k] = from_scry(c, foil, 4.0)
        except Exception as x:
            print('staple fetch', q, x)
    json.dump({'U': U, 'meta': meta, 'fetched': datetime.datetime.now(datetime.timezone.utc).isoformat()}, open(cache, 'w'))
    print(f'universe size: {len(U)}')
    return U, meta

# ---------- PriceCharting ----------
def _norm_name(x):
    """ASCII-fold alphanumeric name for exact PC title match (doctor-compatible)."""
    import unicodedata
    s = unicodedata.normalize('NFKD', x or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]', '', s).strip()

def _pc_title_card_name(title):
    """Strip PriceCharting title noise → card name."""
    t = (title or '').replace(' Prices', '')
    t = re.sub(r'\s*\[.*?\]', '', t)
    t = re.sub(r'\s*#\d+.*$', '', t)
    return t.strip()

def pc(card):
    """Fetch PriceCharting chart ONLY if page title name matches card name exactly (normalized).
    Rejects near-misses (Yawgmoth's Will→Edict, Survival→Cache, Cradle→Revenge, etc.)."""
    hint = set_hint(card['set'], card.get('set_name', ''))
    q = f"{card['name']} {hint}" + (' foil' if card.get('foil') else '')
    want = _norm_name(card['name'])
    name_slug = re.sub(r'[^a-z0-9]+', '-', card['name'].lower()).strip('-')
    hint_slug = re.sub(r'[^a-z0-9]+', '-', hint.lower()).strip('-')
    url, html_body = get('https://www.pricecharting.com/search-products?' + urllib.parse.urlencode({'q': q, 'type': 'prices'}), accept_html=True, t=45)
    candidates = []
    if '/game/' in url:
        candidates = [url.split('?')[0]]
    else:
        cands = re.findall(r'href="(https://www.pricecharting.com/game/[^"]+)"', html_body)
        for u in dict.fromkeys(cands):
            ul = u.lower()
            slug_path = ul.rsplit('/', 1)[-1]
            toks = [x for x in name_slug.split('-') if len(x) > 2]
            # ALL significant name tokens must appear in slug (blocks Will→Edict, Cradle→Revenge)
            if not toks or any(tok not in slug_path for tok in toks):
                continue
            if card.get('foil') and 'foil' not in ul:
                continue
            if not card.get('foil') and ul.rstrip('/').endswith('-foil'):
                continue
            candidates.append(u)
        candidates.sort(key=lambda u: (hint_slug not in u.lower() and card['set'] not in u.lower(), len(u)))
    tried = set()
    for n, cand in enumerate(candidates[:8]):
        if cand in tried:
            continue
        tried.add(cand)
        if n == 0 and '/game/' in url and cand == candidates[0]:
            page_url, page = url, html_body
        else:
            if n > 0 or '/game/' not in url:
                time.sleep(C['pc_delay_s'])
            try:
                page_url, page = get(cand, accept_html=True, t=45)
            except Exception:
                continue
        m = re.search(r'chart_data = (\{.*?\});', page)
        if not m:
            continue
        title_m = re.search(r'<title>([^<|]*)', page)
        if not title_m:
            continue
        title = html.unescape(title_m.group(1)).strip()
        got = _norm_name(_pc_title_card_name(title))
        if got != want:
            print('PC reject name mismatch', card['name'], '=>', title)
            continue
        if card.get('foil') and 'foil' not in title.lower():
            continue
        if (not card.get('foil')) and re.search(r'\[\s*foil\s*\]', title.lower()):
            continue
        vol = re.search(r'id="used_price".*?volume:\s*([^<]+)', page, re.S)
        return {
            'url': page_url.split('?')[0],
            'title': title,
            'chart': json.loads(m.group(1)),
            'vol': (vol.group(1).strip() if vol else ''),
        }
    return None

# ---------- MTGJSON today prices (cross-check / liquidity signal) ----------
def mtgjson_today():
    f = P('AllPricesToday.json')
    if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 86400:
        print('downloading MTGJSON AllPricesToday...')
        try:
            url, body = get('https://mtgjson.com/api/v5/AllPricesToday.json', t=300)
            open(f, 'w').write(body)
        except Exception as x:
            print('mtgjson today fail', x)
            return {}
    try:
        return json.load(open(f)).get('data') or {}
    except Exception as x:
        print('mtgjson parse fail', x)
        return {}

def mtgjson_ids():
    """Map scryfallId -> mtgjson uuid via Identifiers file if present; else empty."""
    f = P('scryfall_to_uuid.json')
    if os.path.exists(f) and time.time() - os.path.getmtime(f) < 7 * 86400:
        try:
            return json.load(open(f))
        except Exception:
            pass
    return {}

# ---------- eBay live ----------
_tok = None
def ebay_token():
    global _tok
    if _tok is not None:
        return _tok
    for c in [P('.ebay_env'), '/workspace/pokebot/.ebay_env', '/workspace/ygo_cards/.ebay_env']:
        if os.path.exists(c):
            e = dict(l.strip().split('=', 1) for l in open(c) if '=' in l and not l.strip().startswith('#'))
            if 'EBAY_CLIENT_ID' not in e:
                continue
            b = base64.b64encode(f"{e['EBAY_CLIENT_ID']}:{e['EBAY_CLIENT_SECRET']}".encode()).decode()
            try:
                _tok = json.loads(get(
                    'https://api.ebay.com/identity/v1/oauth2/token',
                    {'Authorization': 'Basic ' + b, 'Content-Type': 'application/x-www-form-urlencoded'},
                    b'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
                )[1])['access_token']
                return _tok
            except Exception as x:
                print('ebay token fail', x)
    _tok = ''; return _tok


# ---------- listing vetting (Mike-approved) ----------
def _robust_last(series, n=3):
    """Outlier-robust recent sold: median of last n monthly points (ignores single spikes)."""
    if not series:
        return 0.0
    vals = [v for _, v in series[-max(n, 1):] if v and v > 0]
    if not vals:
        return series[-1][1] if series else 0.0
    return float(st.median(vals))

def _iqr_trim(vals):
    if len(vals) < 5:
        return vals
    qs = st.quantiles(vals, n=4)
    lo, hi = qs[0] - 1.5 * (qs[2] - qs[0]), qs[2] + 1.5 * (qs[2] - qs[0])
    kept = [v for v in vals if lo <= v <= hi]
    return kept or vals

def parse_condition(it):
    """Normalize eBay condition + title cues. Reject damaged/HP for ranking."""
    c = (it.get('condition') or '').strip()
    ti = (it.get('title') or '').lower()
    if re.search(DAMAGED, ti) or re.search(r'\b(hp|dmg|damaged)\b', c.lower()):
        return 'damaged', False
    if re.search(r'\b(heavily\s*played|hp)\b', ti):
        return 'heavily_played', False
    if re.search(r'\b(moderately\s*played|\bmp\b)\b', ti) or 'played' in c.lower():
        return 'played', True  # allowable but penalized
    if re.search(r'\b(lightly\s*played|\blp\b)\b', ti):
        return 'lightly_played', True
    if re.search(r'\b(near\s*mint|\bnm\b|mint)\b', ti) or 'near mint' in c.lower() or c in ('New', 'Brand New', 'Like New'):
        return 'near_mint', True
    if c:
        return c.lower().replace(' ', '_')[:40], True
    return 'unknown', True

def seller_trust(it):
    """0-100 seller trust from feedback % and score. New/low-feedback sellers score low."""
    s = it.get('seller') or {}
    try:
        pct = float(s.get('feedbackPercentage') or 0)
    except Exception:
        pct = 0.0
    try:
        sc = int(s.get('feedbackScore') or 0)
    except Exception:
        sc = 0
    # logistic-ish volume factor: 0 at 0, ~0.5 at 50, ~0.9 at 500
    vol = 1 - math.exp(-sc / 120.0)
    score = pct * (0.55 + 0.45 * vol)
    if sc < 10:
        score *= 0.5
    if pct < 98 and sc >= 20:
        score *= 0.7
    if not it.get('topRatedBuyingExperience'):
        score *= 0.95
    return round(max(0, min(100, score)), 1)

def cad_landed(price_usd, ship_usd, loc_country, fx_, ship_is_ca=False):
    """CAD total from item USD + shipping to Canada (not US domestic ship).
    When ship_is_ca=True, ship_usd is the CA shipping quote from eBay ENDUSERCTX=CA.
    When False/unknown, treat low US-looking ship as missing and add ca_inbound estimate."""
    ship_usd = float(ship_usd or 0.0)
    price_usd = float(price_usd or 0.0)
    cc = (loc_country or 'US').upper()
    extra_ca = 0.0
    if cc in ('CA', 'CAN'):
        duty_pct = 0.0
        ship_ca = ship_usd
    elif ship_is_ca and ship_usd > 0:
        duty_pct = float(C.get('import_duty_pct', 0.0))
        ship_ca = ship_usd
    else:
        duty_pct = float(C.get('import_duty_pct', 0.0))
        # US domestic quote is NOT CA shipping — replace with inbound estimate
        ship_ca = float(C.get('ca_inbound_ship_usd', 15.0)) if ship_usd < 25 else ship_usd
    usd_total = price_usd + ship_ca
    cad = usd_total * fx_ * (1 + duty_pct / 100.0)
    return round(cad, 2), round(usd_total, 2)

def cert_check(title, graded_expected):
    """PSA/BGS cert format check for slabs. Returns (cert_ok, cert_id_or_None, note)."""
    ti = title or ''
    m_psa = re.search(r'\bpsa\s*(?:gem\s*)?(?:mint\s*)?10\b.*?\b(\d{8,10})\b', ti, re.I) or re.search(r'\bcert(?:ificate)?\s*(?:#|no\.?)?\s*(\d{8,10})\b', ti, re.I)
    m_bgs = re.search(r'\bbgs\s*(?:black\s*label\s*)?(?:10)?\b.*?\b(\d{8,12})\b', ti, re.I)
    m_cgc = re.search(r'\bcgc\b.*?\b(\d{8,12})\b', ti, re.I)
    if graded_expected:
        if m_psa:
            return True, m_psa.group(1), 'psa_cert_format_ok'
        if m_bgs:
            return True, m_bgs.group(1), 'bgs_cert_format_ok'
        if m_cgc:
            return True, m_cgc.group(1), 'cgc_cert_format_ok'
        # slab claimed but no cert # — not ok for top rank
        if re.search(r'\b(psa|bgs|cgc|sgc|beckett)\b', ti, re.I):
            return False, None, 'slab_without_cert_number'
        return False, None, 'graded_expected_no_slab'
    # raw listing: reject if it looks like a slab mismatch
    return True, None, 'raw_listing'

def fake_risk_score(card, title, price, market_raw, condition_ok):
    """0-100 fake/mislist risk. Higher = worse."""
    ti = (title or '').lower()
    risk = 10.0
    if re.search(FAKE, ti):
        risk += 70
    if re.search(r'\b(playtest|proxy|replica|skin|vinyl|credit\s*card|debit)\b', ti):
        risk += 50
    if re.search(LANG, ti):
        risk += 40
    hot = {'black lotus', 'ancestral recall', 'time walk', 'timetwister', 'mox pearl', 'mox sapphire', 'mox jet', 'mox ruby', 'mox emerald',
           'underground sea', 'volcanic island', 'tropical island', 'tundra', 'bayou', 'library of alexandria', "gaea's cradle"}
    if card.get('name', '').lower() in hot or (card.get('reserved') and (market_raw or 0) >= 200):
        risk += 15
    if market_raw and price < 0.5 * market_raw:
        risk += 35
    if market_raw and price < 0.25 * market_raw:
        risk += 25
    if not condition_ok:
        risk += 20
    return round(min(100, risk), 1)

def vet_listing(card, it, graded, market_raw, fx_):
    """Full vetting. vetted=True only if buyable for ranking (not fake/damaged/wrong/implausible/low trust)."""
    ti = it.get('title') or ''
    p = float(it['price']['value'])
    if not it.get('shippingOptions'):
        # Caller should have filtered; treat as unshippable to CA
        return dict(title=ti, price=p, ship=0, url=(it.get('itemWebUrl') or '').split('?')[0], source='ebay',
                    condition='unknown', condition_ok=False, seller_score=0, fake_risk=100,
                    cert_ok=False, cert_id=None, cert_note='no_ca_shipping', cad_total=None, usd_total=None,
                    loc='?', vetted=False, reject_reasons=['no_shipping_to_canada'], seller=None,
                    item_price=p, ship_ca=None)
    ship = float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value', 0) or 0)
    cond, cond_ok = parse_condition(it)
    s_score = seller_trust(it)
    cert_ok, cert_id, cert_note = cert_check(ti, graded)
    fr = fake_risk_score(card, ti, p, market_raw, cond_ok)
    loc = (it.get('itemLocation') or {}).get('country') or 'US'
    # Browse search/getItem called with ENDUSERCTX=CA → shippingOptions are CA quotes
    cad_total, usd_total = cad_landed(p, ship, loc, fx_, ship_is_ca=True)
    reasons = []
    if re.search(FAKE, ti.lower()) or re.search(r'\b(playtest|proxy|replica|skin|vinyl)\b', ti.lower()):
        reasons.append('fake_or_proxy_keywords')
    if re.search(LANG, ti.lower()):
        reasons.append('wrong_language')
    if not cond_ok:
        reasons.append('damaged_or_hp')
    if re.search(r'\bsigned\b|\baltered\b', ti.lower()):
        reasons.append('signed_or_altered')
    if market_raw and p < 0.5 * market_raw:
        reasons.append('implausibly_cheap_<50pct_sold')
    if s_score < 60:
        reasons.append('low_seller_trust')
    if graded and not cert_ok:
        reasons.append(cert_note)
    # edition / set hint
    hint = set_hint(card['set'], card.get('set_name', ''))
    ti_l = ti.lower()
    name_toks = [tok for tok in re.split(r'\W+', card['name'].lower()) if len(tok) > 2]
    if sum(1 for tok in name_toks if tok in ti_l) < max(1, len(name_toks) - 1):
        reasons.append('name_mismatch')
    power = card['name'].lower() in ('black lotus', 'ancestral recall', 'time walk', 'timetwister', 'mox pearl', 'mox sapphire', 'mox jet', 'mox ruby', 'mox emerald')
    if not power and hint.lower().split()[0] not in ti_l and card['set'] not in ti_l and hint.lower() not in ti_l:
        reasons.append('wrong_edition')
    if card.get('foil') and 'foil' not in ti_l:
        reasons.append('foil_mismatch')
    if not card.get('foil') and re.search(r'\bfoil\b', ti_l) and not re.search(r'non[\s-]?foil', ti_l):
        reasons.append('foil_mismatch')
    if graded != bool(re.search(r'psa\s*10|bgs\s*10|cgc\s*10|gem\s*mint\s*10', ti_l)):
        reasons.append('grade_mismatch')
    if not graded and re.search(r'\b(psa|bgs|cgc|sgc|beckett|graded)\b', ti_l):
        reasons.append('unexpected_slab_on_raw')
    vetted = (fr < 45 and cond_ok and s_score >= 60 and not reasons and (cert_ok if graded else True))
    # soft: wrong_edition alone with power9 name unique may still pass if cheapness/fake clear
    if reasons == ['wrong_edition'] and power and fr < 30 and cond_ok and s_score >= 80:
        vetted = True
    return dict(
        title=ti, price=p, item_price=p, ship=ship, ship_ca=ship,
        url=it['itemWebUrl'].split('?')[0], source='ebay',
        condition=cond, condition_ok=cond_ok, seller_score=s_score,
        fake_risk=fr, cert_ok=cert_ok, cert_id=cert_id, cert_note=cert_note,
        cad_total=cad_total, usd_total=usd_total, loc=loc,
        vetted=vetted, reject_reasons=reasons,
        seller=(it.get('seller') or {}).get('username'),
    )

def ebay_live(card, graded, market_raw=None, fx_=None):
    """Return best VETTED listing, else best non-rejected with flags. Never returns obvious fakes/skins."""
    tok = ebay_token()
    if not tok:
        return None
    if fx_ is None:
        fx_ = fx()
    if market_raw is None:
        market_raw = card.get('usd') or 0
    hint = set_hint(card['set'], card.get('set_name', ''))
    q = f"{card['name']} {hint} mtg" + (' foil' if card.get('foil') else '') + (' PSA 10' if graded else '')
    u = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + urllib.parse.urlencode({
        'q': q, 'sort': 'price', 'limit': '50',
        'filter': 'buyingOptions:{FIXED_PRICE},priceCurrency:USD',
        'category_ids': '38292',
    })
    try:
        items = json.loads(get(u, {'Authorization': 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'})[1]).get('itemSummaries', [])
    except Exception as x:
        print(' ebay err', x); return None
    vetted_hits, soft_hits = [], []
    for it in items:
        ti = it['title'].lower()
        if re.search(FAKE, ti) or re.search(r'\b(playtest|credit\s*card|debit\s*card|card\s*skin|vinyl)\b', ti):
            continue
        if re.search(r'\blot\b|\bx\d\b|playset', ti):
            continue
        v = vet_listing(card, it, graded, market_raw, fx_)
        if 'name_mismatch' in v['reject_reasons'] or 'grade_mismatch' in v['reject_reasons'] or 'unexpected_slab_on_raw' in v['reject_reasons']:
            continue
        if 'fake_or_proxy_keywords' in v['reject_reasons']:
            continue
        if v['vetted']:
            vetted_hits.append(v)
        else:
            soft_hits.append(v)
    pool = vetted_hits or soft_hits
    if not pool:
        return None
    # prefer vetted, then lower fake_risk, then lower cad_total
    pool.sort(key=lambda x: (0 if x['vetted'] else 1, x['fake_risk'], x['cad_total']))
    return pool[0]

def shop_links(card):
    """Verified search / purchase URLs (not scraped prices unless free & reliable)."""
    name_q = urllib.parse.quote(card['name'])
    set_q = urllib.parse.quote(set_hint(card['set'], card.get('set_name', '')))
    links = []
    if card.get('tcg'):
        links.append(('TCGplayer', card['tcg'].split('?')[0] if 'tcgplayer.com' in card['tcg'] else card['tcg']))
    else:
        links.append(('TCGplayer search', f'https://www.tcgplayer.com/search/magic/product?productLineName=magic&q={name_q}&view=grid'))
    if card.get('ck'):
        links.append(('Card Kingdom', card['ck']))
    else:
        links.append(('Card Kingdom search', f'https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D={name_q}'))
    links.append(('Face to Face (CA)', f'https://www.facetofacegames.com/search/?q={name_q}+{set_q}&search_types%5B%5D=product'))
    links.append(('401 Games (CA)', f'https://store.401games.ca/search?q={name_q}+{set_q}'))
    links.append(('eBay BIN search', f'https://www.ebay.com/sch/i.html?_nkw={name_q}+{set_q}+mtg&LH_BIN=1&_sop=15'))
    if card.get('uri'):
        links.append(('Scryfall', card['uri']))
    return links

def cheapest_live(card, scry_usd, ebay):
    """Pick cheapest verified live offer we actually priced; else Scryfall mid as reference with shop links."""
    cands = []
    if ebay:
        cands.append({'price': ebay['price'] + ebay.get('ship', 0), 'url': ebay['url'], 'source': 'ebay', 'title': ebay.get('title', '')})
    if scry_usd and scry_usd > 0:
        # Scryfall USD is market mid from TCGplayer generally; link to purchase_uri if present
        url = card.get('tcg') or card.get('ck') or card.get('uri') or shop_links(card)[0][1]
        cands.append({'price': scry_usd, 'url': url, 'source': 'scryfall_market', 'title': f"{card['name']} market mid"})
    if not cands:
        return None
    cands.sort(key=lambda x: x['price'])
    return cands[0]

# ---------- analytics ----------
def ser(c, k):
    return [(datetime.datetime.utcfromtimestamp(t / 1000).date(), v / 100) for t, v in (c.get(k) or []) if v]

def ret(s, m):
    return (s[-1][1] / s[-1 - m][1] - 1) * 100 if len(s) > m and s[-1 - m][1] else None

def analyze(c):
    # PriceCharting: used=ungraded, graded≈9, manualonly≈PSA10 (same convention as YGO tracker)
    raw, p9, p10 = ser(c, 'used'), ser(c, 'graded'), ser(c, 'manualonly')
    a = {}
    for m in (1, 3, 6, 12, 24):
        a[f'r{m}'] = ret(raw, m)
    a['rall'] = ret(raw, len(raw) - 1) if len(raw) > 1 else None
    a['p10_12'] = ret(p10, 12)
    a['months'] = len(raw)
    if len(raw) > 2:
        v = [x[1] for x in raw]; peak = v[0]; mdd = 0; dips = []; i0 = None
        for i, x in enumerate(v):
            if x >= peak:
                if i0 is not None:
                    dips.append(i - i0); i0 = None
                peak = x
            dd = (x / peak - 1) * 100; mdd = min(mdd, dd)
            if dd < -20 and i0 is None:
                i0 = i
        a['mdd'] = mdd
        a['dips'] = len(dips) + (1 if i0 is not None else 0)
        a['recov_m'] = st.mean(dips) if dips else None
        a['in_dip'] = i0 is not None
        mr = [(v[i] / v[i - 1] - 1) for i in range(1, len(v)) if v[i - 1]]
        a['vol'] = st.pstdev(mr) * 100 if len(mr) > 1 else None
        sp = [i for i in range(1, len(v) - 3) if v[i - 1] and v[i] / v[i - 1] > 1.3]
        a['spikes'] = len(sp)
        a['post_spike3'] = st.mean([(v[i + 3] / v[i] - 1) * 100 for i in sp]) if sp else None
        last12 = v[-13:-1] if len(v) > 13 else v[:-1]
        med = st.median(last12) if last12 else v[-1]
        a['vs_median'] = (v[-1] / med - 1) * 100 if med else None
        seas = {}
        for i in range(1, len(raw)):
            if raw[i - 1][1]:
                seas.setdefault(raw[i][0].month, []).append(raw[i][1] / raw[i - 1][1] - 1)
        a['seas'] = {m: round(st.mean(x) * 100, 1) for m, x in seas.items()}
    # outlier-robust sold: median of last 3 months (and IQR-trim longer window for raw_robust)
    a['raw_last'] = raw[-1][1] if raw else 0
    a['p9_last'] = p9[-1][1] if p9 else 0
    a['p10_last'] = p10[-1][1] if p10 else 0
    a['raw'] = _robust_last(raw, 3)
    a['p9'] = _robust_last(p9, 3)
    a['p10'] = _robust_last(p10, 3)
    if len(raw) >= 6:
        a['raw_robust'] = float(st.median(_iqr_trim([v for _, v in raw[-12:] if v])))
    else:
        a['raw_robust'] = a['raw']
    if raw and p10 and len(raw) > 12 and len(p10) > 12 and raw[-13][1]:
        a['spread_then'] = p10[-13][1] / raw[-13][1]
    a['spread'] = a['p10'] / a['raw'] if a['raw'] else 0
    return a

def era_10_rate(card):
    """Heuristic PSA10 share when pop unavailable. Older reserved cards grade harder."""
    year = int((card.get('released') or '1995')[:4]) if card.get('released') else 1995
    if year <= 1995:
        b = 0.06
    elif year <= 2003:
        b = 0.12
    elif year <= 2015:
        b = 0.25
    else:
        b = 0.40
    if card.get('foil'):
        b *= 0.7
    if card.get('reserved'):
        b *= 0.9  # heavily played / sought, often worse condition
    return b

def flags(card, a, meta, live):
    f = []
    m = meta.get(card['name'], {})
    if card.get('reserved'):
        f.append('Reserved List: Wizards policy is to NEVER reprint (strong long-term scarcity signal; not a guarantee of price)')
    else:
        if card.get('reprint') or m.get('reprint'):
            f.append('Has been reprinted / is a reprint: reprint risk on future products')
        if m.get('n_prints_known', 0) >= 6:
            f.append(f"Many printings tracked ({m['n_prints_known']}): dilution risk")
    # counterfeit hotspots
    hot = {'Black Lotus', 'Ancestral Recall', 'Time Walk', 'Timetwister', 'Mox Pearl', 'Mox Sapphire', 'Mox Jet', 'Mox Ruby', 'Mox Emerald',
           'Underground Sea', 'Volcanic Island', 'Tropical Island', 'Tundra', 'Bayou', 'Badlands', 'Taiga', 'Savannah', 'Scrubland', 'Plateau',
           'Library of Alexandria', 'Force of Will', "Gaea's Cradle"}
    if card['name'] in hot or (card.get('reserved') and (a.get('raw') or 0) >= 200):
        f.append('HIGH counterfeit risk: buy slabbed or authenticate; check weight, rosette, green dot, font')
    if int((card.get('released') or '2000')[:4]) <= 1998:
        f.append('Era prone to whitening/centering issues: inspect before grading')
    if live and a.get('raw') and live.get('source') == 'ebay' and live['price'] < 0.5 * a['raw']:
        f.append('live price <50% of market: possible fake/misprint/mislisting — verify carefully')
    return f

def net_grade(a, rate, fx_):
    if not a['raw'] or not a['p10']:
        return None
    cost = a['raw'] * fx_ + C['psa_fee_usd'] * fx_ + C['ship_to_grader_cad'] + C['ship_back_cad']
    p9 = a['p9'] or a['raw']
    low = a['raw'] * 0.8
    rem = max(0.0, 1.0 - rate - 0.45)
    ev_sale = (rate * a['p10'] + 0.45 * p9 + rem * low) * fx_
    ev_net = ev_sale * (1 - C['ebay_fee_pct'] / 100) - C['ebay_fixed_usd'] * fx_ - C['ship_to_buyer_cad']
    p10_net = a['p10'] * fx_ * (1 - C['ebay_fee_pct'] / 100) - C['ebay_fixed_usd'] * fx_ - C['ship_to_buyer_cad'] - cost
    return round(ev_net - cost, 0), round(p10_net, 0)

W0 = {'trend': 0.35, 'gap': 1.5, 'liq': 4, 'p10trend': 0.15, 'dip': 0.2, 'risk': 6, 'rl': 8, 'ev': 1.0, 'outlook': 1.0}

def outlook_score(a, vol, fl, card, W):
    """Long-term value outlook: trend, scarcity, demand/liquidity, reprint risk."""
    tr = [x for x in (a.get('r6'), a.get('r12'), a.get('r24')) if x is not None]
    t = st.mean(tr) if tr else 0
    t = max(-100, min(t, 200))
    vs = 3 if 'week' in (vol or '') else 2 if 'month' in (vol or '') else 1 if 'year' in (vol or '') else (1 if a.get('months', 0) >= 12 else 0)
    o = W['trend'] * t + W['liq'] * vs * 8 + W['p10trend'] * max(-50, min(a.get('p10_12') or 0, 100)) * 0.2
    o += W['dip'] * max(0, -(a.get('vs_median') or 0))
    o -= W['risk'] * 10 * sum(1 for x in fl if 'reprint risk' in x or 'dilution' in x)
    if card.get('reserved'):
        o += W.get('rl', 8) * 3  # scarcity
    # demand proxy: high liquidity + non-negative 12m
    if vs >= 2 and (a.get('r12') or 0) >= 0:
        o += 15
    return o, vs

def buy_cad(a, fx_, live=None):
    """Landed buy CAD (no grading) — capital for a buy-and-hold."""
    if live and live.get('verified') and live.get('cad_total'):
        return float(live['cad_total'])
    if live and live.get('vetted') and live.get('cad_total'):
        return float(live['cad_total'])
    if a.get('raw'):
        return a['raw'] * fx_ + float(C.get('ca_inbound_ship_usd', 15.0)) * fx_
    return None

def sell_net_cad(usd, fx_):
    """Net CAD after eBay fees + ship-to-buyer for selling a card at `usd` market."""
    return usd * fx_ * (1 - C['ebay_fee_pct'] / 100.0) - C['ebay_fixed_usd'] * fx_ - C['ship_to_buyer_cad']

def hold_ev_cad(a, fx_, live=None):
    """BUY-AND-HOLD: project 12–24m appreciation of the SAME raw item (shrunk historical trend).
    Returns (hold_net_cad, buy_cad, hold_return_pct, projected_g12). No grading costs."""
    buy = buy_cad(a, fx_, live)
    if not buy or not a.get('raw'):
        return None, None, None, 0.0
    tr = [x for x in (
        a.get('r12'),
        (a.get('r24') / 2.0) if a.get('r24') is not None else None,
        (a.get('r6') * 2.0) if a.get('r6') is not None and a.get('r12') is None else None,
    ) if x is not None]
    # shrink 50%, clamp — past ≠ future
    g12 = max(-0.40, min(0.55, 0.5 * (st.median(tr) / 100.0))) if tr else 0.0
    # RL soft boost to projected hold (structural scarcity), still capped
    # (caller may pass reserved via outlook; keep projection conservative here)
    mval_usd = a['raw'] * (1.0 + g12)
    hold_net = sell_net_cad(mval_usd, fx_) - buy
    ret = 100.0 * hold_net / buy if buy else None
    return round(hold_net, 2), round(buy, 2), (round(ret, 2) if ret is not None else None), g12

def capital_cost_cad(a, fx_, live=None):
    """Grade path capital (buy + PSA round-trip) — optional upside path only."""
    buy = buy_cad(a, fx_, live)
    if buy is None:
        return None
    grade = C['psa_fee_usd'] * fx_ + C['ship_to_grader_cad'] + C['ship_back_cad']
    return round(buy + grade, 2)

def grade_ev_cad(a, rate, fx_, live=None):
    """Optional grade-and-flip EV (not the default rank signal)."""
    cost = capital_cost_cad(a, fx_, live)
    buy = buy_cad(a, fx_, live)
    if not cost or not buy or not a.get('raw'):
        return None, None, None
    p9 = a.get('p9') or a['raw']
    p10 = a.get('p10') or 0
    r10 = max(0.02, min(0.55, rate))
    r9 = 0.35
    r_low = max(0.0, 1.0 - r10 - r9)
    low = a['raw'] * 0.85
    ev_sale_usd = r10 * p10 + r9 * p9 + r_low * low
    grade_cost = (C['psa_fee_usd'] * fx_ + C['ship_to_grader_cad'] + C['ship_back_cad']) if p10 else 0
    net = sell_net_cad(ev_sale_usd, fx_) - buy - grade_cost
    ret = (100.0 * net / cost) if cost else None
    return round(net, 2), cost, (round(ret, 2) if ret is not None else None)

def ev_net_cad(a, rate, fx_, live=None):
    """Backward-compat wrapper: returns HOLD net/cost/ret (grade is optional upside elsewhere)."""
    hold_net, buy, hold_ret, _ = hold_ev_cad(a, fx_, live)
    return hold_net, buy, hold_ret

def _sales_per_month(vol):
    """Parse PriceCharting sales-volume string → approximate sales/month for liquidity haircut."""
    if not vol or not isinstance(vol, str):
        return 1.0
    s = vol.lower().replace('&nbsp;', ' ').strip()
    m = re.search(r'([\d.]+)\s*sales?\s*per\s*day', s)
    if m: return float(m.group(1)) * 30
    m = re.search(r'([\d.]+)\s*sales?\s*per\s*week', s)
    if m: return float(m.group(1)) * 4.3
    m = re.search(r'([\d.]+)\s*sales?\s*per\s*month', s)
    if m: return float(m.group(1))
    m = re.search(r'([\d.]+)\s*/\s*mo', s)
    if m: return float(m.group(1))
    return 1.0

def score(a, vol, fl, card, W, live=None, rate=None, fx_=None):
    """Rank by risk-adjusted BUY-AND-HOLD expected return % (12–24m same-item appreciation)
    + outlook. Grade-and-flip is optional upside only — negative grade EV does not sink a hold.
    Capital/liquidity penalty so ultra-expensive cards don't dominate. Unverified → demoted."""
    fx_ = fx_ if fx_ is not None else 1.4
    rate = rate if rate is not None else era_10_rate(card)
    o, vs = outlook_score(a, vol, fl, card, W)
    hold_net, buy, hold_ret, g12 = hold_ev_cad(a, fx_, live)
    g_net, g_cost, g_ret = grade_ev_cad(a, rate, fx_, live)
    grade_up = max(0.0, (g_net or 0) - (hold_net or 0)) if g_net is not None and hold_net is not None else 0.0
    # risk-adjust HOLD return %
    radj = hold_ret if hold_ret is not None else 0.0
    if card.get('reserved'):
        radj += 3.0  # soft RL scarcity bump on hold score only
    if a.get('vol') is not None:
        try:
            radj *= 1.0 / (1.0 + float(a['vol']) / 60.0)
        except (TypeError, ValueError):
            pass
    if a.get('mdd') is not None:
        radj *= 1.0 / (1.0 + abs(float(a['mdd'])) / 100.0)
    if vs <= 0:
        radj *= 0.6
    elif vs == 1:
        radj *= 0.85
    spm = _sales_per_month(vol)
    radj *= min(1.0, max(0.25, (spm / 3.0) ** 0.30))
    ref = float(C.get('capital_ref_cad', 500))
    if buy and buy > ref:
        radj *= (ref / buy) ** 0.55
    # optional grade upside: small add-on, never a gate
    radj += min(15.0, grade_up / max(buy or 1, 1) * 100.0 * 0.15)
    ret_pts = max(-50, min(120, radj))
    outlook_pts = max(-8, min(8, o / 12.0))
    s = W.get('ev', 1.0) * ret_pts + W.get('outlook', 0.5) * outlook_pts
    if radj < 0:
        s = min(s, radj + outlook_pts * 0.25)
    if live:
        if live.get('fake_risk', 0) >= 45 or not live.get('vetted', False) or not live.get('verified', True):
            s -= 500
        else:
            s += 3 + min(6, (live.get('seller_score') or 0) / 30.0)
            if a.get('raw_robust') and live.get('price'):
                edge = (a['raw_robust'] - live['price']) / a['raw_robust']
                s += max(-4, min(10, edge * 30))
    else:
        s -= 200
    conf = ('high' if a.get('months', 0) >= 24 and vs >= 2 and live and live.get('vetted') and live.get('verified', True) else
            'medium' if a.get('months', 0) >= 12 and vs >= 1 else 'low')
    # return: score, conf, HOLD profit, outlook, HOLD ret%, buy cost  (grade fields attached by caller)
    return round(s, 1), conf, hold_net, o, hold_ret, buy


# ---------- backtest & outcomes ----------
def backtest(db):
    rows = db.execute('select key, chart from charts').fetchall(); res = []
    for k, ch in rows:
        c = json.loads(ch); raw = ser(c, 'used')
        if len(raw) < 30:
            continue
        for cut in range(18, len(raw) - 12, 6):
            sub = {kk: [x for x in (c.get(kk) or [])][:cut] for kk in c}
            a = analyze(sub)
            fwd = raw[cut - 1 + 12][1] / raw[cut - 1][1] - 1 if raw[cut - 1][1] else 0
            res.append((a, fwd, k))
    if len(res) < 40:
        return W0, f'backtest: only {len(res)} samples yet (needs history from more cards); default weights.'
    best = None
    for tw in (0.1, 0.35, 0.7):
        for gw in (0.5, 1.5, 3):
            for dw in (0, 0.2, 0.6):
                for rw in (4, 8, 12):
                    W = {**W0, 'trend': tw, 'gap': gw, 'dip': dw, 'rl': rw}
                    # score without card reserved flag variation: use key heuristic
                    def sc_row(r):
                        a, _, key = r
                        reserved = True  # most of our PC history will be RL-heavy first runs
                        dummy = {'reserved': '|lea|' in key or '|leb|' in key or 'reserved' in key or True}
                        # encode reserved in key via U lookup later; approximate: RL sets
                        setcode = key.split('|')[1] if '|' in key else ''
                        dummy['reserved'] = setcode in SET_HINT and setcode in (
                            'lea', 'leb', '2ed', 'arn', 'atq', 'leg', 'drk', 'ice', 'hml', 'all', 'mir', 'vis', 'wth',
                            'tmp', 'sth', 'exo', 'usg', 'ulg', 'uds', 'mmq', 'nem', 'pcy', 'inv', 'pls', 'apc', 'ody', 'tor', 'jud', 'ons', 'lgn', 'scg'
                        )
                        return -score(a, '1 sale per month', [], dummy, W)[0]
                    sc = sorted(res, key=sc_row)
                    top = sc[:max(1, len(sc) // 5)]
                    hit = sum(1 for _, f, _ in top if f > 0) / len(top)
                    if not best or hit > best[0]:
                        best = (hit, W, st.mean(f for _, f, _ in top))
    base = sum(1 for _, f, _ in res if f > 0) / len(res)
    return best[1], (
        f"backtest on {len(res)} card-periods: top-20% by score rose over next 12m {best[0]*100:.0f}% of the time "
        f"(avg {best[2]*100:+.0f}%) vs {base*100:.0f}% for all cards. Walk-forward shows picks barely match a hold-all index — do NOT claim an edge. Advice only."
    )

def outcome_adj():
    try:
        rows = list(csv.DictReader(open(P('outcomes.csv'))))
    except Exception:
        return 1.0, 'no outcomes yet'
    g = [r for r in rows if r.get('action(buy/grade_result/sell)', '').strip() == 'grade_result']
    if not g:
        return 1.0, 'no grading results logged yet'
    tens = sum(1 for r in g if r['grade'].strip() == '10')
    adj = max(0.3, min(2.0, (tens / len(g)) / 0.25))
    return adj, f'{tens}/{len(g)} logged grades were 10s; PSA10 odds scaled x{adj:.2f}'

# ---------- events ----------
def events():
    out = []
    kw = re.compile(r'reprint|reserved list|ban ?list|banned|restricted|commander|special guest|secret lair|masterpiece|from the vault|30th|anniversary|universes beyond|bonus sheet', re.I)
    feeds = (
        'https://www.mtggoldfish.com/articles/rss',
        'https://magic.wizards.com/en/rss/all.xml',
        'https://news.google.com/rss/search?q=magic+the+gathering+(reprint+OR+banned+OR+restricted+OR+%22reserved+list%22+OR+%22secret+lair%22)&hl=en-CA&gl=CA&ceid=CA:en',
    )
    for u in feeds:
        try:
            t = get(u, accept_html=True, t=30)[1]
        except Exception as x:
            out.append(f'feed error {u}: {x}'); continue
        for it in re.findall(r'<item>(.*?)</item>', t, re.S)[:30]:
            ti = html.unescape(re.sub(r'<!\[CDATA\[|\]\]>', '', (re.search(r'<title>(.*?)</title>', it, re.S) or [None, ''])[1])).strip()
            ln = (re.search(r'<link>(.*?)</link>', it, re.S) or [None, ''])[1].strip()
            dt = (re.search(r'<pubDate>(.*?)</pubDate>', it) or [None, ''])[1][:16]
            if kw.search(ti):
                out.append(f'{dt} - {ti} - {ln}')
    # de-dupe
    seen = set(); uniq = []
    for e in out:
        k = e.split(' - ')[1] if ' - ' in e else e
        if k in seen:
            continue
        seen.add(k); uniq.append(e)
    return uniq[:15]

# ---------- main ----------
def main():
    t0 = time.time()
    transport_stopped = False
    db = sqlite3.connect(P('history.db'))
    db.execute('create table if not exists snap(day,key,title,url,raw,psa9,psa10,vol,live_raw,live_raw_url,live_psa10,live_psa10_url,score,conf,scry_usd)')
    db.execute('create table if not exists charts(key primary key,title,url,chart,vol,last_checked)')
    db.execute('create table if not exists queue(key primary key,pri,last_checked)')
    db.execute('create table if not exists scry_daily(day,key,usd,usd_foil)')
    fx_ = fx()
    U, meta = universe(force=('--expand' in sys.argv or C.get('force_universe')))
    day = datetime.date.today().isoformat()
    for k, v in U.items():
        db.execute('insert or ignore into queue values(?,?,0)', (k, v['pri']))
        # accumulate daily scryfall mid
        db.execute('insert into scry_daily values(?,?,?,?)', (day, k, v.get('usd') if not v.get('foil') else None, v.get('usd') if v.get('foil') else None))
    db.commit()
    must = []
    for l in open(P('watchlist.txt')):
        if '|' in l and not l.startswith('#'):
            must.append(l.strip())
    coll = list(csv.DictReader(open(P('my_collection.csv'))))
    for r in coll:
        if not r.get('name'):
            continue
        must.append(f"{r['name']}|{r['set_code']}|{r.get('collector_number') or r.get('num') or ''}|{'1' if str(r.get('foil', '')).lower() in ('1', 'true', 'yes', 'foil') else '0'}")
    owned_keys = set()
    for r in coll:
        if r.get('name'):
            owned_keys.add(f"{r['name']}|{r['set_code']}|{r.get('collector_number') or r.get('num') or ''}|{'1' if str(r.get('foil','')).lower() in ('1','true','yes','foil') else '0'}")
    for k in must:
        parts = k.split('|')
        if len(parts) < 4:
            continue
        n, s, num, foil = parts[0], parts[1], parts[2], parts[3] == '1'
        if k not in U:
            # try resolve via Scryfall
            try:
                q = f'!"{n}" set:{s} number:{num} lang:en' if num else f'!"{n}" set:{s} lang:en'
                js = get_json('https://api.scryfall.com/cards/search?' + urllib.parse.urlencode({'q': q, 'unique': 'prints'}))
                time.sleep(C['scryfall_delay_s'])
                c = js['data'][0]
                U[k] = from_scry(c, foil, 1e12)
            except Exception as x:
                print('watchlist resolve fail', k, x)
                U.setdefault(k, dict(name=n, set=s, set_name=SET_HINT.get(s, s), num=num, rarity='', foil=foil,
                                     reserved=(s in SET_HINT), lang='en', scryfall_id='', uri='', tcg='', ck='', usd=0, released='', pri=1e12, reprint=False))
        else:
            U[k]['pri'] = 1e12
    import tracker as ygo_tracker
    work = ygo_tracker.next_work(db, C['batch_per_run'], max(1, C['batch_per_run'] // 5))
    q = [item['key'] for item in work['discover']]
    todo = list(dict.fromkeys(must + q))
    force = '--force' in sys.argv
    fresh_s = 7 * 86400
    have = {r[0]: r[1] for r in db.execute('select key,last_checked from charts')}
    n_ok = 0
    for k in todo:
        if k not in U:
            continue
        lc = have.get(k) or 0
        if not force and lc and (time.time() - float(lc)) < fresh_s:
            n_ok += 1
            print('SKIP fresh', k)
            db.execute('insert or replace into queue values(?,?,?)', (k, U[k]['pri'], time.time()))
            db.commit()
            continue
        try:
            p = pc(U[k])
        except urllib.error.HTTPError as x:
            if x.code in (401, 429, 503):
                print('pc transport', k, x.code)
                transport_stopped = True
                break
            print('pc err', k, x); p = None
        except Exception as x:
            print('pc err', k, x); p = None
        time.sleep(C['pc_delay_s'])
        db.execute('insert or replace into queue values(?,?,?)', (k, U[k]['pri'], time.time()))
        if p:
            db.execute('insert or replace into charts values(?,?,?,?,?,?)', (k, p['title'], p['url'], json.dumps(p['chart']), p['vol'], time.time()))
            n_ok += 1
            print('OK', k, p['title'], p['vol'])
        else:
            print('MISS', k)
        db.commit()
    W, bt = backtest(db)
    adj, oc = outcome_adj()
    rows = []
    for k, title, url, ch, vol, lc in db.execute('select * from charts').fetchall():
        if k not in U:
            # still analyze orphan chart rows
            parts = k.split('|')
            U[k] = dict(name=parts[0], set=parts[1] if len(parts) > 1 else '', set_name='', num=parts[2] if len(parts) > 2 else '',
                        rarity='', foil=(parts[3] == '1' if len(parts) > 3 else False), reserved=True, lang='en',
                        scryfall_id='', uri=url, tcg='', ck='', usd=0, released='', pri=0, reprint=False)
        a = analyze(json.loads(ch))
        fl = flags(U[k], a, meta, None)
        # preliminary outlook-only score (no live yet); final rank after vetting
        s, conf, evn, outl, retp, costc = score(a, vol, fl, U[k], W, live=None, rate=era_10_rate(U[k]), fx_=fx_)
        rows.append(dict(key=k, card=U[k], title=title, url=url, vol=vol, a=a, fl=fl, score=s, conf=conf,
                         ev_net=evn, outlook=outl, ret_pct=retp, cost_cad=costc, owned=k in owned_keys, shops=shop_links(U[k])))
    rows.sort(key=lambda r: -r['score'])
    budget = C['budget_cad']
    # Broad verification pool across price bands (never pad lists — only verified survive)
    n_live = int(C.get('ebay_live_top_n', 80))
    by_hold = sorted(rows, key=lambda r: -(r.get('ret_pct') or r.get('score') or -999))
    band = lambda lo, hi: [r for r in by_hold if lo <= (r['a'].get('raw') or 0) * fx_ < hi]
    live_set = (
        by_hold[:n_live]
        + band(0, 100)[:40]
        + band(100, 500)[:40]
        + band(500, 2000)[:30]
        + band(2000, 20000)[:20]
        + [r for r in rows if r['owned']]
        + [r for r in rows if r['a']['raw'] * fx_ <= budget][:40]
    )
    seen = set()
    for r in live_set:
        if r['key'] in seen:
            continue
        seen.add(r['key'])
        market = r['a'].get('raw_robust') or r['a'].get('raw') or r['card'].get('usd') or 0
        env_paths = [P('.ebay_env'), '/workspace/pokebot/.ebay_env', '/workspace/ygo_cards/.ebay_env']
        raw_offers = M.live_offers(
            r['card'], False, market, fx_, cad_landed, vet_listing, env_paths, set_hint, max_offers=3)
        # graded offers (eBay only in practice)
        grade_offers = M.live_offers(
            r['card'], True, (r['a'].get('p10') or market), fx_, cad_landed, vet_listing, env_paths, set_hint, max_offers=2)
        r['offers'] = raw_offers
        r['offers_graded'] = grade_offers
        r['lr'] = M.best_offer(raw_offers)  # verified only; None → no verified listing
        r['lg'] = M.best_offer(grade_offers)
        time.sleep(0.5)
        live_best = cheapest_live(r['card'], r['card'].get('usd') or r['a']['raw'], r['lr'])
        r['live_best'] = live_best
        r['fl'] = flags(r['card'], r['a'], meta, r['lr'])
        rate = min(0.9, era_10_rate(r['card']) * adj)
        r['rate'] = rate
        s, conf, evn, outl, retp, costc = score(r['a'], r['vol'], r['fl'], r['card'], W, live=r.get('lr'), rate=rate, fx_=fx_)
        r['score'], r['conf'], r['ev_net'], r['outlook'], r['ret_pct'], r['cost_cad'] = s, conf, evn, outl, retp, costc
        _gn,_,_ = grade_ev_cad(r['a'], r.get('rate') or era_10_rate(r['card']), fx_, r.get('lr')); r['grade_upside_cad']=max(0, (_gn or 0)-(evn or 0)) if _gn is not None else 0
        r['net'] = net_grade(r['a'], rate, fx_)
        db.execute(
            'insert into snap values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (day, r['key'], r['title'], r['url'], r['a']['raw'], r['a']['p9'], r['a']['p10'], r['vol'],
             r['lr'] and r['lr']['price'], r['lr'] and r['lr']['url'],
             r['lg'] and r['lg']['price'], r['lg'] and r['lg']['url'],
             r['score'], r['conf'], r['card'].get('usd'))
        )
    db.commit()
    for r in rows:
        if 'rate' not in r:
            rate = min(0.9, era_10_rate(r['card']) * adj)
            r['rate'] = rate
            r['net'] = net_grade(r['a'], rate, fx_)
            s, conf, evn, outl, retp, costc = score(r['a'], r['vol'], r['fl'], r['card'], W, live=r.get('lr'), rate=rate, fx_=fx_)
            r['score'], r['conf'], r['ev_net'], r['outlook'], r['ret_pct'], r['cost_cad'] = s, conf, evn, outl, retp, costc
        _gn,_,_ = grade_ev_cad(r['a'], r.get('rate') or era_10_rate(r['card']), fx_, r.get('lr')); r['grade_upside_cad']=max(0, (_gn or 0)-(evn or 0)) if _gn is not None else 0
        if 'live_best' not in r:
            r['live_best'] = cheapest_live(r['card'], r['card'].get('usd') or r['a']['raw'], r.get('lr'))
            r['shops'] = shop_links(r['card'])
    def _rank_key(r):
        L=r.get('lr') or {}
        buyable=bool(L.get('vetted')) and (L.get('fake_risk') or 0) < 45
        return (0 if buyable else 1, -r['score'])
    rows.sort(key=_rank_key)
    ev = events()
    write_reports(rows, fx_, W, bt, oc, ev, day, n_ok, len(todo), db.execute('select count(*) from queue').fetchone()[0], time.time() - t0)
    picks=[]
    for r in rows:
        a=r['a']
        lr=r.get('lr'); lg=r.get('lg')
        primary = lr if lr else {}
        cost = primary.get('cad_total') if primary.get('cad_total') else None
        entry = primary.get('cad_total')
        offers = [M.pack_offer(o) for o in (r.get('offers') or []) if o and o.get('verified')]
        offers_g = [M.pack_offer(o) for o in (r.get('offers_graded') or []) if o and o.get('verified')]
        picks.append(dict(
            q=f"{r['card']['name']} {r['card']['set']} #{r['card'].get('num','')}" + (' foil' if r['card'].get('foil') else ''),
            title=r['title'], url=r['url'],
            raw=a.get('raw') or 0, p9=a.get('p9') or 0, p10=a.get('p10') or 0,
            raw_robust=a.get('raw_robust') or a.get('raw') or 0,
            vol=r.get('vol') or '',
            t3=a.get('r3'), t6=a.get('r6'), t12=a.get('r12'), t24=a.get('r24'), t12g=a.get('p10_12'),
            lr=M.pack_offer(lr), lg=M.pack_offer(lg),
            offers=offers, offers_graded=offers_g,
            no_verified_listing=(not offers),
            score=r['score'], conf=r.get('conf'),
            ev_net=r.get('ev_net'), exp_profit_cad=r.get('ev_net'),
            hold_cad=r.get('ev_net'), hold_return_pct=r.get('ret_pct'),
            exp_return_pct=r.get('ret_pct'),
            grade_upside_cad=r.get('grade_upside_cad') or 0,
            ret_pct=r.get('ret_pct'), cost_cad=cost, entry_cad=round(entry,2) if entry else None, outlook=r.get('outlook'),
            lt_score=r.get('outlook'),
            reserved=bool(r['card'].get('reserved')),
            reserved_list=bool(r['card'].get('reserved')),
            fake_risk=primary.get('fake_risk'),
            condition=primary.get('condition'),
            seller_score=primary.get('seller_score'),
            cad_total=primary.get('cad_total'),
            cert_ok=primary.get('cert_ok'),
            vetted=bool(primary.get('vetted') and primary.get('verified')) if primary else False,
            verified_at=primary.get('verified_at'),
            flags=r.get('fl') or [], shops=r.get('shops') or [],
            live_best=r.get('live_best'),
            psa10_odds=r.get('rate'),
        ))
    json.dump(picks, open(P('latest.json'), 'w'), indent=2)
    if not transport_stopped:
        open(P('.stamp'), 'w').write(datetime.date.today().isoformat())
    tiers = C.get('budget_tiers_cad') or [100, 500, 2000]
    def entry_cad(x):
        """Budget filter uses landed buy (what you pay to enter), not full grade round-trip."""
        if x.get('cad_total'): return x['cad_total']
        lr=x.get('lr') or {}
        if lr.get('cad_total'): return lr['cad_total']
        return (x.get('raw') or 0) * fx_ + float(C.get('ca_inbound_ship_usd', 15)) * fx_
    def tier_top(limit, n=5):
        out=[]
        for x in picks:
            c = entry_cad(x)
            x['entry_cad']=round(c,2) if c is not None else None
            if limit is not None and not (0 < c <= limit):
                continue
            # prefer vetted; allow unvetted only if no vetted fill yet for thin budget tiers
            out.append(x)
            if len(out)>=n: break
        # re-prefer vetted within the tier
        out.sort(key=lambda z: (0 if z.get('vetted') else 1, -z.get('score',0)))
        return out[:n]
    by_tier = {'all': tier_top(None, 5), **{f'<={t}': tier_top(t, 5) for t in tiers}}
    # Cross-check #1: must be vetted with non-terrible risk-adj return vs next buyable
    def _xcheck(picks_):
        buyable=[x for x in picks_ if x.get('vetted') and (x.get('fake_risk') or 0)<45]
        if not buyable: return {'ok':False,'reason':'no vetted picks'}
        top=buyable[0]
        better=[x for x in buyable[1:6] if (x.get('ret_pct') or -999) > (top.get('ret_pct') or -999)+25 and (x.get('cost_cad') or 1e18) < (top.get('cost_cad') or 0)*0.5]
        ok = (top.get('ret_pct') is not None) and (top.get('score', -999) > -100)
        reason='ok'
        if (top.get('ret_pct') or 0) < 0 and any((x.get('ret_pct') or 0)>20 for x in buyable[1:5]):
            ok=False; reason='top has negative ret% while peers have strong positive — check capital penalty / live match'
        if better:
            ok=False; reason=f"cheaper high-return peer exists: {better[0].get('title')}"
        return {'ok':ok,'reason':reason,'top_title':top.get('title'),'top_ret':top.get('ret_pct'),'top_cost':top.get('cost_cad')}
    xcheck=_xcheck(picks)
    if not xcheck.get('ok'):
        print('XCHECK #1 WARN:', xcheck)
    top5 = [{k: picks[i].get(k) for k in ('title','score','ev_net','ret_pct','cost_cad','entry_cad','vetted','fake_risk','cad_total','seller_score','raw','lr','url')} for i in range(min(5,len(picks)))]
    top3_100 = [{k: x.get(k) for k in ('title','score','ret_pct','cost_cad','entry_cad','ev_net','lr','url','vetted')} for x in by_tier.get('<=100', [])[:3]]
    # Shared Top / Risky / Safe lists (buy-and-hold primary; never padded)
    try:
        lists = CAT.rank_all(picks)
    except Exception as _e:
        print('categories.rank_all failed', _e); lists = {'top':[], 'risky':[], 'safe':[]}
    open(P('lists.json'), 'w').write(__import__('json').dumps(lists, indent=2))
    print('LISTS top', len(lists.get('top',[])), 'risky', len(lists.get('risky',[])), 'safe', len(lists.get('safe',[])))

    json.dump({'day':day,'fx':fx_,'n_rows':len(rows),'backtest':bt,'outcomes':oc,'n_ok':n_ok,
               'top5':top5,'top3_budget_100':top3_100,'budget_tiers':by_tier,'weights':W,
               'ranking':'buy_hold_return_pct + outlook; grade optional upside; capital/liquidity penalty','xcheck_1':xcheck,'marketplaces':M.SITE_STATUS,'lists_counts':{k:len(v) for k,v in lists.items()}}, open(P('meta.json'), 'w'), indent=2)
    # marketplace capability report
    lines=['# Marketplace exact-verify status', '']
    for k,v in sorted(M.SITE_STATUS.items()):
        lines.append(f"- **{k}**: {v.get('status')} — {v.get('detail','')} _(checked {v.get('checked_at','')})_")
    lines += ['', 'Buy links in latest.json are verified only (exact card + price). Unverified → `no verified listing`.',
              'URLs for eBay are normalized to `https://www.ebay.com/itm/<id>`.']
    open(P('SITES.md'), 'w').write('\n'.join(lines)+'\n')
    print('reports written', len(rows), 'picks', len(picks))
    print('TOP5 (return% rank):')
    for i,x in enumerate(top5,1):
        print(i, x.get('title'), 'score', x.get('score'), 'ret%', x.get('ret_pct'), 'cost', x.get('cost_cad'), 'ev', x.get('ev_net'), 'vetted', x.get('vetted'))
    print('TOP3 <=C$100:')
    for i,x in enumerate(top3_100,1):
        lr=x.get('lr') or {}
        print(i, x.get('title'), 'score', x.get('score'), 'ret%', x.get('ret_pct'), lr.get('url'))

def F(x, s='%'):
    return '-' if x is None else (f'{x:+.0f}%' if s == '%' else f'{x:.0f}')

def write_reports(rows, fx_, W, bt, oc, ev, day, n_ok, n_try, nq, el):
    cad = lambda u: u * fx_
    budget = C['budget_cad']
    tiers = C.get('budget_tiers_cad') or [budget]

    def L(l):
        if not l:
            return '-'
        return f"[C${cad(l['price']):.0f} via {l.get('source','?')}]({l['url']})"

    hdr = (
        f'Advice only — never buy/bid/checkout from this bot. Scores are a LIKELIHOOD ranking, not a guarantee. '
        f'USD→CAD {fx_:.4f}. Raw/PSA9/PSA10 = PriceCharting sold-based (used/graded/manualonly). '
        f'Live = cheapest verified priced offer (eBay BIN when matched, else Scryfall market mid) at run time. '
        f'Reserved List cards are marked; Wizards policy is no reprints of RL cards.'
    )
    o = [
        f'# Magic: The Gathering value report {day}', hdr, '',
        f'Run: {n_ok}/{n_try} cards refreshed, universe queue {nq}, {el/60:.0f} min. {bt} Outcomes: {oc}.', '',
        '## Top 40 by growth / long-term value likelihood',
        '| # | Card | Raw C$ | PSA9 C$ | PSA10 C$ | 10/raw | 3/6/12/24m | PSA10 12m | MaxDD | Vol | Score (conf) | Grade EV C$ (if 10) | Live | Flags |',
        '|' + '-|' * 14,
    ]
    for i, r in enumerate(rows[:40], 1):
        a = r['a']; n = r.get('net')
        o.append(
            f"| {i} | [{r['title']}]({r['url']}) | {cad(a['raw']):.0f} | {cad(a['p9']):.0f} | {cad(a['p10']):.0f} | "
            f"{a['spread']:.1f}x | {F(a.get('r3'))}/{F(a.get('r6'))}/{F(a.get('r12'))}/{F(a.get('r24'))} | {F(a.get('p10_12'))} | "
            f"{F(a.get('mdd'))} | {r['vol']} | {r['score']} ({r['conf']}) | {n[0] if n else '-'} ({n[1] if n else '-'}) | "
            f"{L(r.get('live_best'))} | {'; '.join(r['fl'])} |"
        )
    for b in tiers:
        def _c(r):
            return r.get('cost_cad') or ((r.get('lr') or {}).get('cad_total')) or cad(r['a']['raw'])
        bud = [r for r in rows if 0 < _c(r) <= b][:12]
        o += ['', f'## Best under budget (C${b})']
        o += [f"- {r['title']}: raw C${cad(r['a']['raw']):.0f}, PSA10 C${cad(r['a']['p10']):.0f}, score {r['score']} ({r['conf']}), live {L(r.get('live_best'))}, shops: " +
              ', '.join(f'[{n}]({u})' for n, u in (r.get('shops') or [])[:3]) for r in bud]
    bz = [r for r in rows if r['a'].get('vs_median') is not None and r['a']['vs_median'] < -15 and r['conf'] != 'low'][:15]
    o += ['', '## Buy-zone flags (raw >15% below its 12-month median)']
    o += [f"- {r['title']}: {r['a']['vs_median']:+.0f}% vs median, typical recovery {F(r['a'].get('recov_m'), 'n')} months, live {L(r.get('live_best'))}" for r in bz] or ['- none']
    deals = [r for r in rows if r.get('lr') and r['a']['raw'] and r['lr']['price'] + r['lr'].get('ship', 0) < 0.85 * r['a']['raw']]
    o += ['', '## Live eBay BIN >15% under market (verify condition/authenticity)']
    o += [f"- {r['title']}: {L({'price': r['lr']['price']+r['lr'].get('ship',0), 'url': r['lr']['url'], 'source':'ebay'})} vs market C${cad(r['a']['raw']):.0f}" for r in deals] or ['- none this run']
    own = [r for r in rows if r['owned']]
    al = []
    o += ['', '## My collection']
    if not own:
        o.append('- (empty — add rows to my_collection.csv)')
    for r in own:
        a = r['a']; n = r.get('net')
        s = f"- {r['title']}: raw C${cad(a['raw']):.0f}, PSA9 C${cad(a['p9']):.0f}, PSA10 C${cad(a['p10']):.0f}. PSA10 odds ~{r['rate']*100:.0f}% (era heuristic; PSA pop blocked)."
        if n:
            s += f" Grading EV C${n[0]:+.0f}; if it gets a 10 C${n[1]:+.0f}. " + (
                'WORTH GRADING if card is flawless.' if n[0] > 0 else 'Grading EV negative unless near-certain 10.')
        if (a.get('r1') or 0) > 25 or (a.get('r3') or 0) > 50:
            s += ' SELL SIGNAL: price spiked; past spikes averaged ' + F(a.get('post_spike3')) + ' 3 months later.'
            al.append(s)
        o.append(s)
    o += ['', '## Event alerts (reprints / bans / hype)'] + [f'- {e}' for e in ev]
    o += ['', 'Fees used (edit config.json): ' + json.dumps({k: v for k, v in C.items() if 'fee' in k or 'ship' in k}),
          'Weights: ' + json.dumps(W)]
    open(P('REPORT.md'), 'w').write('\n'.join(o) + '\n')

    # TRENDS
    cat = {}
    for r in rows:
        era = ('Reserved List' if r['card'].get('reserved') else 'Non-RL')
        year = int((r['card'].get('released') or '0')[:4] or 0)
        age = '1993-1996 early' if year and year <= 1996 else ('1997-2003 pre-modern RL era' if year and year <= 2003 else ('2004-2014' if year and year <= 2014 else ('2015+ modern' if year else 'unknown era')))
        foil = 'foil' if r['card'].get('foil') else 'nonfoil'
        for kk in (era, age, foil, r['card'].get('rarity') or 'unknown rarity'):
            cat.setdefault(kk, []).append(r['a'])
    t = [f'# MTG market trends {day} (from {len(rows)} tracked prints)', '',
         '| Category | n | med 3m | med 12m | med 24m | med PSA10 12m | med max drawdown | avg after-spike 3m |',
         '|-|-|-|-|-|-|-|-|']
    md = lambda L: F(st.median(L)) if L else '-'
    for kk, v in sorted(cat.items(), key=lambda x: -len(x[1])):
        g = lambda f: [a[f] for a in v if a.get(f) is not None]
        t.append(f"| {kk} | {len(v)} | {md(g('r3'))} | {md(g('r12'))} | {md(g('r24'))} | {md(g('p10_12'))} | {md(g('mdd'))} | {md(g('post_spike3'))} |")
    se = {}
    for r in rows:
        for m, x in (r['a'].get('seas') or {}).items():
            se.setdefault(m, []).append(x)
    t += ['', '## Seasonality (median month-over-month raw change)']
    t += [f"- {datetime.date(2000, m, 1):%b}: {st.median(x):+.1f}% (n={len(x)})" for m, x in sorted(se.items())] or ['- n/a']
    t += ['', '## Patterns',
          '- Reserved List scarcity is structural (no Wizards reprint); demand still cycles with Eternal formats and collector interest.',
          '- Spikes (>30% in a month) are often followed by the 3-month change shown above; negative = typical post-hype dip.',
          '- Non-RL staples can crash on a reprint announcement — prefer RL or known-low-supply printings for long holds.',
          '- Use buy-zone flags (below 12m median) for entries; confidence is low for cards with <12 months history or thin sales.']
    open(P('TRENDS.md'), 'w').write('\n'.join(t) + '\n')

    # SUMMARY phone-friendly — overall + budget tiers
    def cost_of(r):
        """Budget lines use entry (landed buy); score still uses full grade cost."""
        L=r.get('lr') or {}
        if L.get('cad_total'): return L['cad_total']
        return cad(r['a']['raw']) + float(C.get('ca_inbound_ship_usd', 15.0)) * fx_
    def line(r):
        a = r['a']; lk = r.get('lr') or r.get('live_best')
        why = f"ret {F(r.get('ret_pct'))} on C${cost_of(r):.0f}, {F(a.get('r12'))} 12m, PSA10 {a['spread']:.1f}x"
        link = (lk.get('url') if lk else r['url'])
        price = f"C${lk.get('cad_total') or cad(lk.get('price') or 0):.0f}" if lk else f"C${cad(a['raw']):.0f}"
        return f"- {r['card']['name']} [{r['card']['set']} #{r['card'].get('num','')}]{' FOIL' if r['card'].get('foil') else ''}: {price} | score {r['score']} ({r['conf']}) | {why} | {link}"
    vetted = [r for r in rows if r.get('lr') and r['lr'].get('vetted')]
    s = [f'# MTG daily {day}', 'Advice only — not a guarantee and not an edge vs holding the market. Ranked by buy-and-hold expected return % (grade optional) + outlook; CA-ship verified listings only.', '', '## Top 5 overall']
    for r in (vetted or rows)[:5]:
        s.append(line(r))
    for b in tiers:
        s += ['', f'## Top 3 under C${b}']
        pool = [r for r in vetted if 0 < cost_of(r) <= b][:3] or [r for r in rows if 0 < cost_of(r) <= b][:3]
        s += [line(r) for r in pool] or ['- none']
    s += ['', 'Alerts:'] + (al or ['- none for your collection']) + [f'- {e}' for e in ev[:3]]
    open(P('SUMMARY.md'), 'w').write('\n'.join(s) + '\n')

if __name__ == '__main__':
    if len(sys.argv) > 1:
        C['batch_per_run'] = int(sys.argv[1])
    main()
