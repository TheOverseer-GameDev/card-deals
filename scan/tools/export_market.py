#!/usr/bin/env python3
"""Write per-print market shards from an offline tracker export.

This script does not scrape, call a model, or invent prices. A row is kept
only when it already has a positive price, a 3-letter currency, a source,
an observation time, and an exact print id. Sold rows and asking rows are
never copied into the other list.

Looked up automatically when present:
  /workspace/ygo_cards/market.json
  /workspace/mtg_cards/market.json
  scan/market-input.json

With no readable input, existing shard files are left unchanged.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scan" / "market"
INDEX = OUT_DIR / "index.json"
CANDIDATES = [
    Path("/workspace/ygo_cards/market.json"),
    Path("/workspace/mtg_cards/market.json"),
    ROOT / "scan" / "market-input.json",
]
FLAGS = {"shipping-unverified", "cad-stored"}


def load_doc(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def iter_prints(doc):
    prints = doc.get("prints") if isinstance(doc, dict) else None
    if isinstance(prints, list):
        for item in prints:
            if isinstance(item, dict):
                yield item
    elif isinstance(prints, dict):
        for key, item in prints.items():
            if isinstance(item, dict):
                merged = dict(item)
                merged.setdefault("print_id", key)
                yield merged


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc)


def stamp(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_listing(raw, expected_kind: str, now: datetime):
    if not isinstance(raw, dict):
        return None, "listing is not an object"
    kind = raw.get("kind")
    if kind is not None and kind != expected_kind:
        return None, "cross-label"
    price = raw.get("price")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not (price > 0) or price != price or price == float("inf"):
        return None, "price must be a positive number"
    currency = raw.get("currency")
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha() or currency != currency.upper():
        return None, "currency must be a 3-letter code"
    source = raw.get("source")
    if not isinstance(source, str) or not (2 <= len(source.strip()) <= 80):
        return None, "source is missing"
    when = parse_time(raw.get("observed_at", raw.get("observedAt")))
    if when is None:
        return None, "observed_at is missing"
    if (when - now).total_seconds() > 2 * 86400:
        return None, "observed_at is far in the future"
    url = raw.get("source_url", raw.get("sourceUrl")) or None
    if url is not None:
        if not isinstance(url, str) or not (url.startswith("https://") or url.startswith("http://")):
            return None, "source_url must be http or https"
    condition = raw.get("condition")
    if condition is not None:
        if not isinstance(condition, str) or not condition.strip():
            return None, "condition must be text"
        condition = condition.strip()
    return {
        "price": price,
        "currency": currency,
        "source": source.strip(),
        "source_url": url,
        "observed_at": stamp(when),
        "condition": condition,
        "kind": expected_kind,
    }, None


def print_key(item):
    key = item.get("print_id")
    if isinstance(key, str) and ":" in key:
        game, ident = key.split(":", 1)
    else:
        game = item.get("game")
        ident = item.get("id")
        key = f"{game}:{ident}" if isinstance(game, str) and isinstance(ident, str) else ""
    if not isinstance(game, str) or game not in ("ygo", "mtg"):
        return None
    if not isinstance(ident, str) or not ident or not ident.replace("_", "").replace("-", "").isalnum():
        return None
    return game, ident, f"{game}:{ident}"


def clean_scenarios(raw, rejected, key):
    kept = []
    if not isinstance(raw, list):
        return kept
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("tag"), str) or not item["tag"].strip():
            rejected.append({"print": key, "kind": "scenario", "reason": "scenario tag missing"})
            continue
        scenario = {"tag": item["tag"].strip(), "note": item.get("note").strip() if isinstance(item.get("note"), str) else ""}
        if item.get("lean") in ("up", "down", "mixed"):
            scenario["lean"] = item["lean"]
        weight = item.get("weight")
        if isinstance(weight, (int, float)) and not isinstance(weight, bool) and -1 <= weight <= 1:
            scenario["weight"] = weight
        kept.append(scenario)
    return kept


def build_market(docs, now=None):
    now = now or datetime.now(timezone.utc)
    prints = {}
    rejected = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        for item in iter_prints(doc):
            parsed = print_key(item)
            if parsed is None:
                rejected.append({"print": str(item.get("print_id") or item.get("id") or ""), "kind": "", "reason": "exact print id missing"})
                continue
            game, ident, key = parsed
            bucket = prints.setdefault(key, {
                "schema": 1,
                "game": game,
                "id": ident,
                "print_id": key,
                "released_at": None,
                "currency_note": "Prices are stored as supplied. Nothing was converted.",
                "sales": [],
                "asks": [],
                "scenarios": [],
                "flags": [],
            })
            released = parse_time(item.get("released_at"))
            if released is not None:
                bucket["released_at"] = stamp(released)
            for expected, field in (("sold", "sales"), ("ask", "asks")):
                rows = item.get(field)
                if not isinstance(rows, list):
                    continue
                for raw in rows:
                    clean, reason = clean_listing(raw, expected, now)
                    if clean is None:
                        rejected.append({"print": key, "kind": expected, "reason": reason})
                        continue
                    bucket[field].append(clean)
            bucket["scenarios"].extend(clean_scenarios(item.get("scenarios"), rejected, key))
            flags = item.get("flags")
            if isinstance(flags, list):
                for flag in flags:
                    if flag in FLAGS and flag not in bucket["flags"]:
                        bucket["flags"].append(flag)
    kept = {}
    for key, bucket in prints.items():
        if bucket["sales"] or bucket["asks"] or bucket["scenarios"]:
            kept[key] = bucket
        else:
            rejected.append({"print": key, "kind": "", "reason": "no usable rows"})
    return {"prints": kept, "rejected": rejected, "generated_at": stamp(now)}


def default_inputs():
    return [path for path in CANDIDATES if path.is_file()]


def write_output(built) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for key, bucket in built["prints"].items():
        game, ident = key.split(":", 1)
        dest_dir = OUT_DIR / game
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{ident}.json"
        dest.write_text(json.dumps(bucket, indent=2) + "\n")
        index.append(key)
    INDEX.write_text(json.dumps({
        "schema": 1,
        "generated_at": built["generated_at"],
        "note": "Shard index only. Prices live in scan/market/<game>/<id>.json and are not precached.",
        "prints": index,
        "rejected": built["rejected"],
    }, indent=2) + "\n")


def main(argv: list[str]) -> int:
    paths = [Path(arg) for arg in argv] or default_inputs()
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
        print("no market input found; left scan/market unchanged")
        return 0
    built = build_market(docs)
    write_output(built)
    print(f"wrote {len(built['prints'])} market shards from {', '.join(used)}; rejected {len(built['rejected'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
