#!/usr/bin/env python3
"""Drop generated files a failed build left after rollback.

Only h/ and scan/market/ are touched. A file that still exists in the
previous site is kept. Anything outside those two trees is left alone.
"""
import os
import sys

GENERATED = ('h', os.path.join('scan', 'market'))


def _inside(path, root_real):
    """True only when the real path is the site itself or something inside it."""
    real = os.path.realpath(path)
    return real == root_real or real.startswith(root_real + os.sep)


def clean(site, previous):
    site = os.path.abspath(site)
    previous = os.path.abspath(previous)
    site_real = os.path.realpath(site)
    removed = []
    for rel in GENERATED:
        root = os.path.join(site, rel)
        # os.walk follows a symlink given as its start. Never enter one.
        if os.path.islink(root) or not os.path.isdir(root) or not _inside(root, site_real):
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = [name for name in dirnames if not os.path.islink(os.path.join(dirpath, name))]
            if os.path.islink(dirpath) or not _inside(dirpath, site_real):
                dirnames[:] = []
                continue
            for name in filenames:
                path = os.path.join(dirpath, name)
                if os.path.islink(path) or not os.path.isfile(path) or not _inside(path, site_real):
                    continue
                relpath = os.path.relpath(os.path.realpath(path), site_real)
                if relpath.startswith('..') or os.path.isabs(relpath):
                    continue
                if os.path.isfile(os.path.join(previous, relpath)):
                    continue
                os.remove(path)
                removed.append(relpath)
        for dirpath, dirnames, _files in os.walk(root, topdown=False, followlinks=False):
            if os.path.islink(dirpath) or not _inside(dirpath, site_real):
                continue
            for name in dirnames:
                folder = os.path.join(dirpath, name)
                if os.path.islink(folder) or not _inside(folder, site_real):
                    continue
                if os.path.isdir(folder) and not os.listdir(folder):
                    os.rmdir(folder)
        if (not os.path.islink(root) and _inside(root, site_real) and os.path.isdir(root)
                and not os.listdir(root) and not os.path.isdir(os.path.join(previous, rel))):
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
