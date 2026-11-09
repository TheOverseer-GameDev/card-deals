import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import backup_check


def _write(root, rel, body):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as handle:
        handle.write(body)
    return hashlib.sha256(body.encode()).hexdigest()


class BackupTests(unittest.TestCase):
    def test_missing_manifest_is_pending_and_not_verified(self):
        result = backup_check.check_backup(None)
        self.assertEqual(result['status'], 'pending')
        self.assertFalse(result['tested'])
        self.assertFalse(result['restoration_verified'])
        self.assertTrue(result['production_untouched'])

    def test_isolated_check_does_not_claim_a_production_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            body = json.dumps([{'q': 'Example|SET-EN001|Ultra Rare|', 'title': 'Example'}])
            digest = _write(tmp, 'latest.json', body)
            schema = _write(tmp, 'schema.txt', 'card-list')
            manifest = {
                'synthetic': True,
                'required': ['ygo-latest', 'schema'],
                'files': [
                    {'path': 'latest.json', 'sha256': digest, 'role': 'ygo-latest', 'schema': 'card-list'},
                    {'path': 'schema.txt', 'sha256': schema, 'role': 'schema'},
                ],
            }
            path = os.path.join(tmp, 'manifest.json')
            with open(path, 'w') as handle:
                json.dump(manifest, handle)
            before = open(os.path.join(tmp, 'latest.json')).read()
            result = backup_check.check_backup(path)
            self.assertTrue(result['isolated_ok'])
            self.assertFalse(result['restoration_verified'])
            self.assertFalse(result['production_restore_claimed'])
            self.assertTrue(result['synthetic'])
            self.assertEqual(open(os.path.join(tmp, 'latest.json')).read(), before)
            self.assertFalse(any(name.startswith('backup-check-') for name in os.listdir(tmp)))

    def test_corruption_missing_file_and_secret_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            digest = _write(tmp, 'latest.json', json.dumps([{'q': 'Example|SET-EN001|Ultra Rare|'}]))
            secret = 'super-secret-value'
            _write(tmp, 'token.txt', secret)
            manifest = {
                'synthetic': True,
                'required': ['ygo-latest', 'schema'],
                'files': [
                    {'path': 'latest.json', 'sha256': '0' * 64, 'role': 'ygo-latest', 'schema': 'card-list'},
                    {'path': 'missing.json', 'sha256': digest, 'role': 'schema'},
                    {'path': 'token.txt', 'sha256': digest, 'role': 'secret'},
                ],
            }
            path = os.path.join(tmp, 'manifest.json')
            with open(path, 'w') as handle:
                json.dump(manifest, handle)
            result = backup_check.check_backup(path)
            self.assertEqual(result['status'], 'fail')
            self.assertFalse(result['restoration_verified'])
            text = ' '.join(result['problems'])
            self.assertIn('checksum mismatch', text)
            self.assertIn('missing missing.json', text)
            self.assertIn('refused secret path', text)
            self.assertNotIn(secret, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
