#!/usr/bin/env python3
"""Build /workspace/{ygo,mtg}_cards/market.json from real tracker data only.

Sold comps: PriceCharting chart series in history.db (used=raw), positive cents only.
Asks: verified eBay listings from latest.json (lr / offers), CAD when cad_total present.
Never invents, converts, or fills gaps. Missing stays absent for export_market.py.
"""
from __future__ import annotations
import hashlib, json, os, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path

GAMES = (
    ("ygo", Path("/workspace/ygo_cards")),
    ("mtg", Path("/workspace/mtg_cards")),
)

def card_id(url: str, name: str) -> str:
    return hashlib.md5(((url or "") + "|" + (name or "")).encode()).hexdigest()[:12]

def stamp_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")

def stamp_iso(s: str | None) -> str | None:
    if not s or not isinstance(s, str):
        return None
    try:
        when = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def load_charts(db: Path) -> dict:
    out = {}
    if not db.is_file():
        return out
    try:
        c = sqlite3.connect(str(db))
        for key, url, chart, last in c.execute("select key,url,chart,last_checked from charts"):
            try:
                j = json.loads(chart)
            except Exception:
                continue
            out[url] = {"key": key, "chart": j, "last_checked": last}
            out[key] = out[url]
    except Exception:
        pass
    return out

def sold_from_chart(chart: dict) -> list:
    """PriceCharting 'used' series is raw/ungraded sold guide in USD cents."""
    series = (chart or {}).get("used") or []
    sales = []
    for pt in series:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        ms, cents = pt[0], pt[1]
        try:
            ms = int(ms); cents = float(cents)
        except (TypeError, ValueError):
            continue
        if not (ms > 0 and cents > 0):
            continue
        price = round(cents / 100.0, 2)
        if price <= 0:
            continue
        sales.append({
            "kind": "sold",
            "price": price,
            "currency": "USD",
            "source": "PriceCharting",
            "source_url": None,  # filled by caller when URL known
            "observed_at": stamp_ms(ms),
            "condition": "ungraded",
        })
    return sales

def ask_from_offer(o: dict, now_fallback: str) -> dict | None:
    if not isinstance(o, dict):
        return None
    if o.get("verified") is False:
        return None
    # require verification evidence
    if not (o.get("verified") or o.get("vetted") or o.get("verified_at")):
        return None
    url = o.get("url") or ""
    if not isinstance(url, str) or not url.startswith("https://"):
        return None
    # Prefer CAD total when present (labelled CAD, not converted)
    flags = []
    if o.get("cad_total") is not None:
        try:
            price = float(o["cad_total"])
        except (TypeError, ValueError):
            return None
        currency = "CAD"
        flags.append("cad-stored")
    else:
        try:
            price = float(o.get("price") or 0)
        except (TypeError, ValueError):
            return None
        cur = (o.get("currency") or "USD")
        if isinstance(cur, str) and len(cur) == 3 and cur.isalpha():
            currency = cur.upper()
        else:
            currency = "USD"
    if not (price > 0):
        return None
    observed = stamp_iso(o.get("verified_at")) or now_fallback
    site = (o.get("site") or o.get("site_id") or "eBay")
    if not isinstance(site, str) or len(site.strip()) < 2:
        site = "eBay"
    row = {
        "kind": "ask",
        "price": round(price, 2),
        "currency": currency,
        "source": site.strip()[:80],
        "source_url": url,
        "observed_at": observed,
        "condition": (o.get("condition") if isinstance(o.get("condition"), str) else None),
    }
    return row, flags

def build_game(game: str, root: Path) -> dict:
    latest_path = root / "latest.json"
    cards = []
    if latest_path.is_file():
        try:
            raw = json.load(open(latest_path))
            cards = raw if isinstance(raw, list) else (raw.get("cards") or raw.get("picks") or [])
        except Exception:
            cards = []
    charts = load_charts(root / "history.db")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    prints = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        name = (c.get("title") or c.get("name") or c.get("q") or "").replace(" Prices", "")
        url = c.get("url") or ""
        if not name:
            continue
        ident = card_id(url, name)
        sales = []
        ch = charts.get(url)
        if ch:
            sales = sold_from_chart(ch.get("chart") or {})
            for s in sales:
                s["source_url"] = url if url.startswith("http") else None
        # also try matching by tracker key/q
        if not sales and c.get("q") and c["q"] in charts:
            sales = sold_from_chart(charts[c["q"]].get("chart") or {})
            src = charts[c["q"]].get("url") or url
            for s in sales:
                s["source_url"] = src if isinstance(src, str) and src.startswith("http") else None
        asks = []
        flags = []
        for o in [c.get("lr"), c.get("lg")] + list(c.get("offers") or []) + list(c.get("offers_graded") or []):
            if not o:
                continue
            got = ask_from_offer(o, now)
            if not got:
                continue
            row, fl = got
            asks.append(row)
            for f in fl:
                if f not in flags:
                    flags.append(f)
        if not sales and not asks:
            continue
        item = {
            "game": game,
            "id": ident,
            "print_id": f"{game}:{ident}",
            "sales": sales,
            "asks": asks,
            "scenarios": [],
            "flags": flags,
        }
        prints.append(item)
    return {
        "schema": 1,
        "generated_at": now,
        "note": "Built from local tracker history.db (PriceCharting sold) and verified eBay asks only. No invented or converted prices.",
        "prints": prints,
    }

def main():
    for game, root in GAMES:
        doc = build_game(game, root)
        out = root / "market.json"
        out.write_text(json.dumps(doc, indent=1) + "\n")
        print(f"{game}: wrote {len(doc['prints'])} prints -> {out}")

if __name__ == "__main__":
    main()
