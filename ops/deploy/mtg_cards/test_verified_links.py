#!/usr/bin/env python3
"""Pre-publish: every buy link must be verified exact-match at displayed price.
Fails (exit 1) on any mismatch / ended / non-/itm eBay URL / missing verified_at.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import markets as M
from pathlib import Path

ROOT = Path(__file__).resolve().parent
picks = json.load(open(ROOT / 'latest.json'))
_base = Path(os.environ.get('CARD_ROOT', '/workspace'))
env = [str(ROOT / '.ebay_env'), str(_base / 'pokebot' / '.ebay_env'), str(_base / 'ygo_cards' / '.ebay_env')]
tok = M.ebay_token(env)
fails = []
checked = 0

def check_offer(card_meta, o, graded=False):
    global checked
    if not o:
        return
    checked += 1
    url = o.get('url') or ''
    site = (o.get('site_id') or o.get('site') or o.get('source') or '').lower()
    if not o.get('verified'):
        fails.append(f"unverified offer kept: {url}")
        return
    if not o.get('verified_at'):
        fails.append(f"missing verified_at: {url}")
    if 'ebay' in site or 'ebay.com' in url:
        u, iid = M.itm_url(url)
        if not u or url.split('?')[0] != u:
            fails.append(f"ebay url not /itm/<id>: {url}")
        if not tok:
            fails.append('ebay token missing for re-verify')
            return
        # rebuild card stub from pick
        card = card_meta
        fake = {
            'title': o.get('title'), 'price': o.get('price'), 'ship': 0,
            'url': url, 'itemId': iid, 'condition': o.get('condition'),
        }
        # price on pack is price+ship; getItem checks item price — allow ship in tol via verify
        # strip ship by using price field carefully: pack stores combined. Re-fetch only.
        ver = M.verify_ebay_offer(card, {'url': url, 'price': o.get('price') or 0, 'ship': 0,
                                         'condition': o.get('condition'), 'loc': 'US'}, graded, tok, price_tol=0.05)
        if not ver:
            # retry with price tolerance looser for combined price field
            it = M.ebay_get_item(tok, iid)
            if not it:
                fails.append(f"getItem failed/ended: {url}")
            else:
                title = it.get('title') or ''
                if not M.name_match(card['name'], title):
                    fails.append(f"name mismatch: {url} title={title!r}")
                else:
                    # price: displayed should match item price (+ship) within 5%
                    ip = float((it.get('price') or {}).get('value') or 0)
                    try:
                        ship = float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value') or 0)
                    except Exception:
                        ship = float(o.get('ship') or 0)
                    disp = float(o.get('price') or 0)
                    # displayed may be item or item+ship (legacy pack); cad_total is source of truth for UI
                    ok = (abs(ip - disp) <= max(1.5, 0.08 * ip)) or (abs(ip + ship - disp) <= max(1.5, 0.08 * (ip + ship)))
                    if ip and disp and not ok:
                        fails.append(f"price mismatch: {url} item={ip}+ship={ship} displayed={disp}")
        time.sleep(0.2)
    elif 'cardkingdom' in site or 'cardkingdom.com' in url:
        # re-fetch NM price
        try:
            st, body, _ = M._get(url.split('?')[0])
            html = body.decode('utf-8', 'replace')
            forms = __import__('re').findall(r'<form[^>]*addToCart[^>]*>(.*?)</form>', html, __import__('re').I | __import__('re').S)
            nm = None
            for f in forms:
                style = __import__('re').search(r'name="style\[\d+\]" value="([^"]+)"', f)
                price = __import__('re').search(r'name="price" value="([\d.]+)"', f)
                if style and style.group(1) == 'NM' and price:
                    nm = float(price.group(1)); break
            disp = float(o.get('price') or 0)
            if nm is None:
                fails.append(f"CK NM unavailable: {url}")
            elif abs(nm - disp) / max(nm, 0.01) > 0.05 and abs(nm - disp) > 1:
                fails.append(f"CK price mismatch: {url} page={nm} displayed={disp}")
            if not M.name_match(card_meta['name'], o.get('title') or ''):
                fails.append(f"CK name mismatch: {url}")
        except Exception as e:
            fails.append(f"CK re-fetch fail: {url} {e}")
        time.sleep(1.0)
    else:
        fails.append(f"unknown site without verifier: {site} {url}")

for pick in picks:
    # build card stub
    q = pick.get('q') or pick.get('title') or ''
    parts = q.split()
    # prefer structured fields if present — reconstruct from q "Name set #num"
    name = pick.get('title') or ''
    # latest picks don't always have card dict; parse q
    card = {'name': '', 'set': '', 'set_name': '', 'foil': False}
    if pick.get('q'):
        # "Black Lotus lea #232" or with foil
        import re
        m = re.match(r'(.+?)\s+([a-z0-9]+)\s+#', pick['q'], re.I)
        if m:
            card['name'] = m.group(1).replace(' foil', '').strip()
            card['set'] = m.group(2).lower()
        card['foil'] = pick['q'].endswith('foil') or ' foil' in pick['q']
    if not card['name']:
        card['name'] = (pick.get('title') or 'unknown').split(' Prices')[0].split(' [')[0]
    for o in (pick.get('offers') or []):
        check_offer(card, o, graded=False)
    for o in (pick.get('offers_graded') or []):
        check_offer(card, o, graded=True)
    # lr/lg must be verified if present
    for key in ('lr', 'lg'):
        L = pick.get(key)
        if L and L.get('url'):
            if not L.get('verified'):
                fails.append(f"{pick.get('q')}: {key} has url but verified!=true")
            check_offer(card, L, graded=(key == 'lg'))

print(f'checked {checked} offers across {len(picks)} picks')
if fails:
    print('FAIL', len(fails))
    for f in fails[:40]:
        print(' -', f)
    sys.exit(1)
print('PASS all buy links verified')
sys.exit(0)
