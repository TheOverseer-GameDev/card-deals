"""Bounded discovery is a different job from listing refresh and from publish."""

DISCOVERY_S = 6 * 3600
REFRESH_S = 86400
PUBLISH_S = 3600
FLOOR_MB = 2048


def enough_ram(mem_kb, floor_mb=FLOOR_MB):
    try:
        return int(mem_kb) >= int(floor_mb) * 1024
    except (TypeError, ValueError):
        return False


def due(ages, ram_ok=True):
    ages = ages or {}
    if not ram_ok:
        return {'discovery': False, 'refresh': False, 'publish': False, 'reason': 'ram'}
    return {
        'discovery': ages.get('discovery', 1e12) > DISCOVERY_S,
        'refresh': ages.get('refresh', 1e12) > REFRESH_S,
        'publish': ages.get('publish', 1e12) > PUBLISH_S,
        'reason': None,
    }


def plan(rows, discover_budget, refresh_budget):
    pending = [row for row in rows if row.get('state') == 'pending']
    refresh = [row for row in rows if row.get('state') == 'acquired' and row.get('needs_refresh')]
    return {
        'discover': pending[: max(0, discover_budget)],
        'refresh': refresh[: max(0, refresh_budget)],
    }


def apply_outcome(row, outcome, now):
    if outcome == 'transport':
        row['state'] = 'pending'
        row['last_error'] = 'transport'
        return 'transport'
    if outcome in ('acquired', 'rejected'):
        row['state'] = outcome
        row['last_checked'] = now
        row.pop('last_error', None)
        return outcome
    raise ValueError('unknown outcome')


def counters(outcomes):
    acquired = outcomes.count('acquired')
    rejected = outcomes.count('rejected')
    transport = outcomes.count('transport')
    return {
        'acquired': acquired,
        'rejected': rejected,
        'transport': transport,
        'completed': acquired + rejected,
    }
