#!/usr/bin/env python3
"""Merge already-verified grade JSON into scan/verified-prices.json.

This script does not scrape, call a model, or invent grades. It copies a
grade only when the input already has a positive price, currency, source,
and observation time. PSA 5-8 are not filled from raw, PSA 9, or PSA 10.

Looked up automatically when present:
  /workspace/ygo_cards/verified-grades.json
  /workspace/mtg_cards/verified-grades.json
  scan/verified-input.json

Extra files can be passed as arguments. With no readable input, the current
output file is left unchanged.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GRADES = ("ungraded", "psa5", "psa6", "psa7", "psa8", "psa9", "psa10")
OUTPUT = ROOT / "scan" / "verified-prices.json"
CANDIDATES = [
    Path("/workspace/ygo_cards/verified-grades.json"),
    Path("/workspace/mtg_cards/verified-grades.json"),
    ROOT / "scan" / "verified-input.json",
]


def load_doc(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def iter_grades(doc):
    prints = doc.get("prints") if isinstance(doc, dict) else None
    if isinstance(prints, list):
        for item in prints:
            if not isinstance(item, dict):
                continue
            key = f"{item.get('game')}:{item.get('id')}"
            yield key, item.get("grades")
    elif isinstance(prints, dict):
        for key, item in prints.items():
            grades = item.get("grades") if isinstance(item, dict) else None
            yield key, grades


def clean_grade(raw, now: datetime):
    if not isinstance(raw, dict):
        return None, "grade is not an object"
    price = raw.get("price")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not (price > 0) or price != price or price == float("inf"):
        return None, "price must be a positive number"
    currency = raw.get("currency")
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha() or currency != currency.upper():
        return None, "currency must be a 3-letter code"
    source = raw.get("source")
    if not isinstance(source, str) or not (2 <= len(source.strip()) <= 80):
        return None, "source is missing"
    observed = raw.get("observed_at", raw.get("observedAt"))
    if not isinstance(observed, str):
        return None, "observed_at is missing"
    try:
        when = datetime.fromisoformat(observed.replace("Z", "+00:00"))
    except ValueError:
        return None, "observed_at is missing"
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if (when - now).total_seconds() > 2 * 86400:
        return None, "observed_at is far in the future"
    url = raw.get("source_url", raw.get("sourceUrl")) or None
    if url is not None:
        if not isinstance(url, str) or not (url.startswith("https://") or url.startswith("http://")):
            return None, "source_url must be http or https"
    sales = raw.get("sales_count", raw.get("salesCount"))
    if sales is not None:
        if isinstance(sales, bool) or not isinstance(sales, int) or sales < 0:
            return None, "sales_count must be a non-negative integer"
    return {
        "price": price,
        "currency": currency,
        "source": source.strip(),
        "source_url": url,
        "observed_at": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sales_count": sales,
    }, None


def merge(docs, now=None):
    now = now or datetime.now(timezone.utc)
    prints = {}
    rejected = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        for key, grades in iter_grades(doc):
            if not isinstance(key, str) or ":" not in key or not key.split(":", 1)[0] in ("ygo", "mtg"):
                rejected.append({"print": str(key), "grade": "", "reason": "print key must be ygo:id or mtg:id"})
                continue
            game, ident = key.split(":", 1)
            if not ident or not ident.replace("_", "").replace("-", "").isalnum():
                rejected.append({"print": key, "grade": "", "reason": "print key must be ygo:id or mtg:id"})
                continue
            norm_key = f"{game}:{ident}"
            if not isinstance(grades, dict):
                continue
            bucket = prints.setdefault(norm_key, {"grades": {}})
            for grade, raw in grades.items():
                if grade not in GRADES:
                    rejected.append({"print": norm_key, "grade": str(grade), "reason": "unknown grade"})
                    continue
                if grade in bucket["grades"]:
                    rejected.append({"print": norm_key, "grade": grade, "reason": "duplicate grade"})
                    continue
                clean, reason = clean_grade(raw, now)
                if clean is None:
                    rejected.append({"print": norm_key, "grade": grade, "reason": reason})
                    continue
                bucket["grades"][grade] = clean
            if not bucket["grades"]:
                prints.pop(norm_key, None)
    return {
        "schema": 1,
        "generated_at": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "note": "Sourced grades only. Missing grades were omitted on purpose.",
        "prints": prints,
        "rejected": rejected,
    }


def default_inputs():
    return [path for path in CANDIDATES if path.is_file()]


def main(argv: list[str]) -> int:
    args = [arg for arg in argv if arg != "--write"]
    paths = [Path(arg) for arg in args] or default_inputs()
    docs = []
    used = []
    for path in paths:
        doc = load_doc(path)
        if doc is None:
            print(f"skipped unreadable {path}", file=sys.stderr)
            continue
        docs.append(doc)
        used.append(str(path))
    if not docs:
        print("no verified input found; left scan/verified-prices.json unchanged")
        return 0
    out = merge(docs)
    OUTPUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUTPUT} from {', '.join(used)}; kept {len(out['prints'])} prints; rejected {len(out['rejected'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
