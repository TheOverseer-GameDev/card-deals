"""Isolated backup check. Does not write to the source tree or to a PC backup.

A missing manifest is pending, not a pass and not a restoration. A synthetic
archive can exercise checksum and schema logic, and still must not be reported
as a verified production restore.
"""
import hashlib
import json
import os
import shutil
import tempfile

REQUIRED_ROLES = ('ygo-latest', 'schema')
SECRET_PARTS = ('.env', 'credential', 'secret', 'token', 'cookie', '.ebay')


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _secretish(path):
    name = path.replace('\\', '/').lower()
    return any(part in name for part in SECRET_PARTS)


def check_backup(manifest_path=None, work_dir=None):
    if not manifest_path or not os.path.isfile(manifest_path):
        return {
            'status': 'pending',
            'tested': False,
            'restoration_verified': False,
            'production_untouched': True,
            'reason': 'backup inaccessible',
        }
    try:
        with open(manifest_path) as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        return {
            'status': 'fail',
            'tested': True,
            'restoration_verified': False,
            'production_untouched': True,
            'reason': f'manifest unreadable: {exc.__class__.__name__}',
        }
    root = os.path.dirname(os.path.abspath(manifest_path))
    synthetic = bool(manifest.get('synthetic'))
    problems = []
    files = manifest.get('files') or []
    if not files:
        problems.append('manifest lists no files')
    temp = tempfile.mkdtemp(prefix='backup-check-', dir=work_dir)
    try:
        seen = set()
        for item in files:
            rel = str(item.get('path') or '')
            role = item.get('role') or rel
            seen.add(role)
            if not rel or rel.startswith('/') or '..' in rel.split('/'):
                problems.append(f'refused path {rel}')
                continue
            if _secretish(rel):
                problems.append(f'refused secret path {rel}')
                continue
            src = os.path.join(root, rel)
            if not os.path.isfile(src):
                problems.append(f'missing {rel}')
                continue
            dest = os.path.join(temp, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(src, dest)
            expect = (item.get('sha256') or '').lower()
            actual = _sha256(dest)
            if not expect or actual != expect:
                problems.append(f'checksum mismatch {rel}')
                continue
            if role == 'ygo-latest' or rel.endswith('.json') and item.get('schema') == 'card-list':
                try:
                    with open(dest) as handle:
                        data = json.load(handle)
                except json.JSONDecodeError:
                    problems.append(f'schema {rel} is not json')
                    continue
                if not isinstance(data, list) or not data or not isinstance(data[0], dict):
                    problems.append(f'schema {rel} is not a card list')
                elif not (data[0].get('q') or data[0].get('title')):
                    problems.append(f'schema {rel} has no identity')
        for role in manifest.get('required') or REQUIRED_ROLES:
            if role not in seen:
                problems.append(f'required artifact missing: {role}')
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    isolated_ok = not problems
    return {
        'status': 'isolated_ok' if isolated_ok else 'fail',
        'tested': True,
        'isolated_ok': isolated_ok,
        'restoration_verified': False if synthetic or not isolated_ok else False,
        'production_restore_claimed': False,
        'synthetic': synthetic,
        'production_untouched': True,
        'problems': problems,
        'reason': 'synthetic archive is not a production restore' if synthetic and isolated_ok else ('; '.join(problems) if problems else 'isolated check passed; production was not restored'),
    }
