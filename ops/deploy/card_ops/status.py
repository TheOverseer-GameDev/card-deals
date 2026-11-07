#!/usr/bin/env python3
"""Zero-token status line + app health badge source. Writes status.json and status.txt."""
import json,os,time,datetime
O=os.path.dirname(os.path.abspath(__file__))
def age(p):
    try: return (time.time()-os.path.getmtime(p))/3600
    except Exception: return None
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
        if r and not r.get('pass') and m!='live': prob.append(f'{m} failing')
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
    json.dump(s,open(O+'/status.json','w'),indent=1)
    open(O+'/status.txt','w').write(f"{s['ts']} level={s['level']} ygo_age={s.get('ygo_tracker_age_h')}h mtg_age={s.get('mtg_tracker_age_h')}h mem={s['mem_free_gb']}GB stop={s['stop']} | {'; '.join(prob) or 'all good'}\n")
    print(open(O+'/status.txt').read().strip())
if __name__=='__main__': main()
