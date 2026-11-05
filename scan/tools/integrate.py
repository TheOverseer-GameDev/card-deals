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
    "scan/scan.css",
    "scan/verified-prices.json",
]


def patch_index(text: str) -> str:
    if "scan/boot.js" in text:
        return text
    needle = "</body>"
    if needle in text:
        return text.replace(needle, HOOK + needle, 1)
    return text + "\n" + HOOK


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
    return text[: match.start()] + rebuilt + text[match.end() :]


def integrated(index: str, sw: str) -> bool:
    return "scan/boot.js" in index and all(asset in sw for asset in ASSETS)


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
