"""One-shot health check. Keepalive calls this. It does not start its own loop
and it does not call eBay or a model.

Unknown incidents stay open. A later healthy pass does not erase them.
Restoring last-known-good only contains an incident.
"""
import json
import os

from discovery import enough_ram
from freshness import health_fields, listing_buyable, provenance_time
from print_key import quarantine_reason
from quota import Guard

ALLOW = {
    'reapply_integration',
    'restart_worker',
    'refresh_auth',
    'cooldown',
    'quarantine',
    'retry_publish',
    'restore_last_known_good',
}
CAP = {
    'restart_worker': 3,
    'retry_publish': 2,
    'refresh_auth': 1,
    'cooldown': 1,
    'quarantine': 3,
    'reapply_integration': 2,
    'restore_last_known_good': 1,
}
HEAVY = {'restart_worker', 'retry_publish'}
SCAN_ASSETS = (
    'scan/boot.js', 'scan/engine.js', 'scan/prices.js', 'scan/scan.css',
)


def _load(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save(path, state):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as handle:
        json.dump(state, handle, indent=1, sort_keys=True)
    os.replace(tmp, path)


def _lock(path):
    lock = path + '.lock'
    parent = os.path.dirname(lock)
    if parent:
        os.makedirs(parent, exist_ok=True)
    try:
        return os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY), lock
    except FileExistsError:
        return None, lock


def _unlock(fd, lock):
    if fd is None:
        return
    os.close(fd)
    try:
        os.remove(lock)
    except OSError:
        pass


def overall_level(incidents):
    level = 'OK'
    for inc in incidents.values():
        if inc.get('status') == 'OK' and not inc.get('unresolved'):
            continue
        if inc.get('contained') and inc.get('status') == 'DEGRADED' and not any(
            other.get('status') == 'FAIL' or (other.get('unresolved') and not other.get('contained'))
            for other in incidents.values()
        ):
            level = 'DEGRADED'
            continue
        if inc.get('status') == 'DEFERRED':
            level = 'DEGRADED' if level != 'FAIL' else level
            continue
        if inc.get('unresolved') or inc.get('status') == 'FAIL':
            return 'FAIL'
        if inc.get('status') == 'DEGRADED':
            level = 'DEGRADED'
    return level


def collect(snapshot, now):
    findings = []
    cleared = []

    def put(check_id, ok, **fields):
        if ok:
            cleared.append(check_id)
        else:
            findings.append({'id': check_id, **fields})

    index = snapshot.get('index_html') or ''
    sw = snapshot.get('sw_js') or ''
    put('scan_hook', 'scan/boot.js' in index, code='missing_scan_hook', repair='reapply_integration',
        severity='FAIL', detail='index is missing the scan hook')
    missing_sw = [asset for asset in SCAN_ASSETS if asset not in sw]
    put('sw_assets', not missing_sw and bool(sw), code='sw_precache', repair='reapply_integration',
        severity='FAIL', detail='service worker precache is missing ' + ', '.join(missing_sw))
    put('sw_css', '\\.(html|json|js|css)$' in sw or '\\.(html|json|js|css)$' in sw.replace('\\\\', '\\'),
        code='sw_cache_drift', repair='reapply_integration', severity='DEGRADED',
        detail='service worker still caches css from the network')
    version = snapshot.get('version') or ''
    put('sw_version', (not version or not sw or f"cd3-{version}" in sw), code='sw_version',
        repair=None, severity='FAIL', detail='sw.js cache name does not match version.json')
    manifest = snapshot.get('manifest') or {}
    put('manifest', manifest.get('display') == 'standalone' and bool(manifest.get('icons')),
        code='manifest', repair=None, severity='FAIL', detail='manifest is missing standalone display or icons')
    absent = snapshot.get('missing_assets') or []
    put('asset_files', not absent, code='missing_asset', repair=None, severity='FAIL',
        detail='files missing on disk: ' + ', '.join(absent))

    health = snapshot.get('health') or {}
    fresh_ok = health.get('freshness', 'current') == 'current' and health.get('last_attempt_ok') is not False
    put('freshness', fresh_ok, code='stale_or_failed', repair=None, severity='DEGRADED',
        detail=health.get('freshness_note') or 'freshness is not a completed verification')
    if health.get('verified_at') and health.get('mtime') and health.get('verified_at') == health.get('mtime') and health.get('last_attempt_ok') is False:
        put('provenance', False, code='mtime_as_fresh', repair=None, severity='FAIL',
            detail='file mtime was used as a verification time')
    else:
        cleared.append('provenance')

    stale_buy = False
    for card in snapshot.get('cards') or []:
        if listing_buyable(card.get('lr'), now):
            continue
        offer = card.get('lr') or {}
        if offer.get('url') and offer.get('verified') is True and offer.get('vetted') is not False and offer.get('buyable') is not False:
            if not listing_buyable(offer, now):
                stale_buy = True
    put('stale_buy', not stale_buy, code='stale_buy', repair='quarantine', severity='FAIL',
        detail='a stale or unverified offer is still buyable')

    mismatch = False
    for card in snapshot.get('cards') or []:
        if quarantine_reason(card.get('q'), card.get('title')) and (card.get('lr') or {}).get('url'):
            mismatch = True
    put('print', not mismatch, code='print_mismatch', repair='quarantine', severity='FAIL',
        detail='price page does not match the exact print')

    invented = False
    for card in snapshot.get('cards') or []:
        if card.get('cost_cad') is not None and not (card.get('lr') or {}).get('cad_total') and not ((card.get('retained_offers') or {}).get('lr') or {}).get('cad_total'):
            invented = True
    put('metrics', not invented, code='invented_metric', repair='quarantine', severity='FAIL',
        detail='cost_cad is present without a sourced cad_total')

    acq = snapshot.get('acquisition') or {}
    stalled = bool(acq.get('pending')) and not acq.get('acquired') and not acq.get('rejected') and acq.get('stalled')
    put('acquisition', not stalled, code='discovery_stalled', repair=None, severity='DEGRADED',
        detail='discovery has not completed a batch; publish does not add cards')

    workers = snapshot.get('workers') or []
    crashed = [item['name'] for item in workers if item.get('crashed')]
    stuck = [item['name'] for item in workers if item.get('stuck') and item.get('running')]
    put('workers', not crashed, code='worker_crashed', repair='restart_worker', severity='FAIL',
        detail='crashed: ' + ', '.join(crashed))
    put('stuck', not stuck, code='worker_stuck', repair=None, severity='DEGRADED',
        detail='still running, not killed: ' + ', '.join(stuck))

    http = snapshot.get('http_status')
    put('auth', http not in (401, 429), code='auth_401' if http == 401 else 'auth_429',
        repair='refresh_auth' if http == 401 else ('cooldown' if http == 429 else None),
        severity='FAIL', detail=f'HTTP {http}')

    pub = snapshot.get('publish') or {}
    put('publish', not pub.get('failed'), code='publish_failed',
        repair='retry_publish' if pub.get('gate_passed') else 'restore_last_known_good',
        severity='FAIL', detail='publish failed' if pub.get('gate_passed') else 'publish failed and the gate did not pass')

    mem = snapshot.get('mem_available_mb', 4096)
    disk = snapshot.get('disk_free_mb', 4096)
    put('memory', mem >= 2048, code='low_memory', repair=None, severity='DEFERRED',
        detail=f'{mem} MB free, below 2048 MB')
    put('disk', disk >= 512, code='low_disk', repair=None, severity='DEGRADED',
        detail=f'{disk} MB free')

    backup = snapshot.get('backup') or {'status': 'pending', 'tested': False}
    if backup.get('status') == 'pending':
        put('backup', False, code='backup_pending', repair=None, severity='DEFERRED',
            detail='backup not tested')
    else:
        put('backup', backup.get('status') == 'isolated_ok' and backup.get('production_restore_claimed') is not True,
            code='backup_failed', repair=None, severity='FAIL', detail=backup.get('reason') or 'backup check failed')

    for extra in snapshot.get('extra_findings') or []:
        findings.append(dict(extra, unknown=True, repair=None, severity=extra.get('severity') or 'FAIL'))
    return findings, cleared


def _eligible(name, snapshot, incident):
    if name not in ALLOW:
        return False
    if incident.get('attempts', {}).get(name, 0) >= CAP.get(name, 1):
        return False
    if snapshot.get('stop') and name in HEAVY:
        return False
    if snapshot.get('pause') and name == 'retry_publish':
        return False
    mem_kb = int(snapshot.get('mem_available_mb', 4096)) * 1024
    if name in HEAVY and not enough_ram(mem_kb):
        return False
    return True


def _history(state, now, check_id, action, result):
    row = {'id': check_id, 'action': action, 'result': result, 'ts': now}
    hist = state.setdefault('history', [])
    if hist and hist[-1].get('id') == check_id and hist[-1].get('action') == action and hist[-1].get('result') == result:
        return
    hist.append(row)
    del hist[:-200]


def supervise(snapshot, state_path, *, now, run_id, repairs=None, mode='periodic'):
    repairs = repairs or {}
    fd, lock = _lock(state_path)
    if fd is None:
        existing = _load(state_path)
        return {'skipped': 'single_flight', 'level': existing.get('level', 'FAIL'), 'incidents': existing.get('incidents', {})}
    try:
        state = _load(state_path)
        incidents = state.setdefault('incidents', {})
        findings, cleared = collect(snapshot, now)
        guard = Guard(snapshot.get('quota_path') or (state_path + '.quota'))
        working = dict(snapshot)
        for finding in findings:
            inc = incidents.setdefault(finding['id'], {'attempts': {}})
            inc['unknown'] = bool(finding.get('unknown'))
            inc['detail'] = finding.get('detail')
            inc['last_seen'] = now
            name = finding.get('repair')
            verified = False
            if name and _eligible(name, working, inc):
                fn = repairs.get(name)
                if fn:
                    inc.setdefault('attempts', {})[name] = inc['attempts'].get(name, 0) + 1
                    updated = fn(working, finding, guard)
                    if isinstance(updated, dict):
                        working = updated
                    again, _ = collect(working, now)
                    verified = not any(item['id'] == finding['id'] for item in again)
                    _history(state, now, finding['id'], name, 'verified' if verified else 'unverified')
            if finding.get('unknown'):
                inc['status'] = 'FAIL'
                inc['unresolved'] = True
            elif name == 'restore_last_known_good' and inc['attempts'].get(name):
                inc['status'] = 'DEGRADED'
                inc['contained'] = True
                inc['unresolved'] = True
            elif finding.get('severity') == 'DEFERRED':
                inc['status'] = 'DEFERRED'
                inc['unresolved'] = True
            elif verified:
                inc['status'] = 'OK'
                inc['unresolved'] = False
            else:
                inc['status'] = finding.get('severity') or 'FAIL'
                inc['unresolved'] = True
        for check_id in cleared:
            inc = incidents.get(check_id)
            if not inc or inc.get('unknown'):
                continue
            if inc.get('contained') and inc.get('unresolved'):
                continue
            inc['status'] = 'OK'
            inc['unresolved'] = False
        state['level'] = overall_level(incidents)
        state['updated'] = now
        state['mode'] = mode
        state['provenance'] = provenance_time(working.get('health') or {})
        _save(state_path, state)
        return {
            'level': state['level'],
            'incidents': incidents,
            'history': state.get('history', []),
            'skipped': None,
            'report': render_report(state),
        }
    finally:
        _unlock(fd, lock)


def render_report(state):
    lines = [
        '# Supervisor',
        '',
        f"Level: {state.get('level')}",
        'This check does not see every failure. Unknown items stay open until that same item is checked again.',
        '',
    ]
    for key, inc in (state.get('incidents') or {}).items():
        lines.append(f"- {key}: {inc.get('status')} unresolved={inc.get('unresolved')} {inc.get('detail') or ''}")
    return '\n'.join(lines) + '\n'


def mem_available_mb():
    try:
        for line in open('/proc/meminfo'):
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    except OSError:
        return 0
    return 0
