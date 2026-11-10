#!/usr/bin/env python3
"""Zero-token status line + app health badge source. Writes status.json and status.txt.

freshness, verified_at, and last_attempt_ok are an honest verification record:
both tracker stamp files must contain today's date, and top-20 verified buy
links must carry a recent verified_at. The stamp file's mtime is not that time.
A verify_run.json with transport failures is not current.
"""
import json,os,time,datetime
O=os.path.dirname(os.path.abspath(__file__))
def age(p):
    try: return (time.time()-os.path.getmtime(p))/3600
    except Exception: return None
def _read_stamp(p):
    """Stamp file text (YYYY-MM-DD). The file mtime is not a verification time."""
    try: t=open(p).read().strip()
    except Exception: return None
    return t if len(t)==10 and t[4]=='-' and t[7]=='-' else None
def _verified_times(p):
    try: cards=json.load(open(p))
    except Exception: return []
    if isinstance(cards,dict): cards=cards.get('cards') or cards.get('picks') or []
    if not isinstance(cards,list): return []
    out=[]
    for c in cards[:20]:
        if not isinstance(c,dict): continue
        hits=[]
        for k in ('lr','lg'):
            o=c.get(k) or {}
            if not isinstance(o,dict) or not o.get('url') or o.get('verified') is not True: continue
            if o.get('listing_state') not in (None,'','current'): hits.append(''); continue
            hits.append(o.get('verified_at') or '')
        if hits: out.extend(hits)
        elif c.get('verified_at'): out.append(c.get('verified_at'))
    return out
def _transport_stopped(root):
    """ygo verify records this when it logs verification_unavailable transport=N."""
    try: r=json.load(open(os.path.join(root,'ygo_cards','verify_run.json')))
    except Exception: return False
    if not isinstance(r,dict): return False
    return bool(r.get('transport_failures')) or r.get('ok') is False or r.get('label')=='verification_unavailable'
def _freshness(root):
    import sys
    if O not in sys.path: sys.path.insert(0,O)
    from freshness import assess_catalog
    games={}
    for k,d in (('ygo','ygo_cards'),('mtg','mtg_cards')):
        base=os.path.join(root,d)
        games[k]=dict(stamp=_read_stamp(os.path.join(base,'.stamp')),verified_at=_verified_times(os.path.join(base,'latest.json')))
    return assess_catalog(games,transport_stopped=_transport_stopped(root),today=datetime.date.today().isoformat(),now=time.time())
def last(mode):
    try:
        for l in reversed(open(O+'/doctor_runs.jsonl').read().splitlines()):
            r=json.loads(l)
            if r['mode']==mode: return r
    except Exception: pass
def main():
    root=os.environ.get('CARD_ROOT','/workspace')
    s=dict(ts=datetime.datetime.now().astimezone().isoformat(timespec='seconds'),stop=os.path.exists(os.path.join(root,'card_STOP')),
           mem_free_gb=round(int(open('/proc/meminfo').read().split('MemAvailable:')[1].split()[0])/1048576,1))
    prob=[]
    for k,d in (('ygo',os.path.join(root,'ygo_cards')),('mtg',os.path.join(root,'mtg_cards'))):
        a=age(d+'/.stamp'); s[k+'_tracker_age_h']=round(a,1) if a is not None else None
        if a is None or a>30: prob.append(f'{k} tracker last finished {"never" if a is None else f"{a:.0f}h ago"}')
        if os.path.exists(O+f'/hb/{k}.capped'): prob.append(f'{k} tracker hit restart cap')
    for m in ('gate','live','fix','selftest'):
        r=last(m)
        if r: s[m]=dict(ts=r['ts'],ok=r.get('pass'),issues=len(r.get('issues',[])),counts=r.get('counts'))
        if r and not r.get('pass') and m!='live':
            err=(r.get('counts') or {}).get('error')
            prob.append(f'{m} failing'+(f': {err}' if err else ''))
    lv=last('live')
    if lv and not lv.get('pass'): prob.append(f"live site: {len(lv.get('issues',[]))} issue(s)")
    if s['stop']: prob.insert(0,'STOP switch on: updates paused')
    # oldest verified_at among published top-20 buy links = "last checked"
    vs=[]
    for f in (os.path.join(root,'ygo_cards/latest.json'), os.path.join(root,'mtg_cards/latest.json')):
        try:
            for c in json.load(open(f))[:20]:
                v=(c.get('lr') or {}).get('verified_at')
                if v: vs.append(v)
        except Exception: pass
    s['links_checked_oldest_top20']=min(vs) if vs else None
    s['level']='ok' if not prob else ('stop' if s['stop'] else 'warn')
    s['problems']=prob
    s.update(_freshness(root))
    json.dump(s,open(O+'/status.json','w'),indent=1)
    open(O+'/status.txt','w').write(f"{s['ts']} level={s['level']} ygo_age={s.get('ygo_tracker_age_h')}h mtg_age={s.get('mtg_tracker_age_h')}h mem={s['mem_free_gb']}GB stop={s['stop']} | {'; '.join(prob) or 'all good'}\n")
    print(open(O+'/status.txt').read().strip())
if __name__=='__main__': main()
