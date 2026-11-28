#!/usr/bin/env python3
"""Pull a capped, reproducible card sample from free official APIs.

Images are written under scripts/fixtures/cache/ and are not committed.
The manifest records the source URL, card id, set, number, and terms note.

Sports and One Piece are skipped: there is no free official image API.
TCGplayer, PriceCharting, 130point, Card Ladder, and SportsCardsPro are not used.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'manifest.json'
CACHE = HERE / 'cache' / 'official'
USER_AGENT = 'CardDealsFixtureFetcher/1.0'
TARGET = 150
SCRYFALL_GAP = 0.11
OTHER_GAP = 0.08

TERMS = {
    'mtg': (
        'Scryfall API (api.scryfall.com), under the Wizards of the Coast Fan Content Policy. '
        'Requests send a User-Agent and wait at least 110 ms. Card images are Wizards copyright. '
        'Scryfall asks callers not to blur, skew, crop, or republish those images. '
        'Files stay in the gitignored cache and are not shown in the app.'
    ),
    'yugioh': (
        'YGOPRODeck API v7 (db.ygoprodeck.com). Rate limit is 20 requests per second; this script stays under that. '
        'Their terms say to download each image once and cache it, not to hotlink. '
        'Card images on that API are English-only even when the text language differs, and they are Konami copyright. '
        'Files stay in the gitignored cache.'
    ),
    'pokemon': (
        'Pokémon TCG API v2 (api.pokemontcg.io). Images are served by images.pokemontcg.io and are '
        'The Pokémon Company copyright. This script requests English catalog rows. '
        'Files stay in the gitignored cache.'
    ),
}

SKIPPED = [
    {
        'id': 'sports-standard',
        'reason': (
            'No free official image API. The sports profile has no free catalog, and a licence is still pending. '
            'TCGplayer, PriceCharting, 130point, Card Ladder, and SportsCardsPro were not used.'
        ),
    },
    {
        'id': 'onepiece',
        'reason': (
            'No free official Bandai image API. optcgapi is a third-party community catalog, so it was not used.'
        ),
    },
]


def stride_pick(rows, count, key='card_id'):
    """Evenly spaced ids after a stable sort. The same list always yields the same pick."""
    rows = sorted(rows, key=lambda row: (str(row.get(key, '')), str(row.get('set', '')), str(row.get('number', ''))))
    if count <= 0 or not rows:
        return []
    if count >= len(rows):
        return rows
    chosen = []
    used = set()
    step = len(rows) / count
    for i in range(count):
        idx = min(len(rows) - 1, int(i * step))
        while idx in used and idx + 1 < len(rows):
            idx += 1
        if idx in used:
            break
        used.add(idx)
        chosen.append(rows[idx])
    return chosen


def assign_strata(pools, plan):
    """plan is a list of (stratum, count). pools[stratum] is a list of card dicts."""
    used = set()
    chosen = []
    notes = []
    for name, count in plan:
        fresh = [row for row in pools.get(name, []) if row['card_id'] not in used]
        got = stride_pick(fresh, count)
        if len(got) < count:
            notes.append({'stratum': name, 'wanted': count, 'got': len(got)})
        for row in got:
            row['stratum'] = name
            used.add(row['card_id'])
            chosen.append(row)
    return chosen, notes


class Client:
    def __init__(self):
        self.last = {}

    def get(self, url, gap, accept='application/json'):
        host = urllib.parse.urlparse(url).netloc
        wait = gap - (time.monotonic() - self.last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        last = None
        for attempt in range(3):
            result = subprocess.run(
                [
                    'curl', '-sS', '--max-time', '20', '-A', USER_AGENT, '-H', f'Accept: {accept}',
                    '-w', '\n%{http_code}', url,
                ],
                check=False,
                capture_output=True,
            )
            self.last[host] = time.monotonic()
            if result.returncode != 0:
                last = result.stderr.decode('utf-8', 'replace')[-200:]
                time.sleep(1.2 * (attempt + 1))
                continue
            raw = result.stdout
            payload, _sep, code = raw.rpartition(b'\n')
            try:
                status = int(code.strip())
            except ValueError:
                status = 0
                payload = raw
            if status in (429, 500, 502, 503, 504) and attempt < 2:
                last = f'HTTP {status}'
                time.sleep(1.2 * (attempt + 1))
                continue
            if status and status >= 400:
                raise RuntimeError(f'HTTP {status} {url}')
            return status or 200, {}, payload
        raise RuntimeError(last or f'failed {url}')

    def get_json(self, url, gap):
        status, _headers, body = self.get(url, gap)
        if status != 200:
            raise RuntimeError(f'{status} {url}')
        return json.loads(body.decode('utf-8'))


def scryfall_image(card):
    uris = card.get('image_uris')
    if not uris and card.get('card_faces'):
        uris = card['card_faces'][0].get('image_uris') or {}
    if not uris:
        return None
    return uris.get('normal') or uris.get('large')


def scryfall_row(card, stratum):
    if card.get('oversized'):
        return None
    image = scryfall_image(card)
    if not image:
        return None
    return {
        'game': 'mtg',
        'card_id': card['id'],
        'set': card.get('set') or '',
        'number': str(card.get('collector_number') or ''),
        'name': card.get('name') or '',
        'language': card.get('lang') or '',
        'rarity': card.get('rarity') or '',
        'frame': card.get('frame') or '',
        'foil': 'foil' in (card.get('finishes') or []),
        'released': card.get('released_at') or '',
        'source_url': card.get('uri') or '',
        'image_url': image,
        'size_class': 'standard-tcg',
        'licence_note': TERMS['mtg'],
        'stratum': stratum,
    }


def ygo_row(card, stratum, language):
    images = card.get('card_images') or []
    if not images or not images[0].get('image_url'):
        return None
    sets = card.get('card_sets') or []
    first = sets[0] if sets else {}
    released = ''
    misc = card.get('misc_info') or []
    if misc and isinstance(misc[0], dict):
        released = misc[0].get('tcg_date') or misc[0].get('ocg_date') or ''
    return {
        'game': 'yugioh',
        'card_id': str(card.get('id')),
        'set': first.get('set_code') or first.get('set_name') or '',
        'number': first.get('set_code') or '',
        'name': card.get('name') or '',
        'language': language,
        'image_language': 'en',
        'rarity': first.get('set_rarity') or '',
        'frame': card.get('frameType') or card.get('type') or '',
        'foil': False,
        'released': released,
        'pre_2008': released[:4].isdigit() and int(released[:4]) < 2008,
        'source_url': f'https://db.ygoprodeck.com/api/v7/cardinfo.php?id={card.get("id")}',
        'image_url': images[0]['image_url'],
        'size_class': 'yugioh',
        'licence_note': TERMS['yugioh'],
        'stratum': stratum,
    }


def pokemon_row(card, stratum):
    images = card.get('images') or {}
    image = images.get('large') or images.get('small')
    if not image:
        return None
    card_set = card.get('set') or {}
    return {
        'game': 'pokemon',
        'card_id': card.get('id') or '',
        'set': card_set.get('id') or '',
        'number': str(card.get('number') or ''),
        'name': card.get('name') or '',
        'language': 'en',
        'rarity': card.get('rarity') or '',
        'frame': card_set.get('series') or '',
        'foil': 'holo' in (card.get('rarity') or '').lower(),
        'released': card_set.get('releaseDate') or '',
        'supertype': card.get('supertype') or '',
        'source_url': f'https://api.pokemontcg.io/v2/cards/{card.get("id")}',
        'image_url': image,
        'size_class': 'standard-tcg',
        'licence_note': TERMS['pokemon'],
        'stratum': stratum,
    }


MTG_PLAN = [
    ('frame-1993', 18),
    ('frame-2003', 18),
    ('frame-2015', 22),
    ('borderless', 14),
    ('future', 8),
    ('foil', 16),
    ('ja', 16),
    ('de', 12),
    ('fr', 8),
    ('mythic', 10),
    ('common-1996', 8),
]

YGO_PLAN = [
    ('pre-2008', 30),
    ('normal', 15),
    ('effect', 20),
    ('fusion', 12),
    ('synchro', 10),
    ('xyz', 10),
    ('link', 10),
    ('spell', 12),
    ('trap', 10),
    ('de', 8),
    ('fr', 7),
    ('it', 6),
]

PKM_PLAN = [
    ('base', 12),
    ('neo', 10),
    ('ex', 12),
    ('dp', 12),
    ('bw', 12),
    ('xy', 10),
    ('sm', 15),
    ('swsh', 15),
    ('sv', 18),
    ('holo', 16),
    ('trainer', 18),
]


def scryfall_search(client, query):
    url = 'https://api.scryfall.com/cards/search?' + urllib.parse.urlencode({
        'q': query,
        'order': 'name',
        'unique': 'cards',
    })
    rows = []
    pages = 0
    while url and pages < 2:
        payload = client.get_json(url, SCRYFALL_GAP)
        for card in payload.get('data') or []:
            row = scryfall_row(card, '')
            if row:
                rows.append(row)
        url = payload.get('next_page') if payload.get('has_more') else None
        pages += 1
    return rows


def ygo_search(client, params, language, stratum):
    params = dict(params)
    if language != 'en':
        params['language'] = language
    url = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?' + urllib.parse.urlencode(params)
    payload = client.get_json(url, OTHER_GAP)
    rows = []
    for card in payload.get('data') or []:
        row = ygo_row(card, stratum, language)
        if row:
            rows.append(row)
    return rows


def pokemon_search(client, query):
    rows = []
    page = 1
    while page <= 2:
        url = 'https://api.pokemontcg.io/v2/cards?' + urllib.parse.urlencode({
            'q': query,
            'pageSize': 100,
            'page': page,
            'orderBy': 'id',
        })
        payload = client.get_json(url, OTHER_GAP)
        data = payload.get('data') or []
        for card in data:
            row = pokemon_row(card, '')
            if row:
                rows.append(row)
        if len(data) < 100:
            break
        page += 1
    return rows


def select_cards(client, wanted=None):
    wanted = wanted or {'mtg', 'yugioh', 'pokemon'}
    mtg_queries = {
        'frame-1993': 'game:paper lang:en frame:1993 -is:oversized',
        'frame-2003': 'game:paper lang:en frame:2003 -is:oversized',
        'frame-2015': 'game:paper lang:en frame:2015 -is:oversized',
        'borderless': 'game:paper lang:en border:borderless -is:oversized',
        'future': 'game:paper lang:en frame:future -is:oversized',
        'foil': 'game:paper lang:en finishes:foil -is:oversized',
        'ja': 'game:paper lang:ja -is:oversized',
        'de': 'game:paper lang:de -is:oversized',
        'fr': 'game:paper lang:fr -is:oversized',
        'mythic': 'game:paper lang:en rarity:mythic -is:oversized',
        'common-1996': 'game:paper lang:en rarity:common year:1996 -is:oversized',
    }
    mtg_pools = {}
    mtg_errors = []
    if 'mtg' not in wanted:
        mtg_queries = {}
    for name, query in mtg_queries.items():
        try:
            mtg_pools[name] = scryfall_search(client, query)
        except (RuntimeError, json.JSONDecodeError, TimeoutError) as err:
            mtg_pools[name] = []
            mtg_errors.append({'stratum': name, 'error': str(err)})
    mtg, mtg_short = assign_strata(mtg_pools, MTG_PLAN)

    ygo_specs = [
        ('pre-2008', {'enddate': '2007-12-31', 'dateregion': 'tcg', 'num': 80, 'offset': 0}, 'en'),
        ('pre-2008', {'enddate': '2007-12-31', 'dateregion': 'tcg', 'num': 80, 'offset': 1200}, 'en'),
        ('normal', {'type': 'Normal Monster', 'num': 80, 'offset': 0}, 'en'),
        ('effect', {'type': 'Effect Monster', 'num': 80, 'offset': 0}, 'en'),
        ('fusion', {'type': 'Fusion Monster', 'num': 60, 'offset': 0}, 'en'),
        ('synchro', {'type': 'Synchro Monster', 'num': 60, 'offset': 0}, 'en'),
        ('xyz', {'type': 'XYZ Monster', 'num': 60, 'offset': 0}, 'en'),
        ('link', {'type': 'Link Monster', 'num': 60, 'offset': 0}, 'en'),
        ('spell', {'type': 'Spell Card', 'num': 60, 'offset': 0}, 'en'),
        ('trap', {'type': 'Trap Card', 'num': 60, 'offset': 0}, 'en'),
        ('de', {'num': 40, 'offset': 0}, 'de'),
        ('fr', {'num': 40, 'offset': 0}, 'fr'),
        ('it', {'num': 40, 'offset': 0}, 'it'),
    ]
    ygo_pools = {name: [] for name, _count in YGO_PLAN}
    ygo_errors = []
    if 'yugioh' not in wanted:
        ygo_specs = []
    for name, params, language in ygo_specs:
        try:
            ygo_pools[name].extend(ygo_search(client, params, language, name))
        except (RuntimeError, json.JSONDecodeError, TimeoutError) as err:
            ygo_errors.append({'stratum': name, 'error': str(err)})
    ygo, ygo_short = assign_strata(ygo_pools, YGO_PLAN)

    pkm_errors = []
    paged = []
    if 'pokemon' in wanted:
        # Search queries on this API often return 500. Evenly spaced catalog pages stay reproducible.
        for page in (8, 16, 24, 32, 40, 48, 56, 64, 72, 80):
            url = 'https://api.pokemontcg.io/v2/cards?' + urllib.parse.urlencode({'pageSize': 50, 'page': page})
            try:
                payload = client.get_json(url, OTHER_GAP)
            except (RuntimeError, json.JSONDecodeError, TimeoutError) as err:
                pkm_errors.append({'stratum': f'page-{page}', 'error': str(err)})
                continue
            for card in payload.get('data') or []:
                row = pokemon_row(card, '')
                if row:
                    paged.append(row)
        for query in ('name:Pikachu set.series:Scarlet', 'name:Charizard set.series:Scarlet'):
            url = 'https://api.pokemontcg.io/v2/cards?' + urllib.parse.urlencode({'pageSize': 20, 'page': 1, 'q': query})
            try:
                payload = client.get_json(url, OTHER_GAP)
            except (RuntimeError, json.JSONDecodeError, TimeoutError) as err:
                pkm_errors.append({'stratum': 'sv', 'error': str(err)})
                continue
            for card in payload.get('data') or []:
                row = pokemon_row(card, '')
                if row:
                    paged.append(row)
    def pkm_where(pred):
        return [row for row in paged if pred(row)]
    series = lambda row: (row.get('frame') or '').lower()
    pkm_pools = {
        'base': pkm_where(lambda row: series(row).startswith('base') or row['set'].startswith('base')),
        'neo': pkm_where(lambda row: 'neo' in series(row) or row['set'].startswith('neo')),
        'ex': pkm_where(lambda row: series(row) == 'ex' or row['set'].startswith('ex')),
        'dp': pkm_where(lambda row: 'diamond' in series(row) or 'pearl' in series(row) or row['set'].startswith('dp')),
        'bw': pkm_where(lambda row: 'black' in series(row) or row['set'].startswith('bw')),
        'xy': pkm_where(lambda row: series(row) == 'xy' or row['set'].startswith('xy')),
        'sm': pkm_where(lambda row: 'sun' in series(row) or row['set'].startswith('sm')),
        'swsh': pkm_where(lambda row: 'sword' in series(row) or row['set'].startswith('swsh')),
        'sv': pkm_where(lambda row: 'scarlet' in series(row) or row['set'].startswith('sv')),
        'holo': pkm_where(lambda row: row.get('foil')),
        'trainer': pkm_where(lambda row: (row.get('supertype') or '').lower() == 'trainer'),
    }
    pkm, pkm_short = assign_strata(pkm_pools, PKM_PLAN)
    used = {row['card_id'] for row in pkm}
    for row in stride_pick([row for row in paged if row['card_id'] not in used], max(0, TARGET - len(pkm))):
        row['stratum'] = 'catalog-page'
        pkm.append(row)

    groups = {}
    notes = {}
    if 'mtg' in wanted:
        groups['mtg'] = mtg
        notes['mtg'] = {'short': mtg_short, 'errors': mtg_errors}
    if 'yugioh' in wanted:
        groups['yugioh'] = ygo
        notes['yugioh'] = {'short': ygo_short, 'errors': ygo_errors}
    if 'pokemon' in wanted:
        groups['pokemon'] = pkm
        notes['pokemon'] = {'short': pkm_short, 'errors': pkm_errors}
    return groups, notes


def build_manifest(groups, notes):
    cards = []
    counts = {}
    for game, rows in groups.items():
        counts[game] = len(rows)
        cards.extend(rows)
    return {
        'seed': 856,
        'target_per_game': TARGET,
        'user_agent': USER_AGENT,
        'counts': counts,
        'selection': notes,
        'skipped': SKIPPED,
        'terms': TERMS,
        'cards': cards,
    }


def cache_path(card):
    suffix = Path(urllib.parse.urlparse(card['image_url']).path).suffix.lower() or '.img'
    if suffix not in {'.jpg', '.jpeg', '.png', '.webp'}:
        suffix = '.img'
    safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in card['card_id'])
    return CACHE / card['game'] / f'{safe}{suffix}'


def download_images(client, manifest):
    saved = 0
    failed = 0
    for card in manifest['cards']:
        dest = cache_path(card)
        if dest.exists() and dest.stat().st_size > 0:
            saved += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        gap = SCRYFALL_GAP if 'scryfall.io' in card['image_url'] or 'scryfall.com' in card['image_url'] else OTHER_GAP
        try:
            _status, _headers, body = client.get(card['image_url'], gap, accept='image/*')
        except (RuntimeError, TimeoutError):
            failed += 1
            continue
        if len(body) < 32:
            failed += 1
            continue
        dest.write_bytes(body)
        saved += 1
        if saved % 25 == 0:
            print(f'cached {saved}', flush=True)
    return saved, failed


def self_test():
    rows = [{'card_id': f'{i:03d}', 'set': 's', 'number': str(i)} for i in range(10)]
    first = stride_pick(rows, 4)
    second = stride_pick(list(reversed(rows)), 4)
    if [row['card_id'] for row in first] != [row['card_id'] for row in second]:
        raise SystemExit('stride_pick is not stable')
    if len(first) != 4:
        raise SystemExit('stride_pick count')
    pools = {
        'a': [{'card_id': '1', 'set': '', 'number': ''}, {'card_id': '2', 'set': '', 'number': ''}],
        'b': [{'card_id': '2', 'set': '', 'number': ''}, {'card_id': '3', 'set': '', 'number': ''}],
    }
    chosen, notes = assign_strata(pools, [('a', 2), ('b', 2)])
    ids = [row['card_id'] for row in chosen]
    if ids != ['1', '2', '3'] or not notes:
        raise SystemExit(f'assign_strata failed {ids} {notes}')
    manifest = build_manifest({'mtg': first}, {'mtg': {'short': [], 'errors': []}})
    if manifest['skipped'][0]['id'] != 'sports-standard':
        raise SystemExit('skipped list')
    if 'tcgplayer' in json.dumps(manifest).lower() and 'were not used' not in json.dumps(manifest).lower():
        raise SystemExit('forbidden source')
    print('fetch self-test ok')


def main(argv):
    if '--self-test' in argv:
        self_test()
        return 0
    client = Client()
    wanted = None
    if '--games' in argv:
        wanted = set(argv[argv.index('--games') + 1].split(','))
    if MANIFEST.exists() and '--select' not in argv and not wanted:
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    else:
        groups, notes = select_cards(client, wanted)
        if wanted and MANIFEST.exists():
            manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
            kept = [card for card in manifest['cards'] if card['game'] not in wanted]
            fresh = [card for rows in groups.values() for card in rows]
            manifest['cards'] = kept + fresh
            manifest['counts'] = {}
            for card in manifest['cards']:
                manifest['counts'][card['game']] = manifest['counts'].get(card['game'], 0) + 1
            manifest['selection'].update(notes)
        else:
            manifest = build_manifest(groups, notes)
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print('manifest', manifest['counts'], flush=True)
    if '--no-download' in argv:
        return 0
    saved, failed = download_images(client, manifest)
    print(f'downloaded_or_cached {saved} failed {failed}')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
