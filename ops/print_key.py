"""Exact-print identity. LAVD-ENO34 keeps the printed letter O.

Yugipedia and the Legendary Arc-V set list print Accesscode Talker as
LAVD-ENO34 (password 86066372, Konami database 15032). A blind O-to-0
rewrite invents LAVD-EN034. That guessed code is applied only in reverse,
and only when one of those ids is on the same record.
"""

AUTHORITATIVE = {
    '86066372': 'LAVD-ENO34',
    '15032': 'LAVD-ENO34',
}

RARITIES = (
    "collector's rare",
    'quarter century secret rare',
    'prismatic secret rare',
    'platinum secret rare',
    'starlight rare',
    'ultimate rare',
    'secret rare',
    'ultra rare',
    'super rare',
    'ghost rare',
)


def resolve(code, password=None, konami_id=None):
    raw = code or ''
    ident = str(password or konami_id or '')
    official = AUTHORITATIVE.get(ident)
    if raw == 'LAVD-EN034':
        if official == 'LAVD-ENO34':
            return {'code': 'LAVD-ENO34', 'corrected': True, 'quarantine': False}
        return {'code': raw, 'corrected': False, 'quarantine': True}
    return {'code': raw, 'corrected': False, 'quarantine': False}


def quarantine_reason(card_q, title):
    parts = (card_q or '').split('|')
    code = parts[1] if len(parts) > 1 else ''
    rarity = parts[2] if len(parts) > 2 else ''
    page = (title or '').lower()
    if code and code.lower() not in page:
        return 'set code differs from the price page'
    want = rarity.lower().strip()
    if not want:
        return None
    if want not in page:
        for label in RARITIES:
            if label != want and label in page:
                return f'rarity mismatch: page says {label}, card is {rarity}'
    return None
