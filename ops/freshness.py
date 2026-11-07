"""Buyability and provenance. File mtime is not a verification time."""

STALE_H = 36


def _hours(now, stamp):
    try:
        return (float(now) - float(stamp)) / 3600
    except (TypeError, ValueError):
        return None


def listing_buyable(listing, now, stale_h=STALE_H):
    if not listing or not listing.get('url'):
        return False
    if listing.get('verified') is not True or listing.get('vetted') is False:
        return False
    if listing.get('buyable') is False:
        return False
    state = listing.get('listing_state')
    if state and state != 'current':
        return False
    stamp = listing.get('verified_at')
    if stamp in (None, ''):
        return False
    # ISO timestamps pass through as already-parsed epoch when the caller converted them.
    if isinstance(stamp, str):
        from datetime import datetime
        try:
            parsed = datetime.fromisoformat(stamp)
            stamp = parsed.timestamp()
        except ValueError:
            return False
    age = _hours(now, stamp)
    if age is None or age < 0 or age > stale_h:
        return False
    return True


def provenance_time(record):
    """Last completed successful verification. Never a file mtime."""
    if not record:
        return None
    if 'mtime' in record and 'verified_at' not in record:
        return None
    return record.get('verified_at')


def note_failure(record, when, reason):
    """Hide the offer, keep the last good copy, and do not mark the row fresh."""
    out = dict(record or {})
    offer = dict(out.get('lr') or {})
    if offer:
        offer['buyable'] = False
        offer['verified'] = False
        offer['hidden_reason'] = reason
        retained = dict(out.get('retained_offers') or {})
        retained['lr'] = offer
        out['retained_offers'] = retained
    out['lr'] = None
    out['buyable'] = False
    out['listing_state'] = 'verification_unavailable'
    out['freshness'] = 'verification_unavailable'
    out['last_attempt_at'] = when
    out['last_attempt_ok'] = False
    out.pop('mtime', None)
    return out


def health_fields(record, problems=None):
    freshness = (record or {}).get('freshness') or 'unknown'
    if freshness == 'current' and (record or {}).get('last_attempt_ok') is False:
        freshness = 'verification_unavailable'
    note = {
        'current': '',
        'verification_unavailable': 'Verification failed. Last good prices are hidden from buy buttons and were not deleted.',
        'stale': 'Prices are older than the verification window and are not buys.',
        'unknown': 'Price freshness has not been verified.',
    }.get(freshness, 'Prices are not current and are not buys.')
    level = 'ok' if freshness == 'current' and not problems else 'warn'
    return {
        'level': level,
        'freshness': freshness,
        'freshness_note': note,
        'verified_at': provenance_time(record),
        'problems': list(problems or []),
    }
