#!/usr/bin/env python3
"""Free zero-token Yu-Gi-Oh growth tracker. ADVICE ONLY: never buys, bids or checks out.
Sources: PriceCharting (sold-based monthly history), eBay Browse API (live BIN), YGOPRODeck (card universe, reprints, banlist),
Frankfurter (FX), YGOrganization + Google News RSS (events). PSA pop is fetched best-effort (psacard blocks bots -> era heuristic)."""
import math,os,re,json,time,sqlite3,urllib.request,urllib.parse,base64,datetime,html,statistics as st,csv,math,sys
D=os.path.dirname(os.path.abspath(__file__)); P=lambda f:os.path.join(D,f)
C=json.load(open(P('config.json'))); UA={'User-Agent':'Mozilla/5.0 (personal price tracker; 1 req/3s)'}
LANG=r'\b(japanese|jp|korean|kr|german|french|italian|spanish|portuguese|asian|chinese|ocg|deu|fr|it|sp)\b'
FAKE=r'\b(proxy|orica|custom|replica|fan ?made|rp|reprint card|not original|metal|gold plated)\b'
def _ops_path():
    root=os.environ.get('CARD_ROOT','/workspace')
    ops=os.environ.get('CARD_OPS',os.path.join(root,'card_ops'))
    if ops not in sys.path: sys.path.insert(0,ops)
    return ops
def urlopen(req,timeout=30):
    fixture=os.environ.get('CARD_HTTP_FIXTURE')
    if not fixture: return urllib.request.urlopen(req,timeout=timeout)
    spec=json.load(open(fixture)); url=req.full_url
    for item in spec:
        if item.get('used'): continue
        if item.get('url_contains') and item['url_contains'] not in url: continue
        item['used']=True; json.dump(spec,open(fixture,'w'))
        status=int(item.get('status',200)); body=(item.get('body') or '').encode(); headers=item.get('headers') or {}
        if status>=400:
            err=urllib.error.HTTPError(url,status,'fixture',headers,None); err.read=lambda b=body:b; raise err
        class R:
            def __init__(self): self.headers=headers; self._b=body
            def read(self): return self._b
            def __enter__(self): return self
            def __exit__(self,*a): return False
        return R()
    raise urllib.error.URLError('fixture exhausted '+url)
def fetch_status(u,h=None,data=None,t=30,run_id=None):
    """Production HTTP path. 401 refreshes once. 429 sets the shared cooldown and stops."""
    ops=_ops_path()
    from quota import Guard
    guard=Guard(os.path.join(ops,'source_guard.json'))
    run_id=run_id or os.environ.get('CARD_RUN_ID','ygo')
    def call():
        req=urllib.request.Request(u,data=data,headers={**UA,**(h or {})})
        try:
            with urlopen(req,timeout=t) as f:
                raw=f.read(); text=raw.decode('utf8','ignore') if isinstance(raw,bytes) else raw
                return 200,dict(getattr(f,'headers',{}) or {}),text
        except urllib.error.HTTPError as e:
            try: raw=e.read() or b''
            except Exception: raw=b''
            text=raw.decode('utf8','ignore') if isinstance(raw,bytes) else str(raw)
            return e.code,dict(e.headers or {}),text
    def refresh():
        global _tok; _tok=None
        if not os.environ.get('CARD_HTTP_FIXTURE') and not os.path.exists(P('.ebay_env')):
            return False
        try:
            req=urllib.request.Request('https://api.ebay.com/identity/v1/oauth2/token',data=b'grant_type=client_credentials',headers={'Content-Type':'application/x-www-form-urlencoded'})
            with urlopen(req,timeout=t) as f:
                raw=f.read(); text=raw.decode('utf8','ignore') if isinstance(raw,bytes) else raw
            _tok=(json.loads(text).get('access_token') or '')
            return bool(_tok)
        except Exception:
            return False
    return guard.handle(call,refresh,time.time(),run_id)
def get(u,h=None,data=None,t=30):
    result=fetch_status(u,h,data,t)
    if result.get('action')!='ok':
        reason=str(result.get('reason') or 'transport')
        code=429 if reason in ('429','cooldown') else 401 if '401' in reason else int(result.get('status') or 503)
        raise urllib.error.HTTPError(u,code,reason,{},None)
    return u,result['body']
_ops_path()
def fx():
    try: return json.loads(get('https://api.frankfurter.app/latest?from=USD&to=CAD')[1])['rates']['CAD']
    except Exception: return 1.40
def normalize_set_code(set_code, password=None, konami_id=None):
    _ops_path()
    from print_key import resolve
    got=resolve(set_code, password=password, konami_id=konami_id)
    return set_code if got.get('quarantine') else got['code']
def commit_stamp(ok):
    """Only a finished run without a transport stop may look current."""
    if ok: open(P('.stamp'),'w').write(datetime.date.today().isoformat())
def next_work(db, discover_budget, refresh_budget):
    _ops_path(); from discovery import plan
    rows=[]
    for key,pri,checked in db.execute('select key,pri,last_checked from queue'):
        rows.append({'key':key,'pri':pri,'state':'pending' if not checked else 'acquired','needs_refresh':bool(checked)})
    return plan(rows, discover_budget, refresh_budget)
def mark_queue(db, key, pri, outcome, now):
    _ops_path(); from discovery import apply_outcome
    row={'state':'pending'}
    apply_outcome(row, outcome, now)
    if outcome=='transport': return
    db.execute('insert or replace into queue values(?,?,?)',(key,pri,now))
def public_metrics(r):
    _ops_path(); from metrics import emit_metrics
    sourced={'lr':r.get('lr'),'retained_offers':r.get('retained_offers')}
    if r.get('hold_sourced') and r.get('hold_cad') is not None and r.get('ret_pct') is not None:
        sourced.update(hold_sourced=True, hold_cad=r.get('hold_cad'), ret_pct=r.get('ret_pct'))
    return emit_metrics(sourced)
# ---------- universe ----------
def universe():
    f=P('ygopro.json')
    if not os.path.exists(f) or time.time()-os.path.getmtime(f)>7*86400:
        try: open(f,'w').write(get('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes',t=180)[1])
        except Exception as x: print('ygopro fetch fail (using cache)',x)
    sd={}
    fs=P('cardsets.json')
    if not os.path.exists(fs) or time.time()-os.path.getmtime(fs)>7*86400:
        try: open(fs,'w').write(get('https://db.ygoprodeck.com/api/v7/cardsets.php',t=60)[1])
        except Exception as x: print('cardsets fetch fail',x)
    try:
        for z in json.load(open(fs)): sd[z.get('set_code')]=z.get('tcg_date') or ''
    except Exception: pass
    today=datetime.date.today()
    def newb(pre):  # discovery: boost sets released in last ~18 months
        try: age=(today-datetime.date.fromisoformat(sd.get(pre,'')[:10])).days
        except Exception: return 1
        return 6 if 0<=age<=180 else 3 if age<=540 else 1
    data=json.load(open(f))['data']; rar=set(C['universe_rarities']); old=set(C['first_ed_sets']); U={}; meta={}
    for c in data:
        m=(c.get('misc_info') or [{}])[0]; views=m.get('views',0); sets=c.get('card_sets') or []
        yrs=sorted({s['set_code'].split('-')[0] for s in sets})
        meta[c['name']]={'n_prints':len(sets),'ban':(c.get('banlist_info') or {}).get('ban_tcg'),'views':views}
        for s in sets:
            if s['set_rarity'] not in rar: continue
            s['set_code']=normalize_set_code(s['set_code'], konami_id=str(c.get('id') or ''))
            pre=s['set_code'].split('-')[0]; first=pre in old
            pri=newb(pre)*views*(3 if first else 1)*(2 if any(k in s['set_rarity'] for k in ('Ghost','Starlight','Quarter','Ultimate','Secret')) else 1)
            for ed in (['1st','Unlimited'] if first else ['']):
                k=f"{c['name']}|{s['set_code']}|{s['set_rarity']}|{ed}"
                U[k]=dict(name=c['name'],code=s['set_code'],rarity=s['set_rarity'],ed=ed,pri=pri*(1 if ed!='Unlimited' else .4))
    return U,meta
# ---------- sources ----------
RAR_ABBR={'quarter century secret rare':r'quarter century|qcsr|qcr|25th secret','starlight rare':r'starlight','platinum secret rare':r'platinum secret','ghost rare':r'ghost','ultimate rare':r'ultimate','collector\'s rare':r'collector','prismatic secret rare':r'prismatic','secret rare':r'(?<!quarter century )(?<!platinum )(?<!prismatic )secret','ultra rare':r'(?<!secret )ultra','super rare':r'super','gold rare':r'gold'}
def rar_norm(x):
    x=(x or '').lower().strip()
    for k,pat in RAR_ABBR.items():
        if re.search(pat,x): return k
    return x
_codeR=None
def code_rarities(code):
    global _codeR
    if _codeR is None:
        _codeR={}
        try:
            for c in json.load(open(P('ygopro.json')))['data']:
                for s_ in c.get('card_sets') or []: _codeR.setdefault(s_['set_code'].lower(),set()).add(rar_norm(s_['set_rarity']))
        except Exception: pass
    return _codeR.get(code.lower(),set())
def rarity_ok(card,text):
    """exact rarity: text's rarity must equal card rarity; if text names none, allowed only when the set code has one rarity"""
    want=rar_norm(card['rarity']); got=rar_norm(text) if text and text not in ('na','n/a','none','') else ''
    if got and got in RAR_ABBR: return got==want
    return code_rarities(card['code'])=={want}
def pc(card):
    q=f"{card['name']} {card['code']}"+(' 1st' if card['ed']=='1st' else '')
    url,t=get('https://www.pricecharting.com/search-products?'+urllib.parse.urlencode({'q':q,'type':'prices'}))
    if '/game/' not in url:  # multiple results: pick strict match from list
        cands=re.findall(r'href="(https://www.pricecharting.com/game/[^"]+)"',t)
        code=card['code'].lower(); ok=[u for u in dict.fromkeys(cands) if code in u.lower() and (('1st-edition' in u)==(card['ed']=='1st'))]
        rk=card['rarity'].lower().replace(' ','-').replace("'",'')
        ok.sort(key=lambda u:(rk.split('-')[0] not in u, len(u)))
        if not ok: return None
        time.sleep(C['pc_delay_s']); url,t=get(ok[0])
    m=re.search(r'chart_data = (\{.*?\});',t)
    if not m: return None
    title=html.unescape(re.search(r'<title>([^<|]*)',t).group(1)).strip(); tl=title.lower()
    # strict print matching
    if card['code'].lower() not in tl: return None
    if card['ed']=='1st' and '1st' not in tl: return None
    if card['ed']=='Unlimited' and '1st' in tl: return None
    nn=lambda x:re.sub(r'[^a-z0-9]','',html.unescape(x).lower())
    tname=re.sub(r'\[[^\]]*\]|prices$','',re.sub(re.escape(card['code']),'',title,flags=re.I).strip(),flags=re.I)
    if nn(tname)!=nn(card['name']): return None
    br=' '.join(re.findall(r'\[([^\]]+)\]',title)).lower().replace('1st edition','')
    if not rarity_ok(card,br if rar_norm(br) in RAR_ABBR else ''): return None
    vol=re.search(r'volume:&nbsp;</span>\s*<a[^>]*>([^<]+)',t)
    return {'url':url.split('?')[0],'title':title,'chart':json.loads(m.group(1)),'vol':re.sub(r'<[^>]+>|&nbsp;',' ',vol.group(1)).strip() if vol else ''}
_tok=None
def ebay_token():
    global _tok
    if _tok is not None: return _tok
    root=os.environ.get('CARD_ROOT','/workspace')
    for c in [P('.ebay_env'),os.path.join(root,'pokebot','.ebay_env'),os.path.join(root,'ygo_cards','.ebay_env')]:
        if os.path.exists(c):
            e=dict(l.strip().split('=',1) for l in open(c) if '=' in l)
            b=base64.b64encode(f"{e['EBAY_CLIENT_ID']}:{e['EBAY_CLIENT_SECRET']}".encode()).decode()
            try:
                _tok=json.loads(get('https://api.ebay.com/identity/v1/oauth2/token',{'Authorization':'Basic '+b,'Content-Type':'application/x-www-form-urlencoded'},
                    b'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope')[1])['access_token']; return _tok
            except Exception as x: print('ebay token fail',x)
    _tok=''; return _tok
BADCOND=r'damaged|\bdmg\b|\bhp\b|heavily|\bplayed\b|\bmp\b|moderately|\bpoor\b|crease|bent|water|scratch|wear(ed)?\b|\bdent'
REPRINTS=r'\b(lc\d\w*|legendary collection|op\d+|ots|speed duel|25th|quarter century|rarity collection|ra0\d|lart|mged|ldk2|lds\d|sbc|dcr|dlg)\b'
COUNTERFEIT_CARDS=('Blue-Eyes White Dragon','Red-Eyes Black Dragon','Dark Magician','Dark Magician Girl','Jinzo','Exodia the Forbidden One','Black Luster Soldier','Gate Guardian','Summoned Skull')
def ebay_get(iid,tok):
    try: return json.loads(get('https://api.ebay.com/buy/browse/v1/item/'+urllib.parse.quote(iid),{'Authorization':'Bearer '+tok,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','X-EBAY-C-ENDUSERCTX':'contextualLocation=country%3DCA%2Czip%3DM5V2T6'})[1])
    except Exception: return {}
def cert_check(title,graded):
    if not graded: return None,''
    m=re.search(r'\b(\d{8,9})\b',title)
    # PSA public cert pages return 403 to scripts and the PSA API needs a token -> cannot verify for free
    return None,('cert# '+m.group(1)+' found, verify at psacard.com/cert' if m else 'no cert# in title: verify slab')
def ebay_live(card,graded,market=0,fx_=1.4):
    tok=ebay_token()
    if not tok: return None
    q=f"{card['name']} {card['code']}"+(' 1st' if card['ed']=='1st' else '')+(' PSA 10' if graded else '')
    u='https://api.ebay.com/buy/browse/v1/item_summary/search?'+urllib.parse.urlencode({'q':q,'sort':'price','limit':'50','filter':'buyingOptions:{FIXED_PRICE},priceCurrency:USD','category_ids':'183454'})
    try: items=json.loads(get(u,{'Authorization':'Bearer '+tok,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','X-EBAY-C-ENDUSERCTX':'contextualLocation=country%3DCA%2Czip%3DM5V2T6'})[1]).get('itemSummaries',[])
    except Exception as x: print(' ebay err',x); return None
    codes_re=re.compile(r'\b[a-z0-9]{2,5}-(?:en|e)?\d{3}\b'); cands=[]
    for it in items:
        ti=it['title'].lower(); p=float(it['price']['value'])
        ship=float(((it.get('shippingOptions') or [{}])[0].get('shippingCost') or {}).get('value',0) or 0)
        code=card['code'].lower()
        if code not in ti: continue
        if any(c!=code for c in codes_re.findall(ti)): continue          # other set code in title
        if card['ed']=='1st' and (not re.search(r'1st|first',ti) or re.search(r'\bunl|unlimited',ti)): continue
        if card['ed']=='Unlimited' and re.search(r'1st|first',ti): continue
        if re.search(LANG,ti) or re.search(FAKE,ti) or re.search(r'\blot\b|\bx\d\b|\d ?x\b|playset|bundle|choose|pick',ti): continue
        if re.search(REPRINTS,ti) and not re.search(REPRINTS,code): continue
        if graded!=bool(re.search(r'psa\s*10',ti)): continue
        if not graded and re.search(r'\b(psa|bgs|cgc|sgc|beckett|graded)\b',ti): continue
        cands.append((p+ship,it,p,ship))
    cands.sort(key=lambda x:x[0]); best=None; good=[]
    for tot,it,p,ship in cands[:5]:
        d=ebay_get(it['itemId'],tok); ti=it['title'].lower(); sel=it.get('seller') or {}
        if not d.get('shippingOptions'): continue   # does not ship to Canada (CA context returned no shipping option)
        cond=(d.get('condition') or it.get('condition') or '')+' '+' '.join(f"{x.get('name')}:{x.get('value')}" for x in d.get('localizedAspects',[]) or [])
        cl=cond.lower(); why=[]
        if d.get('shippingOptions'):
            try: ship=float(d['shippingOptions'][0]['shippingCost']['value'])
            except Exception: pass
        rej=bool(re.search(BADCOND,ti+' '+cl)) or bool(re.search(FAKE,cl)) or bool(re.search(LANG,' '.join(str(x.get('value','')).lower() for x in d.get('localizedAspects',[]) or [] if x.get('name','').lower()=='language') ))
        if rej: why.append('damaged/played or wrong language in specifics')
        cs=90 if re.search(r'near mint|\bnm\b|mint|gem',ti+' '+cl) else 70 if re.search(r'lightly|\blp\b|excellent',ti+' '+cl) else 60
        if graded: cs=95
        fb=float(sel.get('feedbackPercentage') or 0); fn=int(sel.get('feedbackScore') or 0)
        ag='AUTHENTICITY_GUARANTEE' in json.dumps(d.get('qualifiedPrograms') or it.get('qualifiedPrograms') or [])
        ret_ok=bool((d.get('returnTerms') or {}).get('returnsAccepted'))
        ss=max(0,min(100,(fb-90)*6+min(fn,5000)/5000*25+(10 if ret_ok else 0)+(15 if ag else 0)))
        ctry=(it.get('itemLocation') or {}).get('country','')
        fr=0
        if card['name'] in COUNTERFEIT_CARDS or card['code'].split('-')[0] in ('LOB','MRD','SRL','PSV','MFC','SDK','SDJ','SDY','IOC','LON'): fr+=35
        if market and p+ship<0.5*market: fr+=35; why.append('price <50% of sold raw: likely fake/misprint/mislisting')
        if ctry in ('CN','HK','TW','MY','PH','VN','ID'): fr+=20; why.append('ships from '+ctry)
        if fn<50 or fb<98: fr+=15; why.append(f'seller {fb}%/{fn}')
        if re.search(r'stock|sample image|not actual',ti+' '+(d.get('description','') or '')[:3000].lower()): fr+=10; why.append('stock photo')
        if ag: fr-=25
        fr=max(0,min(100,fr))
        ok,cnote=cert_check(it['title'],graded)
        usd=p+ship; cad_total=round(usd*fx_*(1+C.get('ca_tax_pct',13)/100)+C.get('ca_duty_brokerage_cad',0),2)
        import verify as _V
        _m,_why=_V.check(card,{'url':it['itemWebUrl'],'price':p,'ship':ship},graded,tok,d if d.get('title') else None)
        if not _m: why.append('verifier: '+_why)
        vet=bool(_m) and (not rej) and fr<50 and ss>=60 and cs>=70 and not (market and usd<0.5*market)
        r={'site':'eBay','seller':sel.get('username'),'item_price':p,'currency':it['price'].get('currency','USD'),'title':it['title'],'price':p,'ship':ship,'url':it['itemWebUrl'].split('?')[0],'fake_risk':fr,'condition':cs,'seller_score':round(ss),
           'cad_total':cad_total,'ship_ca':ship,'cert_ok':ok,'cert_note':cnote,'vetted':vet,'auth_guarantee':ag,'ships_from':ctry,'why':why}
        if vet: good.append(r)
        if len(good)>=3: break
        best=best or r
        time.sleep(.3)
    if good: good[0]['offers']=good[:3]; return dict(good[0],offers=[{k:v for k,v in g.items() if k!='offers'} for g in good[:3]])
    return best
def psa_pop(card):  # best effort; psacard.com returns 403 to scripts -> None
    return None
# ---------- analytics ----------
def ser(c,k): return [(datetime.datetime.utcfromtimestamp(t/1000).date(),v/100) for t,v in (c.get(k) or []) if v]
def ret(s,m): return (s[-1][1]/s[-1-m][1]-1)*100 if len(s)>m else None
def analyze(c):
    raw,p9,p10=ser(c,'used'),ser(c,'graded'),ser(c,'manualonly'); a={}
    for m in (1,3,6,12,24): a[f'r{m}']=ret(raw,m)
    a['rall']=ret(raw,len(raw)-1) if len(raw)>1 else None; a['p10_12']=ret(p10,12); a['months']=len(raw)
    if len(raw)>2:
        v=[x[1] for x in raw]; peak=v[0]; mdd=0; dips=[]; i0=None
        for i,x in enumerate(v):
            if x>=peak:
                if i0 is not None: dips.append(i-i0); i0=None
                peak=x
            dd=(x/peak-1)*100; mdd=min(mdd,dd)
            if dd<-20 and i0 is None: i0=i
        a['mdd']=mdd; a['dips']=len(dips)+(1 if i0 is not None else 0); a['recov_m']=st.mean(dips) if dips else None; a['in_dip']=i0 is not None
        mr=[(v[i]/v[i-1]-1) for i in range(1,len(v)) if v[i-1]]; a['vol']=st.pstdev(mr)*100 if len(mr)>1 else None
        sp=[i for i in range(1,len(v)-3) if v[i-1] and v[i]/v[i-1]>1.3]; a['spikes']=len(sp)
        a['post_spike3']=st.mean([(v[i+3]/v[i]-1)*100 for i in sp]) if sp else None
        last12=v[-13:-1] if len(v)>13 else v[:-1]; med=st.median(last12) if last12 else v[-1]; a['vs_median']=(v[-1]/med-1)*100
        seas={}
        for i in range(1,len(raw)):
            if raw[i-1][1]: seas.setdefault(raw[i][0].month,[]).append(raw[i][1]/raw[i-1][1]-1)
        a['seas']={m:round(st.mean(x)*100,1) for m,x in seas.items()}
    rob=lambda x:(st.median([y[1] for y in x[-3:]]) if x else 0)  # outlier-robust: median of last 3 months
    a['raw'],a['p9'],a['p10']=rob(raw),rob(p9),rob(p10)
    if p10 and len(p10)>=3 and p10[-1][1]>2*a['p10']: a['p10_spike']=1
    if raw and p10 and len(raw)>12 and len(p10)>12 and raw[-13][1]: a['spread_then']=p10[-13][1]/raw[-13][1]
    a['spread']=a['p10']/a['raw'] if a['raw'] else 0
    return a
def era_10_rate(code,rarity):  # heuristic PSA10 share when pop unavailable
    pre=code.split('-')[0]
    if pre in ('LOB','MRD','SRL','MRL','PSV','LON','LOD','PGD','MFC','SDK','SDY','SDJ'): b=.08
    elif pre in C['first_ed_sets']: b=.15
    else: b=.35
    if 'Ghost' in rarity or 'Starlight' in rarity: b*=.7
    return b
def flags(card,a,meta,live):
    f=[]; m=meta.get(card['name'],{})
    if m.get('n_prints',0)>=8: f.append(f"reprinted {m['n_prints']}x (reprint risk)")
    if m.get('ban'): f.append(f"TCG banlist: {m['ban']}")
    if card['code'].split('-')[0] in ('LOB','MRD','SRL','PSV','MFC','IOC','LON') or card['name'] in ('Dark Magician Girl','Blue-Eyes White Dragon','Dark Magician','Red-Eyes Black Dragon','Jinzo','Exodia the Forbidden One'):
        f.append('HIGH counterfeit risk: check font, holo, back, weight; buy authenticated/graded')
    if card['code'].split('-')[0] in ('LOB','MRD','SRL','PSV','LON','LOD','MFC'): f.append('era known for off-centering/edge wear: inspect before grading')
    if 'Ghost' in card['rarity'] or 'Starlight' in card['rarity']: f.append('premium foil: surface print lines common')
    if live and a.get('raw') and live['price']<0.5*a['raw']: f.append('live price <50% of market: possible fake/misprint/mislisting')
    return f
def net_grade(a,rate,fx_):
    """expected CAD profit of buying raw at market and grading (PSA) then selling, using PSA10 odds"""
    if not a['raw'] or not a['p10']: return None
    cost=a['raw']*fx_+C['psa_fee_usd']*fx_+C['ship_to_grader_cad']+C['ship_back_cad']
    p9=a['p9'] or a['raw']; low=a['raw']*0.8
    ev_sale=(rate*a['p10']+(0.45)*p9+(0.55-rate if rate<0.55 else 0)*low)*fx_
    ev_net=ev_sale*(1-C['ebay_fee_pct']/100)-C['ebay_fixed_usd']*fx_-C['ship_to_buyer_cad']
    p10_net=a['p10']*fx_*(1-C['ebay_fee_pct']/100)-C['ebay_fixed_usd']*fx_-C['ship_to_buyer_cad']-cost
    return round(ev_net-cost,0),round(p10_net,0)
W0={'trend':0.35,'gap':1.5,'liq':4,'p10trend':0.15,'dip':0.2,'risk':6}
def score(a,vol,fl,W):
    tr=[x for x in (a.get('r3'),a.get('r6'),a.get('r12'),a.get('r24')) if x is not None]; t=st.mean(tr) if tr else 0
    t=max(-100,min(t,200)); vs=3 if 'week' in vol else 2 if 'month' in vol else 1 if 'year' in vol else 0
    s=W['trend']*t+W['gap']*min(a.get('spread',0),30)+W['liq']*vs+W['p10trend']*max(-100,min(a.get('p10_12') or 0,200))
    s+=W['dip']*max(0,-(a.get('vs_median') or 0))   # below typical range = better entry
    s-=W['risk']*sum(1 for x in fl if 'reprint' in x or 'banlist' in x)
    conf=('high' if a['months']>=24 and vs>=2 else 'medium' if a['months']>=12 and vs>=1 else 'low')
    return round(s,1),conf
IDX12=0
def final_rank(r,fx_):
    """risk-adjusted expected net profit (CAD) from a VETTED buyable listing + long-term outlook. Unvetted -> bottom."""
    a=r['a']; l=r.get('lr')
    if not l or not l.get('vetted') or not a['raw']: return round(r['score']-200,1),None
    buy=l['cad_total']; rate=r.get('rate',.1); sellf=lambda usd:usd*fx_*(1-C['ebay_fee_pct']/100)-C['ebay_fixed_usd']*fx_-C['ship_to_buyer_cad']
    gcost=C['psa_fee_usd']*fx_+C['ship_to_grader_cad']+C['ship_back_cad']
    p10=min(a['p10'],a['raw']*40) if a['p10'] else 0   # cap so rare-10 outliers can't dominate
    p9=a['p9'] or a['raw']; r9=min(.45,1-rate)
    ev_grade=rate*sellf(p10)+r9*sellf(p9)+(1-rate-r9)*sellf(a['raw']*1.1)-gcost-buy if p10 else -1e9
    # BUY-AND-HOLD first (same raw item, 12m horizon): robust trend, shrunk 50%, capped; grading = optional upside
    tr=[x for x in ((a.get('r12')), (a.get('r24') or 0)/2 if a.get('r24') is not None else None) if x is not None]
    own=st.median(tr)/100 if tr else IDX12
    g12=max(-.4,min(.5,0.3*own+0.7*IDX12))   # walk-forward found no picking edge vs hold-all: mostly index return
    mval=max(a['raw'],l['price'])*(1+g12)   # exit at market (never below what this exact item lists for)
    mval=a['raw']*(1+g12)
    ev_hold=sellf(mval)-buy
    up=max(0,ev_grade-ev_hold) if ev_grade>-1e8 else 0
    r['hold_cad']=round(ev_hold,0); r['hold_sourced']=True; r['grade_upside_cad']=round(up,0)
    prof=(ev_hold+0.5*up)*(1-l['fake_risk']/100)
    roi=max(-1,min(prof/buy,2)) if buy else 0
    vs=3 if 'week' in str(r['vol']) else 2 if 'month' in str(r['vol']) else 1 if 'year' in str(r['vol']) else 0
    liq=-15 if vs==0 else (-5 if vs==1 else 0)
    cap=-10*max(0,math.log2(buy/500)) if buy>500 else 0   # capital haircut above C$500
    liq+=cap; r['cost_cad']=round(buy,2)
    r['ret_pct']=round(roi*100,1); return round(0.5*r['score']+40*roi+liq,1),round(prof,0)
# ---------- backtest & outcome learning ----------
def backtest(db):
    rows=db.execute('select key,chart from charts').fetchall(); res=[]
    for k,ch in rows:
        c=json.loads(ch); raw=ser(c,'used')
        if len(raw)<30: continue
        for cut in range(18,len(raw)-12,6):
            sub={kk:[x for x in (c.get(kk) or [])][:cut] for kk in c}; a=analyze(sub)
            fwd=raw[cut-1+12][1]/raw[cut-1][1]-1 if raw[cut-1][1] else 0; res.append((a,fwd))
    if len(res)<40: return W0,f'backtest: only {len(res)} samples yet (needs history from more cards); default weights.'
    best=None
    for tw in (0.1,0.35,0.7):
        for gw in (0.5,1.5,3):
            for dw in (0,0.2,0.6):
                W={**W0,'trend':tw,'gap':gw,'dip':dw}; sc=sorted(res,key=lambda r:-score(r[0],'1 sale per month',[],W)[0])
                top=sc[:max(1,len(sc)//5)]; hit=sum(1 for _,f in top if f>0)/len(top)
                if not best or hit>best[0]: best=(hit,W,st.mean(f for _,f in top))
    base=sum(1 for _,f in res if f>0)/len(res)
    return best[1],(f"in-sample backtest (walk-forward vs hold-all index showed NO reliable picking edge, so expected returns lean on the market index) on {len(res)} card-periods: top-20% by score rose over next 12m {best[0]*100:.0f}% of the time "
        f"(avg {best[2]*100:+.0f}%) vs {base*100:.0f}% for all cards. Past results don't guarantee future ones; in-sample tuning overstates accuracy.")
def outcome_adj():
    """learn from real results: compare logged grade results vs heuristic PSA10 rate"""
    try: rows=list(csv.DictReader(open(P('outcomes.csv'))))
    except Exception: return 1.0,'no outcomes yet'
    g=[r for r in rows if r.get('action(buy/grade_result/sell)','').strip()=='grade_result']
    if not g: return 1.0,'no grading results logged yet'
    tens=sum(1 for r in g if r['grade'].strip()=='10'); adj=max(0.3,min(2.0,(tens/len(g))/0.25))
    return adj,f'{tens}/{len(g)} logged grades were 10s; PSA10 odds scaled x{adj:.2f}'
# ---------- events ----------
def events():
    out=[]; kw=re.compile(r'reprint|ban ?list|forbidden|limited list|anniversary|anime|25th|quarter century|rarity collection|legendary collection|tin',re.I)
    for u in ('https://ygorganization.com/feed/','https://news.google.com/rss/search?q=yugioh+(reprint+OR+banlist+OR+%22limited+list%22+OR+anniversary)&hl=en-CA&gl=CA&ceid=CA:en'):
        try: t=get(u)[1]
        except Exception as x: out.append(f'feed error {u}: {x}'); continue
        for it in re.findall(r'<item>(.*?)</item>',t,re.S)[:30]:
            ti=html.unescape(re.sub(r'<!\[CDATA\[|\]\]>','',(re.search(r'<title>(.*?)</title>',it,re.S) or [None,''])[1])).strip()
            ln=(re.search(r'<link>(.*?)</link>',it,re.S) or [None,''])[1].strip(); dt=(re.search(r'<pubDate>(.*?)</pubDate>',it) or [None,''])[1][:16]
            if kw.search(ti): out.append(f'{dt} - {ti} - {ln}')
    return out[:15]
# ---------- main ----------
def main():
    t0=time.time(); transport_stopped=False
    db=sqlite3.connect(P('history.db'))
    db.execute('create table if not exists snap(day,key,title,url,raw,psa9,psa10,vol,live_raw,live_raw_url,live_psa10,live_psa10_url,score,conf)')
    db.execute('create table if not exists charts(key primary key,title,url,chart,vol,last_checked)')
    db.execute('create table if not exists queue(key primary key,pri,last_checked)')
    fx_=fx(); U,meta=universe(); day=datetime.date.today().isoformat()
    for k,ch in db.execute('select key,chart from charts').fetchall():
        try:
            u=[v for t,v in (json.loads(ch).get('used') or []) if v]
            if k in U and len(u)>=4 and u[-1]>u[-4]*1.15: U[k]['pri']*=10; U[k]['rising']=1
        except Exception: pass
    for k,v in U.items(): db.execute('insert or ignore into queue values(?,?,0)',(k,v['pri']))
    for k,v in U.items(): db.execute('update queue set pri=? where key=?',(v['pri'],k))
    db.commit()
    must=[]
    for l in open(P('watchlist.txt')):
        if '|' in l and not l.startswith('#'): must.append(l.strip())
    coll=list(csv.DictReader(open(P('my_collection.csv'))))
    for r in coll: must.append(f"{r['name']}|{r['set_code']}|{r['rarity']}|{'1st' if r['edition'].lower().startswith('1st') else ('Unlimited' if r['set_code'].split('-')[0] in C['first_ed_sets'] else '')}")
    owned_keys=set(must[len(must)-len(coll):])
    for k in must:
        n,c_,r_,e=k.split('|'); U.setdefault(k,dict(name=n,code=c_,rarity=r_,ed=e,pri=1e12))
    work=next_work(db, C['batch_per_run'], max(1, C['batch_per_run']//5))
    todo=list(dict.fromkeys(must+[item['key'] for item in work['discover']+work['refresh']])); n_ok=0
    for k in todo:
        if k not in U: continue
        try: p=pc(U[k])
        except urllib.error.HTTPError as x:
            print('pc transport',k,x.code); mark_queue(db,k,U[k]['pri'],'transport',time.time()); db.commit(); transport_stopped=True; break
        except Exception as x: print('pc err',k,x); p=None
        time.sleep(C['pc_delay_s'])
        mark_queue(db,k,U[k]['pri'],'acquired' if p else 'rejected',time.time())
        if p: db.execute('insert or replace into charts values(?,?,?,?,?,?)',(k,p['title'],p['url'],json.dumps(p['chart']),p['vol'],time.time())); n_ok+=1
        db.commit()
    if transport_stopped: commit_stamp(False); return
    W,bt=backtest(db); adj,oc=outcome_adj(); rows=[]
    for k,title,url,ch,vol,lc in db.execute('select * from charts').fetchall():
        if k not in U: continue
        a=analyze(json.loads(ch)); fl=flags(U[k],a,meta,None); s,conf=score(a,vol,fl,W)
        rows.append(dict(key=k,card=U[k],title=title,url=url,vol=vol,a=a,fl=fl,score=s,conf=conf,owned=k in owned_keys,rising=U[k].get('rising') and k not in must))
    rows.sort(key=lambda r:-r['score']); budget=C['budget_cad']
    pool=[r for r in rows if r['a']['raw']*fx_>=C.get('min_cad',20)]; live_set=pool[:C['ebay_live_top_n']]+[r for r in rows if r['owned']]+[r for r in rows if r['a']['raw']*fx_<=budget][:30]
    seen=set()
    for r in live_set:
        if r['key'] in seen: continue
        seen.add(r['key']); r['lr']=ebay_live(r['card'],False,r['a']['raw'],fx_); r['lg']=ebay_live(r['card'],True,r['a']['p10'],fx_); time.sleep(1)
        r['fl']=flags(r['card'],r['a'],meta,r['lr'])
        db.execute('insert into snap values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(day,r['key'],r['title'],r['url'],r['a']['raw'],r['a']['p9'],r['a']['p10'],r['vol'],
            r['lr'] and r['lr']['price'],r['lr'] and r['lr']['url'],r['lg'] and r['lg']['price'],r['lg'] and r['lg']['url'],r['score'],r['conf']))
    db.commit()
    for r in rows:
        rate=min(.9,era_10_rate(r['card']['code'],r['card']['rarity'])*adj); r['rate']=rate; r['net']=net_grade(r['a'],rate,fx_)
    global IDX12
    _r=[r['a'].get('r12') for r in rows if r['a'].get('r12') is not None]; IDX12=(st.median(_r)/100) if _r else 0
    for r in rows: r['lt']=r['score']; r['final'],r['profit']=final_rank(r,fx_)
    rows.sort(key=lambda r:-r['final'])
    json.dump([dict(q=r['key'],title=r['title'],url=r['url'],raw=r['a']['raw'],p9=r['a']['p9'],p10=r['a']['p10'],vol=r['vol'],t3=r['a'].get('r3'),t6=r['a'].get('r6'),t12=r['a'].get('r12'),t24=r['a'].get('r24'),t12g=r['a'].get('p10_12'),
        score=r['final'],lt_score=r['lt'],conf=r['conf'],exp_profit_cad=r['profit'],ev_net=r['profit'],grade_upside_cad=r.get('grade_upside_cad'),**public_metrics(r),tier=(lambda c:'<=100' if c<=100 else '<=500' if c<=500 else '<=2000' if c<=2000 else 'all')((r.get('lr') or {}).get('cad_total') or r['a']['raw']*fx_),grade10_rate=r.get('rate'),flags=r['fl'],owned=r['owned'],lr=r.get('lr'),lg=r.get('lg'),
        vetted=bool(r.get('lr') and r['lr'].get('vetted')),fake_risk=(r.get('lr') or {}).get('fake_risk'),condition=(r.get('lr') or {}).get('condition'),
        seller_score=(r.get('lr') or {}).get('seller_score'),cad_total=(r.get('lr') or {}).get('cad_total'),cert_ok=(r.get('lg') or {}).get('cert_ok')) for r in rows],open(P('latest.json'),'w'),indent=1,default=str)
    for r in rows: r['score']=r['final']
    write_reports(rows,fx_,W,bt,oc,events(),day,n_ok,len(todo),db.execute('select count(*) from queue').fetchone()[0],time.time()-t0)
    commit_stamp(True)
def F(x,s='%'): return '-' if x is None else (f'{x:+.0f}%' if s=='%' else f'{x:.0f}')
def write_reports(rows,fx_,W,bt,oc,ev,day,n_ok,n_try,nq,el):
    cad=lambda u:u*fx_; budget=C['budget_cad']; L=lambda l:f"[C${cad(l['price']+l.get('ship',0)):.0f}]({l['url']})" if l else '-'
    hdr=f'Advice only - trading paused, never buy/bid. Scores are a LIKELIHOOD ranking, not a guarantee. USD->CAD {fx_:.4f}. Raw/PSA9/PSA10 = PriceCharting sold-based. Live = cheapest strict-matched eBay Buy-It-Now incl. shipping at run time.'
    o=[f'# Yu-Gi-Oh growth report {day}',hdr,'',f'Run: {n_ok}/{n_try} cards refreshed, universe queue {nq}, {el/60:.0f} min. {bt} Outcomes: {oc}.','',
       '## Top 40 by growth likelihood','| # | Card | Raw C$ | PSA9 C$ | PSA10 C$ | 10/raw | 3/6/12/24m | PSA10 12m | MaxDD | Vol | Score (conf) | Grade EV C$ (if 10) | Live raw | Live PSA10 | Flags |','|'+'-|'*15]
    for i,r in enumerate(rows[:40],1):
        a=r['a']; n=r.get('net')
        o.append(f"| {i} | [{r['title']}]({r['url']}) | {cad(a['raw']):.0f} | {cad(a['p9']):.0f} | {cad(a['p10']):.0f} | {a['spread']:.1f}x | {F(a.get('r3'))}/{F(a.get('r6'))}/{F(a.get('r12'))}/{F(a.get('r24'))} | {F(a.get('p10_12'))} | {F(a.get('mdd'))} | {r['vol']} | {r['score']} ({r['conf']}) | {n[0] if n else '-'} ({n[1] if n else '-'}) | {L(r.get('lr'))} | {L(r.get('lg'))} | {'; '.join(r['fl'])} |")
    bud=[r for r in rows if 0<cad(r['a']['raw'])<=budget][:15]
    o+=['',f'## Best under budget (C${budget})']+[f"- {r['title']}: raw C${cad(r['a']['raw']):.0f}, PSA10 C${cad(r['a']['p10']):.0f}, score {r['score']} ({r['conf']}), live {L(r.get('lr'))}" for r in bud]
    bz=[r for r in rows if r['a'].get('vs_median') is not None and r['a']['vs_median']<-15 and r['conf']!='low'][:15]
    o+=['','## Buy-zone flags (raw >15% below its 12-month median)']+[f"- {r['title']}: {r['a']['vs_median']:+.0f}% vs median, typical recovery {F(r['a'].get('recov_m'),'n')} months, live {L(r.get('lr'))}" for r in bz]
    deals=[r for r in rows if r.get('lr') and r['a']['raw'] and r['lr']['price']+r['lr']['ship']<0.85*r['a']['raw']]
    o+=['','## Live listings >15% under market (verify condition/authenticity)']+[f"- {r['title']}: {L(r['lr'])} vs market C${cad(r['a']['raw']):.0f}" for r in deals]
    own=[r for r in rows if r['owned']]; al=[]
    for r in own:
        a=r['a']; n=r.get('net'); s=f"- {r['title']}: raw C${cad(a['raw']):.0f}, PSA9 C${cad(a['p9']):.0f}, PSA10 C${cad(a['p10']):.0f}. PSA10 odds ~{r['rate']*100:.0f}% (era heuristic; PSA pop blocked)."
        if n: s+=f" Grading EV C${n[0]:+.0f}; if it gets a 10 C${n[1]:+.0f}. "+('WORTH GRADING if card is flawless.' if n[0]>0 else 'Grading EV negative unless near-certain 10.')
        if (a.get('r1') or 0)>25 or (a.get('r3') or 0)>50: s+=' SELL SIGNAL: price spiked; past spikes averaged '+F(a.get('post_spike3'))+' 3 months later.'; al.append(s)
        o.append(s)
    o=o[:o.index(f'## Best under budget (C${budget})')]+['## My collection']+[x for x in o if x.startswith('- ') and any(r['title'] in x for r in own)]+['']+o[o.index(f'## Best under budget (C${budget})'):] if own else o
    o+=['','## Event alerts (reprints / banlist / hype news)']+[f'- {e}' for e in ev]
    o+=['','Fees used (edit config.json, verify current PSA/CGC pricing): '+json.dumps({k:v for k,v in C.items() if 'fee' in k or 'ship' in k}),'Weights: '+json.dumps(W)]
    open(P('REPORT.md'),'w').write('\n'.join(o)+'\n')
    # TRENDS
    cat={}
    for r in rows:
        pre=r['card']['code'].split('-')[0]; era='2002-2004 vintage' if pre in C['first_ed_sets'][:13] else ('2005-2010 1st-ed era' if pre in C['first_ed_sets'] else 'modern/reprint')
        for kk in (era,r['card']['rarity'],('1st' if r['card']['ed']=='1st' else 'non-1st')):
            cat.setdefault(kk,[]).append(r['a'])
    t=[f'# Yu-Gi-Oh market trends {day} (from {len(rows)} tracked prints)','','| Category | n | med 3m | med 12m | med 24m | med PSA10 12m | med max drawdown | avg after-spike 3m |','|-|-|-|-|-|-|-|-|']
    md=lambda L:F(st.median(L)) if L else '-'
    for kk,v in sorted(cat.items(),key=lambda x:-len(x[1])):
        g=lambda f:[a[f] for a in v if a.get(f) is not None]
        t.append(f"| {kk} | {len(v)} | {md(g('r3'))} | {md(g('r12'))} | {md(g('r24'))} | {md(g('p10_12'))} | {md(g('mdd'))} | {md(g('post_spike3'))} |")
    se={}
    for r in rows:
        for m,x in (r['a'].get('seas') or {}).items(): se.setdefault(m,[]).append(x)
    t+=['','## Seasonality (median month-over-month raw change)']+[f"- {datetime.date(2000,m,1):%b}: {st.median(x):+.1f}% (n={len(x)})" for m,x in sorted(se.items())]
    t+=['','## Patterns','- Spikes (>30% in a month) are usually followed by the 3-month change shown above per category; negative = typical post-hype dip.',
        '- Reprint announcements typically hit unlimited/non-1st prints hardest; 1st-edition vintage and PSA10s tend to hold better.',
        '- Use buy-zone flags (below 12m median) for entries; confidence is low for cards with <12 months history or thin sales.']
    open(P('TRENDS.md'),'w').write('\n'.join(t)+'\n')
    top=[r for r in rows if 0<cad(r['a']['raw'])<=budget ][:5] or rows[:5]
    s=[f'# YGO daily {day}','Advice only, not a guarantee. Top 5 (budget C$'+str(budget)+'):']
    for r in top:
        a=r['a']; lk=r.get('lr'); why=f"{F(a.get('r12'))} 12m, PSA10 {a['spread']:.1f}x raw, {r['vol']}".replace('&nbsp;','')
        s.append(f"- {r['card']['name']} {r['card']['code']} {r['card']['ed']}: C${cad(a['raw']):.0f} | score {r['score']} ({r['conf']}) | {why} | {lk['url'] if lk else r['url']}")
    disc=[r for r in rows if r.get('rising')][:5]
    s+=['','New/rising discoveries (auto-found, not seeded):']+[f"- {r['card']['name']} {r['card']['code']} {r['card']['rarity']}: C${cad(r['a']['raw']):.0f}, 3m {F(r['a'].get('r3'))} | {r['url']}" for r in disc]+(['- none yet (builds as rotation covers new sets)'] if not disc else [])
    s+=['','Alerts:']+(al or ['- none for your collection'])+[f'- {e}' for e in ev[:3]]
    open(P('SUMMARY.md'),'w').write('\n'.join(s)+'\n'); print('reports written',len(rows))
if __name__=='__main__':
    if len(sys.argv)>1: C['batch_per_run']=int(sys.argv[1])
    main()
    import verify; verify.main()
