#!/usr/bin/env python3
"""Copy patched operational sources into a destination tree.

Default is a dry run. --apply DEST writes files. It does not touch /workspace
unless DEST is that path, and this script is not run that way here.
"""
import os
import shutil
import sys

OPS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(OPS)
HELPERS = [
    'quota.py', 'verify_outcome.py', 'metrics.py', 'discovery.py', 'print_key.py',
    'freshness.py', 'supervisor.py', 'prepublish.py', 'backup_check.py', 'supervisor_periodic.py',
]
TREE = [
    ('ops/deploy/ygo_cards/tracker.py', 'ygo_cards/tracker.py'),
    ('ops/deploy/ygo_cards/verify.py', 'ygo_cards/verify.py'),
    ('ops/deploy/ygo_cards/config.json', 'ygo_cards/config.json'),
    ('ops/deploy/mtg_cards/tracker.py', 'mtg_cards/tracker.py'),
    ('ops/deploy/mtg_cards/markets.py', 'mtg_cards/markets.py'),
    ('ops/deploy/mtg_cards/test_verified_links.py', 'mtg_cards/test_verified_links.py'),
    ('ops/deploy/mtg_cards/config.json', 'mtg_cards/config.json'),
    ('ops/deploy/card_ops/doctor.py', 'card_ops/doctor.py'),
    ('ops/deploy/card_ops/capok.sh', 'card_ops/capok.sh'),
    ('ops/deploy/card_ops/doctor_cycle.sh', 'card_ops/doctor_cycle.sh'),
    ('ops/deploy/card_ops/status.py', 'card_ops/status.py'),
    ('ops/deploy/card_ops/alerts.py', 'card_ops/alerts.py'),
    ('ops/deploy/card_app/publish.sh', 'card_app/publish.sh'),
    ('ops/deploy/card_app/build.py', 'card_app/build.py'),
    ('ops/deploy/card_app/build_market_input.py', 'card_app/build_market_input.py'),
    ('ops/deploy/card_app/index.tpl.html', 'card_app/index.tpl.html'),
    ('ops/deploy/card_common/categories.py', 'card_common/categories.py'),
    ('ops/deploy/yugioh/keepalive.sh', 'yugioh/keepalive.sh'),
]


def mapping():
    rows = [(os.path.join(OPS, name), os.path.join('card_ops', name)) for name in HELPERS]
    rows += [(os.path.join(REPO, src), dest) for src, dest in TREE]
    return rows


def apply(dest):
    for src, rel in mapping():
        if not os.path.isfile(src):
            raise SystemExit(f'missing {src}')
        target = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(src, target)
    return len(mapping())


def main(argv):
    if '--apply' in argv:
        dest = argv[argv.index('--apply') + 1]
        if os.path.abspath(dest) in ('/workspace', '/'):
            raise SystemExit('refusing to apply onto /workspace from this script without an explicit staging directory')
        count = apply(dest)
        print(f'installed {count} files into {dest}')
        return 0
    print('dry run')
    for src, rel in mapping():
        print(f'{rel}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
