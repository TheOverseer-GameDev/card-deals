"""Shared category ranking for YGO + MTG trackers and the Card Deals app (zero-token, no LLM).

rank_all(cards, hist_by_url) -> {'top':[...], 'risky':[...], 'safe':[...]}
each item: {'i', 'rank', 'score', 'risk', 'risk_level', 'why'}; max 50, never padded.

PRIMARY signal = BUY-AND-HOLD expected return (projected 12–24m appreciation of the
same raw/graded item, net of buy/sell fees + shipping). Grade-and-flip is optional
upside only — negative grade EV must NOT exclude a good hold.

Only cards with a verified, vetted exact-match offer (lr / lg / offers[]) can rank.
Backward-compatible with trackers that expose ret_pct / exp_return_pct / hold_cad /
exp_profit_cad / grade_upside_cad.
"""
import math, re
MAX = 50

def num(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except Exception:
        return None

def offer(c):
    """Best verified buyable listing on the card (primary lr/lg or offers list)."""
    for k in ('lr', 'lg'):
        l = c.get(k) or {}
        if l.get('url') and l.get('verified') is True and l.get('vetted') is not False and l.get('buyable') is not False and l.get('listing_state') not in ('stale','ended','verification_unavailable') and num(l.get('cad_total') or l.get('price')):
            return l
    for o in (c.get('offers') or []):
        if o and o.get('url') and o.get('verified') is True and o.get('vetted') is not False and num(o.get('cad_total') or o.get('price')):
            return o
    return None

def sales_pm(v):
    s = str(v or '').lower()
    m = re.search(r'([\d.]+)\s*sales?\s*per\s*(day|week|month|year)', s)
    if not m:
        return None
    return float(m.group(1)) * {'day': 30, 'week': 4.3, 'month': 1, 'year': 1 / 12}[m.group(2)]

def series_stats(pts):
    v = [p[1] for p in (pts or []) if p[1] and p[1] > 0][-36:]
    if len(v) < 6:
        return None, None, len(v)
    r = [math.log(v[i] / v[i - 1]) for i in range(1, len(v))]
    mu = sum(r) / len(r)
    vol = math.sqrt(sum((x - mu) ** 2 for x in r) / len(r)) * 100
    pk = v[0]; dd = 0
    for x in v:
        pk = max(pk, x)
        dd = max(dd, (pk - x) / pk)
    return vol, dd * 100, len(v)

def hold_fields(c):
    """Resolve buy-and-hold return % and net CAD; grade upside is informational only."""
    # Prefer explicit hold metrics when present (new trackers)
    hold_cad = num(c.get('hold_cad'))
    hold_ret = num(c.get('hold_return_pct'))
    exp_ret = num(c.get('exp_return_pct'))
    ret = num(c.get('ret_pct'))
    profit = num(c.get('exp_profit_cad') if c.get('exp_profit_cad') is not None else c.get('ev_net'))
    # Hold return: hold_return_pct > exp_return_pct > ret_pct
    hret = hold_ret if hold_ret is not None else (exp_ret if exp_ret is not None else ret)
    # Hold profit CAD: hold_cad > profit (which YGO already sets from hold+partial upside)
    hprof = hold_cad if hold_cad is not None else profit
    grade_up = num(c.get('grade_upside_cad')) or 0
    return hret, hprof, grade_up

def feats(c, hist):
    f = {}
    hret, hprof, grade_up = hold_fields(c)
    f['ret'] = hret
    f['profit'] = hprof
    f['grade_up'] = grade_up
    f['lt'] = num(c.get('lt_score') if c.get('lt_score') is not None else c.get('outlook')) or 0
    f['t12'] = num(c.get('t12'))
    f['t24'] = num(c.get('t24'))
    f['t3'] = num(c.get('t3'))
    f['spm'] = sales_pm(c.get('vol'))
    fr = num(c.get('fake_risk'))
    f['fake'] = (fr * 100 if fr is not None and fr <= 1 else fr) or 0
    g = num(c.get('grade10_rate') if c.get('grade10_rate') is not None else c.get('psa10_odds'))
    f['g10'] = g
    fl = ' '.join(c.get('flags') or []).lower()
    m = re.search(r'reprinted (\d+)x', fl)
    f['reprints'] = int(m.group(1)) if m else (0 if c.get('reserved_list') or c.get('reserved') else None)
    f['rl'] = bool(c.get('reserved_list') or c.get('reserved'))
    f['vol'], f['dd'], f['months'] = series_stats((hist or {}).get('raw'))
    # risk 0-100 — grade odds are soft (hold does not require grading)
    r = 0
    r += min(30, (f['vol'] or 15) * 1.5)
    r += min(20, (f['dd'] or 30) / 3)
    r += min(20, f['fake'] / 2.5)
    r += 10 if f['spm'] is None else (10 if f['spm'] < 1 else 5 if f['spm'] < 4 else 0)
    r += 0 if f['rl'] else min(10, (f['reprints'] or 0) * 1.0)
    r += 4 if (g is not None and g < 0.1) else 0  # soft: grading hard ≠ bad hold
    f['risk'] = round(min(100, r))
    return f

def lvl(r):
    return 'Low' if r < 35 else 'Medium' if r < 55 else 'High'

def P(x):
    return f"{x:+.0f}%"

def rank_all(cards, hist_by_url=None):
    hist_by_url = hist_by_url or {}
    pool = []
    for i, c in enumerate(cards):
        if not offer(c):
            continue
        f = feats(c, c.get('hist') or hist_by_url.get(c.get('url')))
        pool.append((i, c, f))
    out = {'top': [], 'risky': [], 'safe': []}
    for i, c, f in pool:
        ret = max(-100, min(f['ret'] if f['ret'] is not None else 0, 400))
        conf = {'high': 1, 'medium': .85, 'low': .65}.get(str(c.get('conf')).lower(), .8)
        base = dict(i=i, risk=f['risk'], risk_level=lvl(f['risk']))
        # TOP: buy-and-hold expected return > 0 (grade EV may be negative — ignored as gate)
        hold_ok = (f['ret'] is not None and f['ret'] > 0) and (f['profit'] is None or f['profit'] > 0 or f['ret'] > 5)
        if hold_ok:
            s = (ret * (1 - f['risk'] / 160) + 0.4 * f['lt'] + 0.05 * max(0, f['grade_up'] / 100)) * conf
            why = f"Hold return {P(f['ret'])}"
            if f['profit'] is not None:
                why += f" (≈C${f['profit']:.0f} net of fees/ship)"
            why += f", LT {f['lt']:.0f}, {lvl(f['risk']).lower()} risk"
            if f['grade_up'] > 0:
                why += f"; grade upside optional ≈C${f['grade_up']:.0f}"
            out['top'].append(dict(base, score=round(s, 2), why=why))
        # RISKY: large hold upside with elevated risk
        if f['ret'] is not None and f['ret'] >= 35 and f['risk'] >= 45:
            s = ret * conf * (0.6 + 0.4 * min(1, (f['t12'] or 0) / 100 + 0.5))
            bits = [n for n, ok in (
                ('volatile', (f['vol'] or 0) >= 12),
                ('big past drop', (f['dd'] or 0) >= 40),
                ('fake risk', f['fake'] >= 30),
                ('thin sales', (f['spm'] or 0) < 1),
            ) if ok]
            out['risky'].append(dict(base, score=round(s, 2), why=f"Hold upside {P(f['ret'])} but {', '.join(bits) or 'higher risk'}"))
        # SAFE: steady hold trajectory (not grade-dependent)
        # vol/dd from hist when available; if hist missing, allow on steady t12/t24 alone (not padded)
        steady_hist = (f['vol'] is not None and f['vol'] <= 14 and (f['dd'] or 100) <= 40) or (
            f['vol'] is None and (f['t12'] or 0) > 0 and (f['t24'] is None or f['t24'] > 0) and (f['t3'] is None or abs(f['t3']) < 40))
        safe = (f['t12'] or -1) > 0 and (f['t24'] is None or f['t24'] > 0) and steady_hist \
            and ((f['spm'] or 0) >= 1.5 or f['spm'] is None or (f['months'] or 0) >= 18) \
            and f['fake'] < 50 and (f['rl'] or (f['reprints'] or 0) <= 8) \
            and (f['ret'] is None or f['ret'] > -15)
        if safe:
            yr = f['t24'] / 2 if f['t24'] is not None else f['t12']
            s = yr / (1 + (f['vol'] or 1)) * 10 + max(0, ret) * 0.15
            out['safe'].append(dict(base, score=round(s, 2), why=(
                f"Steady hold: {P(f['t12'])} 12 mo, max drop {(f['dd'] if f['dd'] is not None else 0):.0f}%, "
                f"{(str(round(f['spm'],1))+' sales/mo') if f['spm'] else str(f['months'])+' mo history'}"
                f"{', never reprinted' if f['rl'] else ''}"
            )))
    for k in out:
        seen = set(); L = []
        for x in sorted(out[k], key=lambda x: -x['score']):
            key = (cards[x['i']].get('title') or cards[x['i']].get('name'), cards[x['i']].get('url'))
            if key in seen:
                continue
            seen.add(key); L.append(x)
        out[k] = [dict(x, rank=n + 1) for n, x in enumerate(L[:MAX])]
    return out
