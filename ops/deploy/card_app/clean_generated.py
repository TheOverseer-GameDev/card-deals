#!/usr/bin/env python3
"""Drop generated files a failed build left after rollback.

Only h/ and scan/market/ are touched. A file that still exists in the
previous site is kept. Anything outside those two trees is left alone.
"""
import os
import sys

GENERATED = ('h', os.path.join('scan', 'market'))


def clean(site, previous):
    site = os.path.abspath(site)
    previous = os.path.abspath(previous)
    removed = []
    for rel in GENERATED:
        root = os.path.join(site, rel)
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, filenames in os.walk(root):
            for name in filenames:
                path = os.path.join(dirpath, name)
                relpath = os.path.relpath(path, site)
                if relpath.startswith('..') or os.path.isabs(relpath):
                    continue
                if os.path.isfile(os.path.join(previous, relpath)):
                    continue
                os.remove(path)
                removed.append(relpath)
        for dirpath, dirnames, _files in os.walk(root, topdown=False):
            for name in dirnames:
                folder = os.path.join(dirpath, name)
                if os.path.isdir(folder) and not os.listdir(folder):
                    os.rmdir(folder)
        if os.path.isdir(root) and not os.listdir(root) and not os.path.isdir(os.path.join(previous, rel)):
            os.rmdir(root)
    return removed


def main(argv):
    if len(argv) != 3:
        print('usage: clean_generated.py SITE PREVIOUS', file=sys.stderr)
        return 2
    removed = clean(argv[1], argv[2])
    for rel in removed:
        print('removed', rel)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
