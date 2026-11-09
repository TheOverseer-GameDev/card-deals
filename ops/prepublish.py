"""Pre-publish gate hook. Exit 0 passes, 1 fails, 3 means the phone journey was
deferred for resources and must not be treated as a pass.

Does not start trackers, does not call eBay, and does not buy anything.
"""
import json
import os
import sys
import time

from backup_check import check_backup
from supervisor import mem_available_mb, supervise


JOURNEY_S = 6 * 3600


def journey_decision(mem_mb, runner, force=False):
    if mem_mb < 2048:
        return {'status': 'deferred', 'ran': False, 'reason': f'{mem_mb} MB free, phone journey skipped'}
    if runner is None:
        return {'status': 'deferred', 'ran': False, 'reason': 'phone journey runner is not configured'}
    result = runner()
    status = result.get('status')
    if status not in ('pass', 'fail'):
        return {'status': 'deferred', 'ran': False, 'reason': 'phone journey did not return pass or fail'}
    return {'status': status, 'ran': True, 'reason': result.get('reason') or ''}


def consider_journey(state, now, mem_mb, runner, force=False):
    """Periodic runs are at most once per six hours. A skip is never stored as a pass."""
    last = state.get('journey_at')
    if not force and last is not None and now - last < JOURNEY_S:
        return {'status': state.get('journey_status') or 'not_tested', 'ran': False, 'reason': 'not due'}
    decision = journey_decision(mem_mb, runner, force=force)
    if decision['status'] == 'deferred':
        state['journey_status'] = 'deferred'
        state['journey_reason'] = decision['reason']
        return decision
    if decision['ran']:
        state['journey_at'] = now
        state['journey_status'] = decision['status']
    return decision


def decide(level, journey_status, backup_status):
    if journey_status == 'deferred':
        return 3
    if journey_status == 'fail' or level == 'FAIL':
        return 1
    if backup_status == 'fail':
        return 1
    return 0


def load_site(root, mem_mb):
    def read(name):
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            return ''
        with open(path) as handle:
            return handle.read()
    try:
        manifest = json.loads(read('manifest.json') or '{}')
    except json.JSONDecodeError:
        manifest = {}
    try:
        version = str(json.loads(read('version.json') or '{}').get('v') or '')
    except json.JSONDecodeError:
        version = ''
    try:
        free = int(os.statvfs(root).f_bavail * os.statvfs(root).f_frsize / 1048576)
    except OSError:
        free = 0
    missing = [rel for rel in ('scan/boot.js', 'scan/engine.js', 'scan/prices.js', 'scan/scan.css')
               if not os.path.isfile(os.path.join(root, rel))]
    cards = []
    health = {'freshness': 'current'}
    raw = read('data.js')
    if raw.startswith('window.D='):
        try:
            data = json.loads(raw[len('window.D='):].rstrip().rstrip(';'))
        except json.JSONDecodeError:
            data = {}
        health = data.get('health') or health
        if 'freshness' not in health and health.get('level') == 'ok':
            health = dict(health, freshness='current')
        for game in ('ygo', 'mtg'):
            for card in (data.get(game) or {}).get('cards') or []:
                offer = card.get('lr') or {}
                if not offer.get('url'):
                    continue
                cards.append({
                    'q': card.get('q') or '',
                    'title': card.get('name') or '',
                    'lr': offer,
                    'cost_cad': card.get('cost_cad'),
                })
    return {
        'index_html': read('index.html'),
        'sw_js': read('sw.js'),
        'manifest': manifest,
        'version': version,
        'mem_available_mb': mem_mb,
        'disk_free_mb': free,
        'health': health,
        'checked_at': time.time(),
        'missing_assets': missing,
        'cards': cards,
        'workers': [],
        'publish': {'failed': False},
    }


def main(argv, runner=None, root=None):
    # box install (2026-11-09): CARD_SITE points at the site checkout; default unchanged.
    root = os.environ.get('CARD_SITE') or root or os.path.join(os.path.dirname(__file__), '..')
    mem = mem_available_mb()
    manifest = os.environ.get('CARD_BACKUP_MANIFEST') or ''
    backup = check_backup(manifest or None)
    if runner is None and '--journey' in argv:
        runner = lambda: node_journey(root)
    journey = journey_decision(mem, runner, force=True)
    snapshot = load_site(root, mem)
    snapshot['backup'] = backup
    snapshot['journey'] = journey
    state = os.environ.get('CARD_PREPUBLISH_STATE') or os.path.join(root, 'ops', 'supervisor_state.json')
    report = supervise(snapshot, state, now=time.time(), run_id='prepublish', mode='prepublish')
    code = decide(report.get('level'), journey['status'], backup.get('status'))
    print(report.get('level'), journey['status'], backup.get('status'), 'exit', code)
    return code


def node_journey(root):
    import subprocess
    proc = subprocess.run(
        ['node', '--test', '--test-timeout', '180000', 'scan/test/journey.test.js'],
        cwd=root, capture_output=True, text=True,
    )
    tail = ((proc.stdout or '') + (proc.stderr or ''))[-800:]
    return {'status': 'pass' if proc.returncode == 0 else 'fail', 'reason': tail}


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:], root=os.path.join(os.path.dirname(__file__), '..')))
