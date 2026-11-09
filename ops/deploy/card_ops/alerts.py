"""Alert cooldown/dedupe for the app's Alerts tab (zero tokens, no messages sent).
apply(alerts) -> same alerts with first_seen + new flag; a re-trigger of an alert that cleared
less than COOLDOWN_H ago is suppressed (stops flapping). State: alerts_state.json."""
import json,os,time
P=os.path.join(os.path.dirname(os.path.abspath(__file__)),'alerts_state.json'); COOLDOWN_H=12; NEW_H=24
def apply(alerts):
    try: S=json.load(open(P))
    except Exception: S={}
    now=time.time(); out=[]; live=set()
    for a in alerts:
        k=f"{a.get('t')}|{a.get('g')}|{a.get('name')}"; live.add(k); s=S.get(k)
        if s and s.get('cleared') and now-s['cleared']<COOLDOWN_H*3600: continue   # flapping: hold
        if not s or s.get('cleared'): s=S[k]={'first':now}
        s['seen']=now; out.append(dict(a,first_seen=time.strftime('%b %d %H:%M',time.localtime(s['first'])),new=now-s['first']<NEW_H*3600))
    for k,s in S.items():
        if k not in live and not s.get('cleared'): s['cleared']=now
    S={k:s for k,s in S.items() if now-s.get('seen',now)<30*86400}
    json.dump(S,open(P+'.tmp','w')); os.replace(P+'.tmp',P)
    out.sort(key=lambda a:not a['new']); return out
