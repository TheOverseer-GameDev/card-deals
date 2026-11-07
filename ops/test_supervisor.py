import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import supervisor


def healthy():
    return {
        'index_html': 'scan/boot.js',
        'sw_js': "const C='cd3-1',F=['scan/boot.js','scan/engine.js','scan/prices.js','scan/scan.css']; /\\.(html|json|js|css)$/",
        'version': '1',
        'manifest': {'display': 'standalone', 'icons': [{}]},
        'mem_available_mb': 4096,
        'disk_free_mb': 4096,
        'health': {'freshness': 'current', 'verified_at': '2026-11-07T00:00:00+00:00'},
        'backup': {'status': 'isolated_ok', 'production_restore_claimed': False, 'tested': True},
        'cards': [],
        'workers': [],
        'publish': {'failed': False},
    }


class SupervisorTests(unittest.TestCase):
    def test_unknown_incident_survives_a_healthy_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            seeded = {
                'incidents': {
                    'mystery': {'status': 'FAIL', 'unresolved': True, 'unknown': True, 'detail': 'unexplained', 'attempts': {}},
                },
                'history': [],
            }
            supervisor._save(path, seeded)
            result = supervisor.supervise(healthy(), path, now=10, run_id='h')
            self.assertTrue(result['incidents']['mystery']['unresolved'])
            self.assertEqual(result['incidents']['mystery']['status'], 'FAIL')
            self.assertEqual(result['level'], 'FAIL')
            self.assertIn('does not see every failure', result['report'])

    def test_repair_must_verify_and_retries_are_capped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            calls = []
            snap = healthy()
            snap['workers'] = [{'name': 'ygo', 'crashed': True}]

            def restart(snapshot, finding, guard):
                calls.append(finding['id'])
                return snapshot

            for _ in range(4):
                supervisor.supervise(snap, path, now=1, run_id='r', repairs={'restart_worker': restart})
            self.assertEqual(calls, ['workers', 'workers', 'workers'])
            state = supervisor._load(path)
            self.assertTrue(state['incidents']['workers']['unresolved'])

    def test_verified_restart_clears_only_that_incident(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            snap = healthy()
            snap['workers'] = [{'name': 'ygo', 'crashed': True}]

            def restart(snapshot, finding, guard):
                snapshot = dict(snapshot)
                snapshot['workers'] = [{'name': 'ygo', 'crashed': False}]
                return snapshot

            result = supervisor.supervise(snap, path, now=2, run_id='ok', repairs={'restart_worker': restart})
            self.assertEqual(result['incidents']['workers']['status'], 'OK')
            self.assertFalse(result['incidents']['workers']['unresolved'])

    def test_stop_blocks_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            calls = []
            snap = healthy()
            snap['stop'] = True
            snap['workers'] = [{'name': 'ygo', 'crashed': True}]
            supervisor.supervise(snap, path, now=3, run_id='stop', repairs={'restart_worker': lambda *a: calls.append(1) or a[0]})
            self.assertEqual(calls, [])
            self.assertTrue(supervisor._load(path)['incidents']['workers']['unresolved'])

    def test_failed_publish_without_a_gate_is_contained_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            calls = []
            snap = healthy()
            snap['publish'] = {'failed': True, 'gate_passed': False, 'last_known_good': True}

            def retry(snapshot, finding, guard):
                calls.append('retry')
                return snapshot

            def restore(snapshot, finding, guard):
                calls.append('restore')
                return snapshot

            result = supervisor.supervise(snap, path, now=4, run_id='pub', repairs={'retry_publish': retry, 'restore_last_known_good': restore})
            self.assertEqual(calls, ['restore'])
            inc = result['incidents']['publish']
            self.assertTrue(inc['contained'])
            self.assertTrue(inc['unresolved'])
            self.assertNotEqual(inc['status'], 'OK')

    def test_quarantine_removes_a_stale_buy(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            now = 1_700_000_000
            snap = healthy()
            snap['cards'] = [{
                'q': 'Example|SET-EN001|Ultra Rare|',
                'title': 'Example [Ultra Rare] SET-EN001 Prices',
                'lr': {
                    'url': 'https://www.ebay.com/itm/123456789012',
                    'verified': True,
                    'vetted': True,
                    'verified_at': now - 50 * 3600,
                    'listing_state': 'current',
                },
            }]

            def quarantine(snapshot, finding, guard):
                snapshot = dict(snapshot)
                cards = []
                for card in snapshot['cards']:
                    offer = dict(card.get('lr') or {})
                    offer['buyable'] = False
                    offer['verified'] = False
                    card = dict(card, lr=offer, retained_offers={'lr': offer})
                    cards.append(card)
                snapshot['cards'] = cards
                return snapshot

            result = supervisor.supervise(snap, path, now=now, run_id='q', repairs={'quarantine': quarantine})
            self.assertEqual(result['incidents']['stale_buy']['status'], 'OK')
            self.assertFalse(result['incidents']['stale_buy']['unresolved'])

    def test_duplicate_repair_history_is_not_appended(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            snap = healthy()
            snap['index_html'] = 'no hook'
            result = None
            for _ in range(2):
                result = supervisor.supervise(snap, path, now=8, run_id='dup', repairs={'reapply_integration': lambda snapshot, finding, guard: snapshot})
            self.assertEqual(len(result['history']), 1)

    def test_single_flight_skips_the_second_caller(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'state.json')
            started = threading.Event()
            release = threading.Event()
            snap = healthy()
            snap['workers'] = [{'name': 'ygo', 'crashed': True}]

            def restart(snapshot, finding, guard):
                started.set()
                release.wait(2)
                snapshot = dict(snapshot)
                snapshot['workers'] = [{'name': 'ygo', 'crashed': False}]
                return snapshot

            holder = {}

            def run():
                holder['result'] = supervisor.supervise(snap, path, now=9, run_id='lock', repairs={'restart_worker': restart})

            thread = threading.Thread(target=run)
            thread.start()
            self.assertTrue(started.wait(2))
            skipped = supervisor.supervise(healthy(), path, now=9, run_id='other')
            release.set()
            thread.join(3)
            self.assertEqual(skipped['skipped'], 'single_flight')
            self.assertEqual(holder['result']['incidents']['workers']['status'], 'OK')


if __name__ == '__main__':
    unittest.main()
