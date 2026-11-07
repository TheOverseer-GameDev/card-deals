"""Hide unverified offers without deleting the last recoverable observation.

Transport failures (401, 429, timeouts) are not ended listings. A later test
with zero remaining links is not a pass when the verify run had transport failures.
"""

TRANSPORT = {'401', '429', '503', 'timeout', 'transport', 'no_token'}


def classify(status=None, why=''):
    text = (why or '').lower()
    if status in (401, 429, 503) or text in TRANSPORT or 'getitem failed' in text or 'rate limit' in text:
        return 'transport'
    if status in (404, 410) or 'ended' in text or 'not available' in text:
        return 'ended'
    if 'mismatch' in text or 'rarity' in text or 'canada' in text or 'price changed' in text:
        return 'mismatch'
    if status == 200 or text == 'ok':
        return 'ok'
    return 'transport'


def apply_result(card, key, listing, kind, http_status=None, why=''):
    card = dict(card)
    if kind == 'ok' and listing:
        kept = dict(listing)
        kept['verified'] = True
        kept['buyable'] = True
        kept['listing_state'] = 'current'
        card[key] = kept
        card['buyable'] = True
        card['listing_state'] = 'current'
        return card
    saved = dict(listing or {})
    saved['buyable'] = False
    saved['verified'] = False
    saved['hidden_reason'] = why or kind
    saved['http_status'] = http_status
    retained = dict(card.get('retained_offers') or {})
    retained[key] = saved
    card['retained_offers'] = retained
    card[key] = None
    card['buyable'] = False
    card['no_verified_listing'] = True
    if kind == 'ended':
        card['listing_state'] = 'ended'
        card['ended'] = list(card.get('ended') or []) + [key]
    else:
        card['listing_state'] = 'verification_unavailable'
    return card


def recover(card, key):
    retained = (card or {}).get('retained_offers') or {}
    found = retained.get(key)
    if not found:
        return None
    return dict(found)


def finish_run(results, test_mode=False):
    transport = sum(1 for item in results if item.get('kind') == 'transport')
    buyable = sum(1 for item in results if item.get('kind') == 'ok')
    mismatches = sum(1 for item in results if item.get('kind') == 'mismatch')
    ended = sum(1 for item in results if item.get('kind') == 'ended')
    if transport:
        label = 'verification_unavailable'
        publish = False
        ok = False
        honest_empty = False
        exit_code = 2
    elif buyable == 0:
        label = 'honest_empty'
        publish = True
        ok = True
        honest_empty = True
        exit_code = 1 if test_mode and mismatches else 0
    else:
        label = 'verified'
        publish = True
        ok = True
        honest_empty = False
        exit_code = 1 if test_mode and mismatches else 0
    return {
        'verified_buyable': buyable,
        'transport_failures': transport,
        'ended': ended,
        'mismatches': mismatches,
        'label': label,
        'publish': publish,
        'ok': ok,
        'honest_empty': honest_empty,
        'vacuous_pass': False,
        'exit': exit_code,
    }
