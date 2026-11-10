#!/usr/bin/env python3
"""Zero-token static card-deals PWA generator. No LLM. Tolerant of missing tracker data."""
import json,os,sqlite3,csv,html,time,datetime,sys
B=os.path.dirname(os.path.abspath(__file__));S=os.path.join(B,'site')
# PriceCharting chart series (cents): used=raw, graded=PSA9, manualonly=PSA10
SER={'used':'raw','graded':'p9','manualonly':'p10'}
def charts(db):
    out={}
    try:
        c=sqlite3.connect(db)
        for url,ch in c.execute('select url,chart from charts'):
            try:
                j=json.loads(ch);out[url]={v:[[t,p/100] for t,p in j.get(k,[]) if p] for k,v in SER.items()}
            except Exception: pass
    except Exception: pass
    return out
def _root():
    return os.environ.get('CARD_ROOT','/workspace')
def load(dirn):
    d=os.path.join(_root(),dirn);cards=[];sample=False
    for f in ('latest.json','latest_picks.json','picks.json'):
        p=os.path.join(d,f)
        if os.path.exists(p):
            try: cards=json.load(open(p));break
            except Exception: pass
    if isinstance(cards,dict): cards=cards.get('cards') or cards.get('picks') or []
    if not cards: sample=True;cards=SAMPLE[dirn]
    ch={}
    for f in ('history.db','tracker.db','mtg.db'):
        if os.path.exists(os.path.join(d,f)): ch.update(charts(os.path.join(d,f)))
    out=[]
    for c in cards:
        if isinstance(c,dict) and c.get('price_source_mismatch'): continue  # card_ops doctor: price data is for a different card/print
        try:
            g=lambda k,*a:next((c[x] for x in (k,)+a if c.get(x) is not None),None)
            lr=c.get('lr') or {};lg=c.get('lg') or {}
            raw=g('raw','price');buy=None
            if raw: buy=round(raw*0.85,2)  # buy-zone: <=85% of sold-based raw
            out.append(dict(name=(g('title','name','q') or '?').replace(' Prices',''),url=g('url'),raw=raw,p9=g('p9','psa9'),p10=g('p10','psa10'),
              t3=g('t3'),t6=g('t6'),t12=g('t12'),t12g=g('t12g'),score=g('score') or 0,conf=g('conf'),
              lr=lr if lr.get('url') and lr.get('verified', True) else None,lg=lg if lg.get('url') and lg.get('verified', True) else None,buy=buy,
              deal=bool(lr.get('price') and lr.get('vetted',True) and buy and raw*0.5<=lr['price']<=buy),hist=ch.get(g('url'),{}),
              rl=bool(c.get('reserved') or c.get('reserved_list')),
              vetted=c.get('vetted'),fake_risk=c.get('fake_risk'),condition=c.get('condition'),seller_score=c.get('seller_score'),cad_total=c.get('cad_total'),cert_ok=c.get('cert_ok'),
              exp_profit_cad=c.get('exp_profit_cad') or c.get('ev_net'),ret_pct=c.get('ret_pct'),cost_cad=c.get('cost_cad') or c.get('cad_total'),entry_cad=c.get('entry_cad') or c.get('cad_total'),offers=c.get('offers') or [],offers_graded=c.get('offers_graded') or [],no_verified_listing=c.get('no_verified_listing'),verified_at=c.get('verified_at'),
              **{k:c.get(k) for k in ('exp_return_pct','lt_score','outlook','flags','vol','t24','grade10_rate','psa10_odds','reserved_list','reserved','ev_net') if c.get(k) is not None}))
        except Exception: pass
    # Keep one row per (name, url) so gate cannot fail on tracker duplicates
    _seen={}; _ded=[]
    for c in out:
        k=(c.get('name'), c.get('url'))
        if k in _seen: continue
        _seen[k]=1; _ded.append(c)
    out=_ded
    out.sort(key=lambda x:-(x['score'] or 0))
    tiers=[100,500,2000]
    try:
        meta=json.load(open(os.path.join(d,'meta.json')))
        if meta.get('budget_tiers'):
            # meta has picks; just keep numeric tier caps for UI
            pass
    except Exception: pass
    return dict(cards=out,sample=sample,updated=mt(d),budget_tiers=tiers)
def mt(d):
    ts=[os.path.getmtime(os.path.join(d,f)) for f in os.listdir(d)] if os.path.isdir(d) else []
    return datetime.datetime.fromtimestamp(max(ts)).strftime('%b %d %Y %H:%M ET') if ts else 'not yet run'
def coll():
    p=os.path.join(_root(),'ygo_cards','my_collection.csv')
    try: return [{k:v for k,v in r.items() if k in ('name','set_code','rarity','edition','condition','graded')} for r in csv.DictReader(open(p))]
    except Exception: return []
SAMPLE={'ygo_cards':[],'mtg_cards':[
 {'title':'SAMPLE – Mox Pearl (Unlimited)','raw':0,'score':0,'reserved':1},
 {'title':'SAMPLE – Tracker not run yet','raw':0,'score':0}]}
def main():
    D=dict(ygo=load('ygo_cards'),mtg=load('mtg_cards'),coll=coll(),built=time.strftime('%b %d %Y %H:%M ET'),budget_tiers=[100,500,2000])
    alerts=[]
    for k,lab in (('ygo','YGO'),('mtg','MTG')):
        for c in D[k]['cards']:
            if c['deal']: alerts.append(dict(t='Below buy zone',g=lab,name=c['name'],msg=f"Live raw ${c['lr']['price']:.2f} ≤ buy zone ${c['buy']:.2f}. Check it's the same print/condition.",u=c['lr']['url']))
            if (c['t3'] or 0)>=25: alerts.append(dict(t='Spike – sell signal',g=lab,name=c['name'],msg=f"Raw +{c['t3']:.0f}% in 3 mo; spikes often fade.",u=c['url']))
            if (c['t3'] or 0)<=-25: alerts.append(dict(t='Dip – watch',g=lab,name=c['name'],msg=f"Raw {c['t3']:.0f}% in 3 mo.",u=c['url']))
    try:  # card_ops: alert cooldown/dedupe (additive; falls back to raw alerts)
        sys.path.insert(0,os.environ.get('CARD_OPS',os.path.join(os.environ.get('CARD_ROOT','/workspace'),'card_ops'))); import alerts as _A; alerts=_A.apply(alerts)
    except Exception: pass
    D['alerts']=alerts
    try:
        _root=os.environ.get('CARD_ROOT','/workspace'); _ops=os.environ.get('CARD_OPS',os.path.join(_root,'card_ops'))
        sys.path.insert(0,_ops)
        from freshness import health_fields
        _status=json.load(open(os.path.join(_ops,'status.json')))
        D['health']=health_fields(_status, _status.get('problems'))
        D['health']['level']=_status.get('level') or D['health']['level']
    except Exception: D['health']={'level':'warn','freshness':'unknown','problems':['status unavailable'],'freshness_note':'Price freshness has not been verified.'}
    os.makedirs(S,exist_ok=True)
    try:  # shared category lists (card_common/categories.py), rank movement, lazy per-card history
        import hashlib; sys.path.insert(0,os.path.join(os.environ.get('CARD_ROOT','/workspace'),'card_common')); import categories as _C
        pf=os.path.join(B,'prev_ranks.json'); prev=json.load(open(pf)) if os.path.exists(pf) else {}; now={}
        for g in ('ygo','mtg'):
            cs=D[g]['cards']; L=_C.rank_all(cs)
            for c in cs:
                c['id']=hashlib.md5(((c.get('url') or '')+'|'+c['name']).encode()).hexdigest()[:12]
                h=c.pop('hist',None) or {}
                raw=h.get('raw') or []; c['spark']=[round(p[1],2) for p in raw[-36:]]
                c['h0']=min([s[0][0] for s in h.values() if s] or [0]) or None
                if h:
                    os.makedirs(os.path.join(S,'h',g),exist_ok=True); json.dump(h,open(os.path.join(S,'h',g,c['id']+'.json'),'w'),separators=(',',':'))
            for k,lst in L.items():
                for x in lst:
                    key=f"{g}|{k}|{cs[x['i']]['id']}"; now[key]=x['rank']; p=prev.get(key)
                    x['mv']='new' if p is None else (p-x['rank'])
            D[g]['lists']=L
            # cards[0] = Top #1 so gate/top checks see the real #1
            if L['top']:
                j=L['top'][0]['i']
                if j: cs.insert(0,cs.pop(j)); [x.__setitem__('i',0 if x['i']==j else x['i']+1 if x['i']<j else x['i']) for k in L for x in L[k]]
        if now!=prev: json.dump(now,open(pf,'w'))
        D['ranked_at']=int(time.time())
    except Exception as _x: print('categories failed:',_x)
    open(os.path.join(S,'data.js'),'w').write('window.D='+json.dumps(D,separators=(',',':'))+';')
    v=str(int(time.time()))
    open(os.path.join(S,'index.html'),'w').write(open(os.path.join(B,'index.tpl.html')).read().replace('__V__',v))
    open(os.path.join(S,'sw.js'),'w').write(SW.replace('__V__',v).replace('__FILES__', json.dumps(precache_files(), separators=(',',':'))))
    json.dump(dict(name='Card Deals',short_name='Card Deals',start_url='./',display='standalone',background_color='#0b0f1a',theme_color='#0b0f1a',
      icons=[dict(src='icon-192.png',sizes='192x192',type='image/png'),dict(src='icon-512.png',sizes='512x512',type='image/png',purpose='any maskable')]),open(os.path.join(S,'manifest.json'),'w'))
    open(os.path.join(S,'.nojekyll'),'w').close()
    json.dump({'v':v},open(os.path.join(S,'version.json'),'w'))
    # Keep Scan installed after rebuild (INTEGRATION.md). Idempotent; does not invent grades.
    try:
        import subprocess as _sp
        _sp.check_call(['python3','scan/tools/integrate.py'],cwd=S)
        # Real sold/ask shards from tracker DBs + verified eBay (never invent).
        try:
            _sp.check_call(['python3',os.path.join(B,'build_market_input.py')])
        except Exception as _mx:
            print('build_market_input:',_mx)
        _em=os.path.join(S,'scan','tools','export_market.py')
        if os.path.exists(_em):
            _sp.call(['python3',_em],cwd=S)
        # Optional: merge sourced PSA grades only when tracker files exist (never invent).
        _ex=os.path.join(S,'scan','tools','export_verified_prices.py')
        if os.path.exists(_ex):
            _sp.call(['python3',_ex],cwd=S)  # no-op when no verified-grades.json inputs
        if _sp.call(['python3','scan/tools/integrate.py','--check'],cwd=S)!=0:
            raise SystemExit('scan integrate --check failed')
        # Keep published site slim (Pages deploy was timing out with test/bench trees)
        import shutil as _sh
        for _rel in ('scan/bench','package.json','package-lock.json','node_modules','.pages-rebuild'):
            _p=os.path.join(S,_rel)
            if os.path.isdir(_p): _sh.rmtree(_p,True)
            elif os.path.isfile(_p):
                try: os.remove(_p)
                except OSError: pass
    except FileNotFoundError:
        print('scan/ missing: Scan not integrated this build')

def precache_files():
    """Every scan module the offline screen imports, plus the app shell.
    Vendor OCR and market shards stay out: they are large and loaded on demand.
    A staged copy of this file may not sit next to scan/; the shell still builds."""
    shell=['./','index.html','data.js','chart.min.js','manifest.json','icon-192.png']
    candidates=[
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(B))),'scan'),
        os.path.join(B,'scan'),
        os.path.join(S,'scan'),
    ]
    scan=next((p for p in candidates if os.path.isfile(os.path.join(p,'boot.js'))), None)
    if not scan: return shell
    names=sorted(n for n in os.listdir(scan) if n.endswith(('.js','.css','.json')))
    return shell+[f'scan/{n}' for n in names]

SW=r"""const C='cd3-__V__',F=__FILES__;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(F.map(u=>new Request(u,{cache:'reload'})))))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!='GET')return;const u=new URL(r.url);if(u.origin!=location.origin)return;
 const fresh=r.mode=='navigate'||/\.(html|json|js)$|\/$/.test(u.pathname)&&!/chart\.min\.js$/.test(u.pathname);
 e.respondWith(fetch(r,fresh?{cache:'no-store'}:{}).then(x=>{if(x.ok){const cl=x.clone();caches.open(C).then(c=>c.put(r,cl))}return x}).catch(()=>caches.match(r,{ignoreSearch:true})))});"""
if __name__=='__main__': main()
