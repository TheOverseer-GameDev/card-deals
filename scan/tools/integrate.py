#!/usr/bin/env python3
"""Put the scan hook back after a generator rewrites index.html and sw.js.

card_app/build.py is not in this repo. Run this from the site root after it
writes those two files, or call apply() from the generator:

    python3 scan/tools/integrate.py
    python3 scan/tools/integrate.py --check
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOOK = (
    "<!-- card-scan:start -->\n"
    '<script type="module" src="scan/boot.js"></script>\n'
    "<!-- card-scan:end -->\n"
)
ASSETS = [
    "scan/boot.js",
    "scan/engine.js",
    "scan/lookup.js",
    "scan/image.js",
    "scan/prices.js",
    "scan/charts.js",
    "scan/gauges.js",
    "scan/scan.css",
    "scan/verified-prices.json",
]


FRESHNESS = (
    '<script id="card-freshness">'
    "(function(){var D=window.D;if(!D)return;var H=D.health||{};if(!H.freshness||H.freshness==='current')return;"
    "if(document.getElementById('freshness-note'))return;var b=document.createElement('div');b.className='banner';"
    "b.id='freshness-note';b.textContent=H.freshness_note||'Prices are not current. Stale and failed checks are not buys.';"
    "var m=document.querySelector('main');if(m)m.insertBefore(b,m.firstChild);})();"
    "</script>\n"
)
OLD_OFFER = "const offer=c=>[c.lr,c.lg].find(l=>l&&l.url&&l.verified===true&&l.vetted!==false);"
NEW_OFFER = (
    "function liveBuy(l){if(!l||!l.url||l.verified!==true||l.vetted===false||l.buyable===false)return false;"
    "if(l.listing_state&&l.listing_state!=='current')return false;if(!l.verified_at)return false;"
    "const h=(Date.now()-Date.parse(l.verified_at))/36e5;return h>=0&&h<=36}"
    "const offer=c=>[c.lr,c.lg].find(liveBuy);"
)
OLD_BTN = (
    "function btn(l,lab,cls){if(!l)return`<a class=\"btn g\">No live ${lab}</a>`;"
    "if(l.verified!==true||l.vetted===false)return`<a class=\"btn g mut\" href=\"${e(l.url)}\" target=_blank rel=noopener "
    "style=\"font-size:12px;font-weight:400\">${lab} (unverified)</a>`;"
)
NEW_BTN = "function btn(l,lab,cls){if(!liveBuy(l))return`<a class=\"btn g\">No live ${lab}</a>`;"
OLD_HEALTH_END = "el.onclick=()=>el.classList.toggle('open')})();"
NEW_HEALTH_END = (
    "el.onclick=()=>el.classList.toggle('open');"
    "if(H.freshness&&H.freshness!=='current'&&!document.getElementById('freshness-note')){"
    "const b=document.createElement('div');b.className='banner';b.id='freshness-note';"
    "b.textContent=H.freshness_note||'Prices are not current. Stale and failed checks are not buys.';"
    "const m=document.querySelector('main');if(m)m.prepend(b)}})();"
)


def _ensure_scan(text: str) -> str:
    if "scan/boot.js" in text:
        return text
    needle = "</body>"
    if needle in text:
        return text.replace(needle, HOOK + needle, 1)
    return text + "\n" + HOOK


def _ensure_buy_gate(text: str) -> str:
    if OLD_OFFER in text and "function liveBuy" not in text:
        text = text.replace(OLD_OFFER, NEW_OFFER, 1)
    if OLD_BTN in text:
        text = text.replace(OLD_BTN, NEW_BTN, 1)
    if OLD_HEALTH_END in text and "H.freshness&&H.freshness!=='current'" not in text:
        text = text.replace(OLD_HEALTH_END, NEW_HEALTH_END, 1)
    return text


def _ensure_freshness_script(text: str) -> str:
    if 'id="card-freshness"' in text:
        return text
    needle = "</body>"
    if needle in text:
        return text.replace(needle, FRESHNESS + needle, 1)
    return text + "\n" + FRESHNESS


def patch_index(text: str) -> str:
    return _ensure_freshness_script(_ensure_buy_gate(_ensure_scan(text)))


def patch_sw(text: str) -> str:
    match = re.search(r"F=\[(.*?)\]", text, re.S)
    if not match:
        raise SystemExit("sw.js precache list was not found")
    items = re.findall(r"'[^']*'|\"[^\"]*\"", match.group(1))
    have = {item[1:-1] for item in items}
    for asset in ASSETS:
        if asset not in have:
            items.append("'" + asset + "'")
    rebuilt = "F=[" + ",".join(items) + "]"
    text = text[: match.start()] + rebuilt + text[match.end() :]
    # .css was left on the HTTP cache. A scan.css change then survived a reload
    # because sw.js itself did not change, so the service worker never updated.
    return text.replace("\\.(html|json|js)$", "\\.(html|json|js|css)$")


def integrated(index: str, sw: str) -> bool:
    return (
        "scan/boot.js" in index
        and all(asset in sw for asset in ASSETS)
        and "\\.(html|json|js)$" not in sw
    )


def apply(root: Path = ROOT) -> None:
    index_path = root / "index.html"
    sw_path = root / "sw.js"
    index_path.write_text(patch_index(index_path.read_text()))
    sw_path.write_text(patch_sw(sw_path.read_text()))


def main(argv: list[str]) -> int:
    root = ROOT
    index = (root / "index.html").read_text()
    sw = (root / "sw.js").read_text()
    if "--check" in argv:
        return 0 if integrated(index, sw) else 1
    apply(root)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
