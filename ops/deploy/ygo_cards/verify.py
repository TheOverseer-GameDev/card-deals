#!/usr/bin/env python3
"""Zero-token listing verifier. Re-checks every buy link in latest.json via eBay Browse getItem.
Drops any listing that is ended, mismatched (code/edition/rarity/language/grade) or price-changed.
`verify.py`        -> verify + rewrite latest.json (verified_at stamped)
`verify.py --test` -> re-sample all published links; exit 1 on any mismatch (publish gate)."""
import json,re,sys,time,datetime,urllib.parse,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import tracker as T
P=lambda f:os.path.join(os.path.dirname(os.path.abspath(__file__)),f)
def card_of(q):
    n,c,r,e=(q.split('|')+['','','',''])[:4]; return dict(name=n,code=c,rarity=r,ed=e)
def iid(url):
    m=re.search(r'/itm/(?:[^/]+/)?(\d{9,15})',url or ''); return m and m.group(1)
def check(card,l,graded,tok,d=None):
    if not l or not l.get('url'): return None,'no listing'
    i=iid(l['url'])
    if not i: return None,'not an item URL'
    if d is None:
      result=T.fetch_status('https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id='+i,{'Authorization':'Bearer '+tok,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US','X-EBAY-C-ENDUSERCTX':'contextualLocation=country%3DCA%2Czip%3DM5V2T6'},run_id=os.environ.get('CARD_RUN_ID','verify'))
      if result.get('action')!='ok': return None,'transport '+str(result.get('reason') or 'failed')
      try: d=json.loads(result['body'])
      except Exception as x: return None,'transport '+str(x)[:60]
    if d.get('errors'): return None,'ended/unavailable'
    av=(d.get('estimatedAvailabilities') or [{}])[0].get('estimatedAvailabilityStatus','IN_STOCK')
    if av not in ('IN_STOCK','LIMITED_STOCK'): return None,'not available: '+av
    if d.get('itemEndDate') and d['itemEndDate']<datetime.datetime.utcnow().isoformat(): return None,'ended'
    asp={x.get('name','').lower():str(x.get('value','')).lower() for x in d.get('localizedAspects') or []}
    ti=d.get('title','').lower(); blob=ti+' '+' '.join(asp.values())
    if card['code'].lower() not in blob: return None,'set code mismatch'
    other=[c for c in re.findall(r'\b[a-z0-9]{2,5}-(?:en|e)?\d{3}\b',ti) if c!=card['code'].lower()]
    if other: return None,'other set code in title: '+other[0]
    ed=asp.get('edition','')+' '+ti
    if card['ed']=='1st' and (not re.search(r'1st|first',ed) or re.search(r'unlimited|\bunl\b',ed)): return None,'edition mismatch'
    if card['ed']=='Unlimited' and re.search(r'1st|first',ed): return None,'edition mismatch'
    ra=asp.get('rarity','')
    if not T.rarity_ok(card,ra if T.rar_norm(ra) in T.RAR_ABBR else (ti if T.rar_norm(ti) in T.RAR_ABBR else '')): return None,f'rarity mismatch/unstated ({ra or "title"})'
    lang=asp.get('language','english')
    if 'english' not in lang: return None,'language: '+lang
    if re.search(T.FAKE,blob) or re.search(T.BADCOND,blob): return None,'fake/damaged keywords'
    if graded:
        g=asp.get('grade','')+' '+asp.get('professional grader','')+' '+ti
        if not re.search(r'psa',g) or not re.search(r'\b10\b',g): return None,'not a PSA 10 slab'
    elif re.search(r'\b(psa|bgs|cgc|sgc|beckett)\b',ti) or 'graded' in asp.get('graded','') : return None,'graded but raw expected'
    if not d.get('shippingOptions'): return None,'does not ship to Canada'
    pr=float(d['price']['value']); cur=d['price']['currency']
    # Accept small live drifts (seller edits / FX cents). Drop only real reprices.
    oldp=float(l['price']); band=max(1.0, 0.05*oldp)
    if abs(pr-oldp)>band: return None,f'price changed {l["price"]}->{pr}'
    ship=None
    try: ship=float(d['shippingOptions'][0]['shippingCost']['value'])
    except Exception: pass
    l2=dict(l,url='https://www.ebay.com/itm/'+i,price=pr,currency=cur,ship=ship if ship is not None else l.get('ship'),verified_at=datetime.datetime.now().astimezone().isoformat(timespec='seconds'),verified=True)
    return l2,'ok'
def main(test=False):
    sys.path.insert(0,T._ops_path())
    from verify_outcome import apply_result, classify, finish_run
    report_path=P('verify_run.json')
    if test and os.path.exists(report_path):
        prev=json.load(open(report_path))
        if prev.get('transport_failures'):
            print('test: previous verify had transport failures; not a pass')
            return 2
    tok=T.ebay_token(); data=json.load(open(P('latest.json'))); bad=[]; results=[]
    if not tok: print('no eBay token -> verification unavailable, offers retained')
    for c in data:
        card=card_of(c.get('q',''))
        for k,g in (('lr',False),('lg',True)):
            if not c.get(k): continue
            if tok: l,why=check(card,c[k],g,tok)
            else: l,why=None,'transport no_token'
            if os.environ.get('CARD_HTTP_FIXTURE'): time.sleep(0)
            else: time.sleep(.3)
            kind='ok' if l else classify(why=why)
            results.append({'kind':kind})
            if l:
                offs=[]
                for o in (c[k].get('offers') or [])[1:]:
                    o2,w2=check(card,o,g,tok)
                    if o2: offs.append(o2)
                    else: results.append({'kind':classify(why=w2)})
                l['offers']=[{x:y for x,y in l.items() if x!='offers'}]+offs; c[k]=l
            else:
                bad.append((c.get('title'),k,why,c[k].get('url')))
                if not test:
                    updated=apply_result(c,k,c[k],kind,why=why)
                    c.clear(); c.update(updated)
        if not test:
            c['vetted']=bool(c.get('lr') and c['lr'].get('vetted') and c['lr'].get('verified'))
            if not c['vetted'] and (c.get('score') or 0)>-100: c['score']=round((c.get('score') or 0)-200,1)
    finish=finish_run(results, test_mode=test)
    if not test:
        data.sort(key=lambda c:-(c.get('score') or 0))
        json.dump(data,open(P('latest.json'),'w'),indent=1,default=str)
        json.dump(finish,open(report_path,'w'),indent=1)
    elif finish.get('transport_failures'):
        json.dump(finish,open(report_path,'w'),indent=1)
    for b in bad: print(('FAIL ' if test else 'hidden ')+' | '.join(map(str,b)))
    print(f"{'test' if test else 'verify'}: {finish['label']} transport={finish['transport_failures']} ended={finish['ended']}")
    return finish['exit']
if __name__=='__main__': sys.exit(main('--test' in sys.argv))
