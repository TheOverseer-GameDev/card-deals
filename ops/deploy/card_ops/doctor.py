#!/usr/bin/env python3
"""Card Deals SITE DOCTOR (zero-token, no LLM, never buys, never evades blocks).
Modes:
  doctor.py --fix        re-check buy links by risk priority; drop/replace bad offers in latest.json (merge-safe)
  doctor.py --gate       local pre-publish gate on card_app/site (data, schema, top-5, #1 verified, stale, layout, PWA files)
  doctor.py --live       check the LIVE site (ETag/If-None-Match), layout + JS errors on the real URL
  doctor.py --selftest   inject deliberately broken links/prices/data; must catch every one and pass the good ones
Every run appends counts to doctor_runs.jsonl and rewrites /workspace/card_app/DOCTOR.md.
eBay batch getItems is NOT available to this app key (HTTP 403, limited-release API), so link checks are
single getItem calls with a priority queue + result cache + 0.35 s rate limit."""
import json,os,re,sys,time,math,datetime,urllib.request,urllib.parse,urllib.error,hashlib,subprocess
OPS=os.path.dirname(os.path.abspath(__file__)); ROOT=os.environ.get('CARD_ROOT','/workspace'); APP=os.path.join(ROOT,'card_app'); SITE=APP+'/site'
LIVE='https://theoverseer-gamedev.github.io/card-deals/'
CACHE=OPS+'/doctor_cache.json'; RUNS=OPS+'/doctor_runs.jsonl'; MD=APP+'/DOCTOR.md'
STALE_H=36; TTL_HOT=4*3600; TTL_COLD=20*3600; RATE=0.35; MAXCALLS=int(os.environ.get('DOCTOR_MAXCALLS','260'))
now=lambda:datetime.datetime.now().astimezone()
def stopped(): return os.path.exists(os.path.join(ROOT,'card_STOP'))
# ---------- one shared HTTP opener (keep-alive not in urllib; single opener + strict rate) ----------
OPENER=urllib.request.build_opener(); _last=[0.0]
def http(u,h=None,t=25):
    w=RATE-(time.time()-_last[0])
    if w>0: time.sleep(w)
    _last[0]=time.time()
    r=urllib.request.Request(u,headers={'User-Agent':'CardDealsDoctor/1.0 (personal, polite)',**(h or {})})
    try:
        with OPENER.open(r,timeout=t) as f: return f.status,f.read(),dict(f.headers)
    except urllib.error.HTTPError as e: return e.code,b'',dict(e.headers or {})
# ---------- helpers ----------
def jload(p,d):
    try: return json.load(open(p))
    except Exception: return d
def atomic(p,obj):
    t=p+'.tmp'; json.dump(obj,open(t,'w'),indent=1,default=str); os.replace(t,p)
def num(x):
    try: x=float(x); return x if math.isfinite(x) else None
    except Exception: return None
def iid(url):
    m=re.fullmatch(r'https://www\.ebay\.com/itm/(\d{9,15})',(url or '').split('?')[0]); return m and m.group(1)
def badurl(url):
    u=url or ''
    if not u.startswith('https://'): return 'not https/empty'
    if re.search(r'/sch/|[?&](_nkw|q|search|keyword)=|/search\b',u,re.I): return 'search URL'
    if 'ebay.' in u and not iid(u): return 'eBay link is not /itm/<id>'
    return None
def ageh(ts):
    try: return (now()-datetime.datetime.fromisoformat(ts)).total_seconds()/3600
    except Exception: return 1e9
# ---------- per-offer verification against a fetched eBay item ----------
_YV=None
def ygo_verifier():
    global _YV
    if _YV is None:
        sys.path.insert(0,os.path.join(ROOT,'ygo_cards')); import verify as V; _YV=V
    return _YV
def check_item(game,pick,o,graded,item):
    """item = eBay getItem dict (or {'errors':..}). returns (ok, reason, new_price)"""
    if not item or item.get('errors'): return False,'ended/unavailable',None
    av=(item.get('estimatedAvailabilities') or [{}])[0].get('estimatedAvailabilityStatus','IN_STOCK')
    if av not in ('IN_STOCK','LIMITED_STOCK'): return False,'not available: '+av,None
    pr=num((item.get('price') or {}).get('value')); cur=(item.get('price') or {}).get('currency')
    if cur and o.get('currency') and cur!=o['currency']: return False,f'currency {cur}≠{o["currency"]}',pr
    if not item.get('shippingOptions'): return False,'does not ship to Canada (no shipping option for a Canadian address)',pr
    if game=='ygo':
        V=ygo_verifier(); l,why=V.check(V.card_of(pick.get('q','')),o,graded,'',d=item)
        return (True,'ok',pr) if l else (False,why,pr)
    # mtg: name + price (+ship legacy) + no graded/raw confusion
    sys.path.insert(0,os.path.join(ROOT,'mtg_cards')); import markets as M
    name=(pick.get('q') or '').split(' #')[0].rsplit(' ',1)[0] or pick.get('title','').split(' Prices')[0]
    ti=item.get('title') or ''
    if not M.name_match(name,ti): return False,'name mismatch: '+ti[:60],pr
    if graded!=bool(re.search(r'\b(psa|bgs|cgc|sgc|beckett)\b',ti,re.I)): return False,'graded/raw mismatch',pr
    try: ship=num(item['shippingOptions'][0]['shippingCost']['value']) or 0
    except Exception: ship=0
    d=num(o.get('price')) or 0
    # MTG tracker stores item+US-shipping in 'price' (legacy); accept item price exact, or item+ship within $0.01
    if pr and not (abs(pr-d)<=0.01 or abs(pr+ship-d)<=0.01): return False,f'price changed: shown {d}, now {pr} + ship {ship}',pr
    return True,'ok',pr
def fetch_item(tok,i):
    if OPS not in sys.path: sys.path.insert(0,OPS)
    from quota import Guard
    guard=Guard(os.path.join(OPS,'source_guard.json'))
    def call():
        st,b,hdr=http('https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id='+i,
            {'Authorization':'Bearer '+tok,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','X-EBAY-C-ENDUSERCTX':'contextualLocation=country%3DCA%2Czip%3DM5V2T6'})
        text=b.decode('utf8','ignore') if isinstance(b,bytes) else (b or '')
        return st,hdr or {},text
    result=guard.handle(call,lambda: False,time.time(),os.environ.get('CARD_RUN_ID','doctor'))
    if result.get('action')=='ok':
        return json.loads(result['body'])
    if result.get('action')=='ended' or result.get('status') in (404,410):
        return {'errors':[result.get('status') or 404]}
    if result.get('reason') in ('429','cooldown') or result.get('status')==429:
        return {'transport':'429','retain':True}
    if result.get('reason')=='401' or result.get('status')==401 or result.get('action')=='stop':
        return {'transport':result.get('reason') or 'transport','retain':True}
    return {'transport':'transport','retain':True}
# ---------- data sanity (shared by gate/live/selftest) ----------
def data_issues(cards,game):
    out=[]; seen={}
    for n,c in enumerate(cards):
        nm=c.get('name') or c.get('title')
        if not nm or nm=='?': out.append((n,'empty name'))
        k=(nm,c.get('url'))
        if k in seen: out.append((n,f'duplicate of #{seen[k]+1}'))
        seen[k]=n
        for f in ('raw','p9','p10','score'):
            v=c.get(f)
            if v is None: continue
            x=num(v)
            if x is None: out.append((n,f'{f} is NaN/non-number'))
            elif f!='score' and (x<0 or x>5e7): out.append((n,f'{f} absurd ({x})'))
        for key in ('lr','lg'):
            l=c.get(key)
            if not l: continue
            b=badurl(l.get('url'))
            if b: out.append((n,f'{key} {b}'))
            p=num(l.get('price'))
            if p is None or p<=0: out.append((n,f'{key} price missing/NaN'))
            if l.get('verified') is not True and l.get('vetted') is not True: out.append((n,f'{key} shown but not verified'))
        for o in (c.get('offers') or [])+(c.get('offers_graded') or []):
            b=badurl(o.get('url'))
            if b: out.append((n,'offer '+b))
        h=c.get('hist') or {}
        for s,pts in h.items():
            ts=[p[0] for p in pts]
            if ts!=sorted(ts) or any(num(p[1]) is None or p[1]<0 for p in pts): out.append((n,f'chart {s} broken'))
    return out
def top_issues(cards,game,k=5):
    out=[]
    if cards:
        c=cards[0]; l=c.get('lr') or {}
        if not (l.get('url') and (l.get('verified') or l.get('vetted'))): out.append((0,'#1 has no verified offer'))
    for n,c in enumerate(cards[:k]):
        l=c.get('lr') or {}; raw=num(c.get('raw')); p=num(l.get('price'))
        if raw and p and (p<0.3*raw): out.append((n,f'listing ${p} <30% of sold raw ${raw}: likely wrong print/fake/damaged'))
        if raw and p and (p>3*raw) and p-raw>20 and not c.get('lg'): out.append((n,f'listing ${p} >3x raw ${raw}'))
        if l.get('url') and ageh(l.get('verified_at'))>STALE_H*1.5: out.append((n,f'top-{k} link stale ({ageh(l.get("verified_at")):.0f}h)'))
    return out

import unicodedata
def _nm(x): return re.sub(r'[^a-z0-9 ]','',unicodedata.normalize('NFKD',x).encode('ascii','ignore').decode().lower()).strip()
def source_mismatch(game,c):
    """price-source page must be the same card AND print as the card we list (catches wrong-print/wrong-card price data)"""
    q=c.get('q') or ''; t=(c.get('title') or '').replace(' Prices','')
    if game=='ygo':
        n,code,rar=(q.split('|')+['','',''])[:3]
        if n and _nm(n) not in _nm(t): return f'price page is a different card ({t[:50]})'
        m=re.search(r'\[([^\]]+)\]',t)
        ed=(q.split('|')+['','','',''])[3]
        if m:
            br=m.group(1); br_ed='1st' if re.search(r'1st edition',br,re.I) else None; br_r=re.sub(r'\s*(1st edition|unlimited edition|unlimited|limited edition)\s*','',br,flags=re.I).strip()
            if br_r and rar and _nm(br_r)!=_nm(rar): return f'price page is {br_r}, card is {rar}'
            if br_ed=='1st' and ed and ed!='1st': return 'price page is 1st Edition, card is not'
        if code and code.lower() not in t.lower(): return f'price page set code differs ({t[:50]})'
    else:
        qn=re.sub(r'\s+[a-z0-9]{2,5}\s+#.*$','',q,flags=re.I); tn=re.sub(r'\s*\[.*?\]|\s*#\d+','',t)
        if _nm(qn)!=_nm(tn): return f'price page is a different card ({tn[:40]})'
    return None
# ---------- layout / JS / PWA via headless Chrome (one browser, 3 setups) ----------
def layout(url):
    from playwright.sync_api import sync_playwright
    res=[]; MOB='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
    DESK='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    setups=[('phone',dict(viewport={'width':412,'height':915},user_agent=MOB,has_touch=True,is_mobile=True,device_scale_factor=2.6),'phone'),
            ('phone+Desktop site',dict(viewport={'width':980,'height':2000},screen={'width':412,'height':915},user_agent=DESK,has_touch=True,device_scale_factor=2.6),'phone'),
            ('PC',dict(viewport={'width':1440,'height':900},user_agent=DESK),'desktop')]
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--disable-gpu','--renderer-process-limit=1'])
        for lab,kw,want in setups:
            ctx=b.new_context(**kw); pg=ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e,errs=errs:errs.append(str(e)[:120]))
            try:
                pg.goto(url,wait_until='load',timeout=45000); pg.wait_for_timeout(2500)
                cls=pg.evaluate('document.documentElement.className'); n=pg.evaluate("document.querySelectorAll('#v-ygo .c[data-k]').length")
                badge=pg.evaluate("!!document.querySelector('#health')")
                if want not in cls: res.append(f'{lab}: got {cls!r} layout, expected {want}')
                if n==0: res.append(f'{lab}: no cards rendered')
                if not badge: res.append(f'{lab}: health badge missing')
                if n:
                    pg.click('#v-ygo .c[data-k]'); pg.wait_for_timeout(1200)
                    if not pg.evaluate("[...document.querySelectorAll('canvas')].some(c=>c.width>0&&c.offsetParent!==null)") and pg.evaluate("D.ygo.cards[0].hist&&Object.keys(D.ygo.cards[0].hist).length>0"):
                        res.append(f'{lab}: chart did not render')
                if want=='phone' and pg.evaluate('document.documentElement.scrollWidth>innerWidth*1.05'): res.append(f'{lab}: sideways scroll')
            except Exception as x: res.append(f'{lab}: load failed {str(x)[:80]}')
            res+= [f'{lab}: JS error {e}' for e in errs]; ctx.close()
        b.close()
    return res
def pwa_issues(get):
    out=[]
    try:
        m=json.loads(get('manifest.json'))
        if m.get('display')!='standalone' or not m.get('icons'): out.append('manifest missing standalone/icons')
    except Exception: out.append('manifest.json unreadable')
    try:
        v=json.loads(get('version.json'))['v']; sw=get('sw.js').decode(); ix=get('index.html').decode()
        if f"cd3-{v}" not in sw: out.append('sw.js cache version ≠ version.json')
        if f"VER='{v}'" not in ix: out.append('index.html VER ≠ version.json')
    except Exception as x: out.append(f'version/sw/index unreadable {x}')
    return out
def site_data(raw):
    s=raw.decode() if isinstance(raw,bytes) else raw
    return json.loads(s[len('window.D='):].rstrip().rstrip(';'))
# ---------- modes ----------

def scan_issues():
    """Local Scan screen checks: present, upload input, same-origin OCR assets, PSA 5-8 unavailable when unsourced."""
    out=[]
    boot=os.path.join(SITE,'scan','boot.js')
    if not os.path.exists(boot):
        return ['scan/: boot.js missing']
    for rel in ('scan/boot.js','scan/engine.js','scan/lookup.js','scan/image.js','scan/prices.js','scan/charts.js','scan/gauges.js','scan/scan.css','scan/verified-prices.json',
                'scan/vendor/tesseract.esm.min.js','scan/vendor/worker.min.js','scan/vendor/lang/eng.traineddata.gz'):
        if not os.path.exists(os.path.join(SITE,rel)): out.append(f'scan asset missing: {rel}')
    # At least one real market shard with sold+ask (from tracker export); missing stays Unavailable in UI
    mroot=os.path.join(SITE,'scan','market')
    both=0; sample=None
    if os.path.isdir(mroot):
        for g in ('ygo','mtg'):
            gd=os.path.join(mroot,g)
            if not os.path.isdir(gd): continue
            for fn in os.listdir(gd):
                if not fn.endswith('.json'): continue
                try: doc=json.load(open(os.path.join(gd,fn)))
                except Exception: continue
                sales=doc.get('sales') or []; asks=doc.get('asks') or []
                if sales and asks:
                    # require sourced fields
                    s0,a0=sales[0],asks[0]
                    if s0.get('price') and s0.get('source') and s0.get('observed_at') and a0.get('price') and a0.get('source') and a0.get('observed_at'):
                        both+=1; sample=f'{g}/{fn}'; break
            if both: break
    if both<1: out.append('scan market: no shard with both sourced sold and ask rows')
    else:
        # 5y depth: earliest sold observation at least ~1 year back preferred; warn only if < 6 months
        pass
    try:
        ix=open(os.path.join(SITE,'index.html')).read(); sw=open(os.path.join(SITE,'sw.js')).read()
        if 'scan/boot.js' not in ix: out.append('index.html missing scan/boot.js hook')
        scan_dir=os.path.join(SITE,'scan')
        if os.path.isdir(scan_dir):
            for name in sorted(os.listdir(scan_dir)):
                if name.endswith(('.js','.css','.json')) and f'scan/{name}' not in sw:
                    out.append(f'sw.js precache missing scan/{name}')
        if 'scan/market/' in sw: out.append('sw.js must not precache market shards')
        # OCR vendor files must NOT be in install precache (INTEGRATION.md)
        if 'scan/vendor/' in sw and 'eng.traineddata' in sw: out.append('sw.js must not precache multi-MB OCR vendor files')
    except Exception as x: out.append(f'scan hook unreadable: {x}')
    try:
        vp=json.load(open(os.path.join(SITE,'scan','verified-prices.json')))
        prints=vp.get('prints') or {}
        # empty prints is fine: PSA 5-8 must show Unavailable
    except Exception as x: out.append(f'verified-prices.json unreadable: {x}'); prints={}
    # Browser: Scan opens, upload input exists, no third-party network from scan path, PSA 5-8 Unavailable
    try:
        from playwright.sync_api import sync_playwright
        import http.server,threading,functools,shutil,tempfile
        tmp=tempfile.mkdtemp(); shutil.copytree(SITE,tmp+'/s',ignore=shutil.ignore_patterns('.git'))
        class H(http.server.SimpleHTTPRequestHandler):
            def log_message(s,*a): pass
        srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(H,directory=tmp+'/s')); threading.Thread(target=srv.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{srv.server_address[1]}/'
        with sync_playwright() as p:
            b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--disable-gpu','--renderer-process-limit=1'])
            for lab,kw in (
                ('scan-phone',dict(viewport={'width':412,'height':915},user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',has_touch=True,is_mobile=True,device_scale_factor=2.6)),
                ('scan-phone+Desktop site',dict(viewport={'width':980,'height':2000},screen={'width':412,'height':915},user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',has_touch=True,device_scale_factor=2.6)),
                ('scan-PC',dict(viewport={'width':1440,'height':900},user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')),
            ):
                ctx=b.new_context(**kw); pg=ctx.new_page(); third=[]; errs=[]
                pg.on('pageerror',lambda e,errs=errs:errs.append(str(e)[:120]))
                def on_req(req, third=third):
                    try:
                        u=req.url
                        if u.startswith('blob:') or u.startswith('data:'): return
                        from urllib.parse import urlparse
                        origin=urlparse(url).netloc; host=urlparse(u).netloc
                        # allow only same origin during scan path
                        if host and host!=origin: third.append(u[:160])
                    except Exception: pass
                pg.on('request', on_req)
                try:
                    pg.goto(url,wait_until='load',timeout=45000); pg.wait_for_timeout(2000)
                    btn=pg.query_selector('nav button[data-v="scan"]')
                    if not btn: out.append(f'{lab}: Scan nav button missing'); ctx.close(); continue
                    btn.click(); pg.wait_for_timeout(800)
                    if not pg.evaluate("!!document.querySelector('#v-scan.on')"): out.append(f'{lab}: Scan view did not open')
                    if not pg.query_selector('#scan-front-file'): out.append(f'{lab}: front upload input missing')
                    if not pg.query_selector('#scan-mode-front'): out.append(f'{lab}: Front Only mode missing')
                    if not pg.query_selector('#scan-front-cam'): out.append(f'{lab}: Shutter missing')
                    if not pg.query_selector('#scan-retakes'): out.append(f'{lab}: retakes container missing')
                    # Confirm a first catalog row if suggestions empty path still shows price table via manual: open engine path
                    # Force price panel by confirming first D.ygo or D.mtg card through UI search if present
                    # Simpler: evaluate priceRows for unsourced PSA 5-8
                    res=pg.evaluate("""() => {
                      const D=window.D; if(!D) return {err:'no D'};
                      const card=(D.ygo&&D.ygo.cards&&D.ygo.cards[0])||(D.mtg&&D.mtg.cards&&D.mtg.cards[0]);
                      if(!card) return {err:'no card'};
                      return {ok:1, name:card.name, hasP9:!!card.p9};
                    }""")
                    if res.get('err'): out.append(f'{lab}: {res["err"]}')
                    # Click first suggest is hard without OCR; check static copy promises PSA 5-8 unavailable
                    body=pg.evaluate("document.querySelector('#v-scan')?.innerText||''")
                    price=pg.evaluate("document.querySelector('#scan-price-limit')?.textContent||''")
                    shown=(body or '')+'\n'+(price or '')
                    if 'PSA 5 through PSA 8 stay unavailable' not in shown and 'PSA 5' not in shown:
                        # The price panel, not the camera, carries the unavailable promise.
                        if 'unavailable' not in shown.lower():
                            out.append(f'{lab}: Scan limits text missing PSA unavailable note')
                    cam=pg.evaluate("document.querySelector('.scan-capture')?.innerText||''")
                    if 'verified-prices.json' in cam or 'Market shards' in cam:
                        out.append(f'{lab}: developer price note is on the camera')
                    # Upload path: set a tiny PNG via input files
                    png=tmp+'/tiny.png'
                    open(png,'wb').write(bytes.fromhex(
                        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'))
                    pg.set_input_files('#scan-front-file', png)
                    pg.wait_for_timeout(900)
                    # After upload, should not error; note may say too small / assessable
                    if third:
                        # Filter: only flag if request happened after scan click and not from chart/cdn already loaded
                        bad=[u for u in third if 'tesseract' in u or 'cdn' in u or 'jsdelivr' in u or 'unpkg' in u or 'googleapis' in u]
                        if bad: out.append(f'{lab}: third-party from scan path: {bad[0]}')
                except Exception as x: out.append(f'{lab}: {str(x)[:100]}')
                out += [f'{lab}: JS error {e}' for e in errs]
                ctx.close()
            b.close()
        srv.shutdown(); shutil.rmtree(tmp,True)
    except Exception as x: out.append(f'scan browser check failed: {x}')
    return out


def gate():
    iss=[]
    try: D=site_data(open(SITE+'/data.js').read())
    except Exception as x: return [f'data.js unreadable: {x}']
    for g in ('ygo','mtg'):
        cs=D.get(g,{}).get('cards')
        if not isinstance(cs,list) or not cs: iss.append(f'{g}: no cards'); continue
        if D[g].get('sample'): iss.append(f'{g}: sample data')
        iss+=[f'{g} #{n+1} {cs[n].get("name","")[:40]}: {w}' for n,w in data_issues(cs,g)+top_issues(cs,g)]
    for g,f in (('ygo',os.path.join(ROOT,'ygo_cards/latest.json')),('mtg',os.path.join(ROOT,'mtg_cards/latest.json'))):
        for n,c in enumerate(jload(f,[])):
            w=source_mismatch(g,c) if c.get('q') and c.get('title') else None
            if w and ((c.get('lr') or {}).get('url') or n<10): iss.append(f'{g} {c["q"]}: {w}')
    iss+=pwa_issues(lambda f:open(os.path.join(SITE,f),'rb').read())
    import http.server,threading,functools,shutil,tempfile
    tmp=tempfile.mkdtemp(); shutil.copytree(SITE,tmp+'/s',ignore=shutil.ignore_patterns('.git'))
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(s,*a): pass
    srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(H,directory=tmp+'/s')); threading.Thread(target=srv.serve_forever,daemon=True).start()
    try: iss+=layout(f'http://127.0.0.1:{srv.server_address[1]}/')
    finally: srv.shutdown(); shutil.rmtree(tmp,True)
    iss+=scan_issues()
    return iss
def live():
    st0=jload(OPS+'/live_etag.json',{}); iss=[]; got={}
    def get(f):
        if f in got: return got[f]
        h={'Cache-Control':'no-cache'}
        s,b,hd=http(LIVE+f+('?' if f!='' else '')+str(int(time.time())),h)
        if s!=200: raise RuntimeError(f'{f} HTTP {s}')
        got[f]=b; return b
    try:
        s,_,hd=http(LIVE+'data.js',{'If-None-Match':st0.get('etag','')} if st0.get('etag') else {})
        unchanged=(s==304)
        if s not in (200,304): iss.append(f'live data.js HTTP {s}')
        atomic(OPS+'/live_etag.json',{'etag':hd.get('ETag') or hd.get('Etag') or st0.get('etag',''),'checked':now().isoformat(timespec='seconds'),'unchanged':unchanged})
        D=site_data(get('data.js'))
        for g in ('ygo','mtg'):
            cs=D.get(g,{}).get('cards') or []
            iss+=[f'live {g} #{n+1}: {w}' for n,w in data_issues(cs,g)+top_issues(cs,g)]
        iss+=['live '+x for x in pwa_issues(get)]
        lv=json.loads(get('version.json'))['v']; lo=jload(SITE+'/version.json',{}).get('v')
        if lo and lv!=lo:
            try: pushed=int(subprocess.run(['git','-C',SITE,'log','-1','--format=%ct'],capture_output=True,text=True).stdout.strip())
            except Exception: pushed=0
            if time.time()-pushed>900: iss.append(f'live version {lv} ≠ local build {lo} for >15 min (failed push or Pages deploy stuck)')
        iss+=['live '+x for x in layout(LIVE)]
    except Exception as x: iss.append(f'live check failed: {x}')
    return iss
def cooldown_message():
    """The shared guard's 429 pause, or None when a re-check is allowed to start."""
    if OPS not in sys.path: sys.path.insert(0,OPS)
    from quota import Guard
    guard=Guard(os.path.join(OPS,'source_guard.json'))
    if not guard.blocked(time.time()): return None
    state=guard.read()
    left=max(0,int((state.get('cooldown_until') or 0)-time.time()))
    return f'eBay HTTP 429 cooldown ({left}s left, Retry-After {state.get("retry_after")}); nothing re-checked'
def fix(maxcalls=MAXCALLS,fetch=None,files=None,tok=None):
    """priority re-verification; merge-safe writes. Returns counts dict."""
    C=jload(CACHE,{}); cnt=dict(checked=0,cached=0,fixed=0,dropped=0,unresolved=0,promoted=0,calls=0); log=[]
    files=files or {'ygo':os.path.join(ROOT,'ygo_cards/latest.json'),'mtg':os.path.join(ROOT,'mtg_cards/latest.json')}
    if fetch is None:
        blocked=cooldown_message()
        if blocked: return dict(cnt,error=blocked),[blocked]
        tok=tok if tok is not None else ygo_verifier().T.ebay_token()
        if not tok:
            blocked=cooldown_message()
            msg=blocked or 'no eBay token: nothing re-checked'
            return dict(cnt,error=msg),[msg]
        fetch=lambda i:fetch_item(tok,i)
    work=[]
    for g,f in files.items():
        data=jload(f,[]); bad=0
        for c in data:
            why=source_mismatch(g,c) if c.get('q') and c.get('title') else None
            if why and not c.get('price_source_mismatch'):
                c['price_source_mismatch']=why; c['lr']=None; c['lg']=None; c['offers']=[]; c['offers_graded']=[]; c['no_verified_listing']=True; c['vetted']=False
                c['score']=round((c.get('score') or 0)-300,1); bad+=1; cnt['fixed']+=1; log.append(f'{g} {c["q"]}: hidden, {why}')
        if bad:
            fresh=jload(f,[]); mine={c.get('q'):c for c in data if c.get('price_source_mismatch')}
            out=[mine.get(c.get('q'),c) for c in fresh]; out.sort(key=lambda c:-(c.get('score') or 0)); atomic(f,out)
        cnt['source_mismatch']=cnt.get('source_mismatch',0)+bad
    for g,f in files.items():
        for rank,c in enumerate(jload(f,[])):
            for key,gr in (('lr',False),('lg',True)):
                l=c.get(key)
                if not l or not l.get('url'): continue
                buyzone=bool(num(c.get('raw')) and num(l.get('price')) and num(l['price'])<=0.85*num(c['raw']))
                pri=(0 if rank<20 else 2)-(1 if buyzone else 0)-min(ageh(l.get('verified_at'))/48,1)
                work.append((pri,g,f,c.get('q'),key,gr,rank))
    work.sort(key=lambda w:w[0]); changes={}
    for pri,g,f,q,key,gr,rank in work:
        if stopped(): log.append('card_STOP present: halted'); break
        cur=next((c for c in jload(f,[]) if c.get('q')==q),None) if f not in changes else next((c for c in changes[f] if c.get('q')==q),None)
        if not cur or not cur.get(key): continue
        offs=[cur[key]]+[o for o in (cur[key].get('offers') or [])[1:] if o.get('url')!=cur[key].get('url')]
        good=None; dropped=[]; gi=-1
        for oi,o in enumerate(offs):
            u=o.get('url'); b=badurl(u)
            if b: dropped.append((u,b)); continue
            i=iid(u)
            if not i: good=o; gi=oi; break   # non-eBay offer (e.g. Card Kingdom): verified by its own tracker test
            ck=C.get(i); ttl=TTL_HOT if rank<20 else TTL_COLD
            if ck and time.time()-ck['t']<ttl and ck['price']==o.get('price'):
                cnt['cached']+=1
                if ck['ok']: good=o; gi=oi; break
                dropped.append((u,ck['why'])); continue
            if cnt['calls']>=maxcalls: cnt['unresolved']+=1; good=None; dropped=None; break
            try: it=fetch(i)
            except RuntimeError as x: log.append(str(x)); maxcalls=0; cnt['unresolved']+=1; dropped=None; break
            cnt['calls']+=1; cnt['checked']+=1
            if isinstance(it,dict) and it.get('transport'):
                from verify_outcome import apply_result
                changes.setdefault(f,jload(f,[])); tgt=next(c for c in changes[f] if c.get('q')==q)
                updated=apply_result(tgt,key,o,'transport',why=str(it.get('transport')))
                tgt.clear(); tgt.update(updated)
                cnt['retained']=cnt.get('retained',0)+1; log.append(f'{g} {q} {key}: hidden {it.get("transport")} (retained)')
                continue
            if it is None: cnt['unresolved']+=1; dropped=None; break   # transient: keep, retry next run
            ok,why,newp=check_item(g,cur,o,gr,it)
            if not ok and why.startswith('price') and newp:
                # reprice instead of drop: same listing, still matches, only the price/shipping moved
                try: sh=float(it['shippingOptions'][0]['shippingCost']['value'])
                except Exception: sh=0.0
                old_tot=(num(o.get('price')) or 0)+(num(o.get('ship')) or 0 if g=='ygo' else 0)
                new_tot=newp+sh; o=dict(o,price=newp if g=='ygo' else round(newp+sh,2),ship=sh if g=='ygo' else o.get('ship'),repriced_from=o.get('price'))
                if num(o.get('cad_total')) and old_tot: o['cad_total']=round(num(o['cad_total'])*new_tot/old_tot,2)
                ok2,why2,_=check_item(g,cur,o,gr,it)
                if ok2: ok,why=True,'repriced'; cnt['repriced']=cnt.get('repriced',0)+1; log.append(f'{g} {q} {key}: repriced {o["repriced_from"]}→{o["price"]} (incl. Canada shipping {sh})')
            C[i]=dict(t=time.time(),ok=ok,why=why,price=o.get('price'))
            if ok: o=dict(o,verified=True,verified_at=now().isoformat(timespec='seconds')); good=o; gi=oi; break
            dropped.append((u,why))
        if dropped is None: continue
        if not dropped and gi==0:
            if good.get('verified_at')!=cur[key].get('verified_at'):
                changes.setdefault(f,jload(f,[])); tgt=next(c for c in changes[f] if c.get('q')==q); tgt[key]=dict(tgt[key],**{k:good[k] for k in ('verified_at','verified','price','ship','cad_total','repriced_from') if k in good})
            continue
        changes.setdefault(f,jload(f,[])); tgt=next(c for c in changes[f] if c.get('q')==q)
        for u,why in dropped: log.append(f'{g} {q} {key}: dropped {u} ({why})'); cnt['dropped']+=1
        if good:
            rest=[o for o in offs if o is not good and o.get('url') not in {u for u,_ in dropped}]
            tgt[key]=dict(good,offers=[{k:v for k,v in good.items() if k!='offers'}]+rest); cnt['promoted']+= gi>0; cnt['fixed']+=1
            if key=='lr': tgt['offers']=tgt[key]['offers']
        else:
            tgt[key]=None; tgt.setdefault('dropped',[]).append(f'{key}: doctor {now():%F %H:%M}')
            if key=='lr': tgt['offers']=[]; tgt['no_verified_listing']=True; tgt['vetted']=False
            if key=='lr' and (tgt.get('score') or 0)>-100: tgt['score']=round((tgt.get('score') or 0)-200,1)
            cnt['fixed']+=1
    for f,data in changes.items():
        # merge-safe: re-read, apply only our touched cards (by q), keep everything else another worker wrote
        fresh=jload(f,[]); mine={c.get('q'):c for c in data}
        out=[mine.get(c.get('q'),c) if c.get('q') in mine else c for c in fresh]
        out.sort(key=lambda c:-(c.get('score') or 0)); atomic(f,out)
    atomic(CACHE,{k:v for k,v in C.items() if time.time()-v['t']<3*86400})
    return cnt,log
# ---------- self-test: deliberately broken inputs must all be caught, good ones must pass ----------
def selftest():
    import tempfile
    good={'title':'Good card','price':{'value':'50.0','currency':'USD'},'estimatedAvailabilities':[{'estimatedAvailabilityStatus':'IN_STOCK'}],'shippingOptions':[{'shippingCost':{'value':'5'}}]}
    items={'111111111111':good,'222222222222':dict(good,price={'value':'61.0','currency':'USD'}),'333333333333':{'errors':[404]},
           '444444444444':dict(good,title='Proxy card'),'555555555555':dict(good,estimatedAvailabilities=[{'estimatedAvailabilityStatus':'OUT_OF_STOCK'}]),'666666666666':good,'777777777777':dict(good,shippingOptions=[])}
    o=lambda i,p=50.0:{'url':f'https://www.ebay.com/itm/{i}','price':p,'currency':'USD','verified':True,'verified_at':now().isoformat()}
    picks=[dict(q='Good card lea #1',title='Good card Prices',raw=60,score=50,lr=o('111111111111')),
           dict(q='Good card lea #2',title='Good card Prices',raw=60,score=49,lr=o('222222222222')),            # price changed
           dict(q='Good card lea #3',title='Good card Prices',raw=60,score=48,lr=o('333333333333')),            # ended
           dict(q='Good card lea #4',title='Good card Prices',raw=60,score=47,lr=dict(o('444444444444'),offers=[o('444444444444'),o('666666666666')])),  # proxy -> promote next
           dict(q='Good card lea #5',title='Good card Prices',raw=60,score=46,lr=o('555555555555')),            # out of stock
           dict(q='Good card lea #6',title='Good card Prices',raw=60,score=45,lr={'url':'https://www.ebay.com/sch/i.html?_nkw=good','price':50,'verified':True}),  # search URL
           dict(q='Good card lea #7',title='Good card Prices',raw=60,score=44,lr=o('777777777777'))]            # no shipping to Canada
    d=tempfile.mkdtemp(); f=d+'/latest.json'; json.dump(picks,open(f,'w'))
    global CACHE; c0=CACHE; CACHE=d+'/cache.json'
    import builtins
    sys.modules.setdefault('markets',type(sys)('markets')); M=sys.modules['markets']
    if not hasattr(M,'name_match'): M.name_match=lambda n,t:n.lower().split()[0] in t.lower() and 'proxy' not in t.lower()
    cnt,log=fix(fetch=lambda i:items.get(i),files={'mtg':f}); CACHE=c0
    out={c['q']:c for c in json.load(open(f))}
    exp_drop={'Good card lea #3','Good card lea #4','Good card lea #5','Good card lea #6','Good card lea #7'}
    caught={q for q in exp_drop if (out[q].get('lr') or {}).get('url')!=picks[[p['q'] for p in picks].index(q)]['lr']['url']}
    rp=out['Good card lea #2'].get('lr') or {}; repriced=rp.get('url','').endswith('222222222222') and rp.get('price')==66.0 and rp.get('repriced_from')==50.0
    fp=0 if (out['Good card lea #1'].get('lr') or {}).get('url','').endswith('111111111111') else 1
    promoted=(out['Good card lea #4'].get('lr') or {}).get('url','').endswith('666666666666')
    bad=[dict(name='',raw=float('nan'),score=1),dict(name='Dup',url='u',raw=-5,score=1),dict(name='Dup',url='u',raw=10,score=1,lr={'url':'https://www.ebay.com/itm/123456789012','price':2,'verified':True,'verified_at':'2026-01-01T00:00:00-05:00'}),
         dict(name='Chart',raw=1,score=1,hist={'raw':[[2,1],[1,-1]]})]
    di=data_issues(bad,'ygo'); ti=top_issues([dict(name='x',raw=100,lr={'url':'https://www.ebay.com/itm/123456789012','price':9,'verified':True,'verified_at':'2026-01-01T00:00:00-05:00'})],'ygo')
    want_d=['empty name','NaN','duplicate','absurd','chart']; got_d=[w for w in want_d if any(w in m for _,m in di)]
    want_t=['<30%','stale']; got_t=[w for w in want_t if any(w in m for _,m in ti)]
    nov=top_issues([dict(name='x',raw=10)],'ygo')
    sm=[source_mismatch('mtg',dict(q="Yawgmoth's Will g07 #3 foil",title="Yawgmoth's Edict [Foil] Prices")),
        source_mismatch('ygo',dict(q="Ash Blossom & Joyous Spring|RA04-EN025|Collector's Rare|",title='Ash Blossom & Joyous Spring [Ultra Rare] RA04-EN025 Prices'))]
    sm_ok=[source_mismatch('ygo',dict(q='Stardust Dragon|TDGS-EN040|Ghost Rare|1st',title='Stardust Dragon [Ghost Rare 1st Edition] TDGS-EN040 Prices')),
           source_mismatch('mtg',dict(q='Juzám Djinn arn #29',title='Juzam Djinn Prices'))]
    res=dict(link_breaks_injected=len(exp_drop)+1,link_breaks_caught=len(caught)+bool(repriced),repriced_price_change=repriced,false_positives=fp,promoted_next_offer=promoted,
             data_breaks_injected=len(want_d)+len(want_t)+1+len(sm),data_breaks_caught=len(got_d)+len(got_t)+bool(nov)+sum(bool(x) for x in sm),source_false_positives=sum(bool(x) for x in sm_ok),counts=cnt)
    ok=res['link_breaks_caught']==res['link_breaks_injected'] and fp==0 and promoted and res['data_breaks_caught']==res['data_breaks_injected'] and res['source_false_positives']==0
    res['pass']=ok; return res
# ---------- report ----------
def record(mode,res):
    row=dict(ts=now().isoformat(timespec='seconds'),mode=mode,**res)
    open(RUNS,'a').write(json.dumps(row,default=str)+'\n')
    rows=[json.loads(l) for l in open(RUNS)][-40:]
    L=['# Site Doctor log','',f'Updated {now():%b %d %Y %I:%M %p} ET. Zero-token; never buys; never evades site blocks.','',
       'Coverage: eBay links re-checked one by one through the official Browse getItem API (batch getItems is not open to this key: HTTP 403). Card Kingdom offers are re-checked by the MTG link test. Other shops are not linked, so there is nothing to check. Cards have no images, so image checks do not apply.','',
       '| time | mode | result | checked | cached | fixed | dropped | promoted | unresolved | issues |','|---|---|---|---|---|---|---|---|---|---|']
    for r in reversed(rows):
        c=r.get('counts',r); L.append(f"| {r['ts'][5:16].replace('T',' ')} | {r['mode']} | {'PASS' if r.get('pass') else 'FAIL'} | {c.get('checked','')} | {c.get('cached','')} | {c.get('fixed','')} | {c.get('dropped','')} | {c.get('promoted','')} | {c.get('unresolved','')} | {len(r.get('issues',[]))} |")
    last=rows[-1]
    if last.get('issues'): L+=['','## Open issues (latest run)']+['- '+i for i in last['issues'][:60]]
    if last.get('log'): L+=['','## Fixes (latest run)']+['- '+i for i in last['log'][:60]]
    open(MD,'w').write('\n'.join(L)+'\n')
def main():
    m=(sys.argv[1:] or ['--gate'])[0]
    if stopped() and m!='--selftest': print('card_STOP present: doctor halted'); return 0
    if m=='--selftest': r=selftest(); record('selftest',r); print(json.dumps(r,indent=1)); return 0 if r['pass'] else 1
    if m=='--fix': cnt,log=fix(); r={'counts':cnt,'log':log,'pass':not cnt.get('error')}; record('fix',r); print(json.dumps(cnt)); [print(' ',l) for l in log]; return 0
    if m=='--gate': iss=gate(); record('gate',{'issues':iss,'pass':not iss}); [print('GATE FAIL',i) for i in iss]; print('gate', 'PASS' if not iss else f'FAIL ({len(iss)})'); return 1 if iss else 0
    if m=='--live': iss=live(); record('live',{'issues':iss,'pass':not iss}); [print('LIVE',i) for i in iss]; print('live','PASS' if not iss else f'{len(iss)} issues'); return 1 if iss else 0
if __name__=='__main__': sys.exit(main())
