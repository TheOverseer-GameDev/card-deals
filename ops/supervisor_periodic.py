#!/usr/bin/env python3
"""One keepalive tick. No loop, no eBay, no model. Under 2 GB this records
DEFERRED and does not pretend the check passed.
"""
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
import sys
sys.path.insert(0, HERE)

from backup_check import check_backup
from prepublish import load_site
from supervisor import _load, _save, mem_available_mb, overall_level, supervise

INTERVAL = 120


def memory_mb():
    raw = os.environ.get('CARD_MEM_MB')
    if raw:
        return int(raw)
    return mem_available_mb()


def main():
    root = os.environ.get('CARD_ROOT', '/workspace')
    if os.path.exists(os.path.join(root, 'card_STOP')):
        print('stop')
        return 0
    stamp = os.path.join(HERE, '.supervisor_stamp')
    if os.path.exists(stamp) and time.time() - os.path.getmtime(stamp) < INTERVAL and not os.environ.get('CARD_SUPERVISOR_FORCE'):
        print('not due')
        return 0
    mem = memory_mb()
    state_path = os.path.join(HERE, 'supervisor_state.json')
    if mem < 2048:
        state = _load(state_path)
        incidents = state.setdefault('incidents', {})
        incidents['memory'] = {
            'status': 'DEFERRED',
            'unresolved': True,
            'detail': f'{mem} MB free, supervisor deferred',
            'attempts': {},
        }
        state['level'] = overall_level(incidents)
        state['updated'] = time.time()
        _save(state_path, state)
        print('DEFERRED', state['level'])
        return 0
    open(stamp, 'w').write(str(time.time()))
    # box install 2026-11-09: read the built site checkout, not /workspace itself.
    snap = load_site(os.environ.get('CARD_SITE') or os.path.join(root, 'card_app', 'site'), mem)
    snap['backup'] = check_backup(os.environ.get('CARD_BACKUP_MANIFEST') or None)
    report = supervise(snap, state_path, now=time.time(), run_id='periodic', mode='periodic')
    print(report.get('level'), snap['backup'].get('status'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
