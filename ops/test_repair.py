import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import discovery
import freshness
import metrics
import print_key
import quota
import verify_outcome
from prepublish import consider_journey, decide, journey_decision


class QuotaTests(unittest.TestCase):
    def test_401_refreshes_once_then_stops_and_retains(self):
        with tempfile.TemporaryDirectory() as tmp:
            guard = quota.Guard(os.path.join(tmp, 'q.json'))
            calls = []
            refreshes = []

            def call():
                calls.append(1)
                return 401, {}, None

            def refresh():
                refreshes.append(1)
                return True

            first = guard.handle(call, refresh, now=1000, run_id='run')
            second = guard.handle(call, refresh, now=1001, run_id='run')
            self.assertEqual(first['reason'], '401')
            self.assertTrue(first['retain'])
            self.assertEqual(first['refresh'], 'retry_failed')
            self.assertEqual(refreshes, [1])
            self.assertEqual(len(calls), 2)
            self.assertFalse(second['called'])
            self.assertEqual(second['refresh'], 'blocked')

    def test_429_cooldown_is_shared_and_stops_the_next_caller(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'q.json')
            first = quota.Guard(path)
            calls = []

            def call():
                calls.append(1)
                return 429, {'Retry-After': '120'}, None

            result = first.handle(call, lambda: True, now=5000, run_id='a')
            self.assertEqual(result['reason'], '429')
            self.assertTrue(result['retain'])
            second = quota.Guard(path)
            later = second.handle(lambda: calls.append('no') or (200, {}, None), lambda: True, now=5100, run_id='b')
            self.assertEqual(later['reason'], 'cooldown')
            self.assertFalse(later['called'])
            self.assertEqual(calls, [1])
            self.assertGreaterEqual(second.read()['cooldown_until'], 5120)

    def test_concurrent_refresh_is_single_flight(self):
        with tempfile.TemporaryDirectory() as tmp:
            guard = quota.Guard(os.path.join(tmp, 'q.json'))
            refreshes = []

            def refresh():
                refreshes.append(1)
                time.sleep(0.3)
                return True

            results = []

            def run():
                results.append(guard.refresh_once(refresh, now=1, run_id='same'))

            threads = [threading.Thread(target=run), threading.Thread(target=run)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(3)
            self.assertEqual(refreshes, [1])
            self.assertEqual(sorted(results), ['followed', 'refreshed'])


class VerifyTests(unittest.TestCase):
    def test_transport_hides_offer_and_keeps_a_recoverable_copy(self):
        card = {'q': 'Example|SET-EN001|Ultra Rare|', 'lr': {'url': 'https://www.ebay.com/itm/123456789012', 'cad_total': 40, 'verified': True}}
        hidden = verify_outcome.apply_result(card, 'lr', card['lr'], 'transport', 401, '401')
        self.assertIsNone(hidden['lr'])
        self.assertNotIn('ended', hidden)
        self.assertEqual(hidden['listing_state'], 'verification_unavailable')
        recovered = verify_outcome.recover(hidden, 'lr')
        self.assertEqual(recovered['cad_total'], 40)
        self.assertFalse(recovered['buyable'])
        self.assertIsNone(verify_outcome.recover({'lr': None}, 'lr'))

    def test_ended_is_not_buyable_and_is_counted_ended(self):
        card = {'lr': {'url': 'https://www.ebay.com/itm/123456789012'}}
        ended = verify_outcome.apply_result(card, 'lr', card['lr'], 'ended', 404, 'ended')
        self.assertEqual(ended['listing_state'], 'ended')
        self.assertEqual(ended['ended'], ['lr'])
        self.assertIsNone(ended['lr'])

    def test_empty_result_is_not_a_pass_after_transport_failure(self):
        failed = verify_outcome.finish_run([{'kind': 'transport'}], test_mode=True)
        self.assertFalse(failed['publish'])
        self.assertEqual(failed['exit'], 2)
        self.assertFalse(failed['vacuous_pass'])
        empty = verify_outcome.finish_run([], test_mode=True)
        self.assertTrue(empty['honest_empty'])
        self.assertEqual(empty['exit'], 0)
        self.assertTrue(empty['publish'])


class MetricTests(unittest.TestCase):
    def test_missing_source_does_not_invent_cost_or_return(self):
        row = {'raw': 10, 'fx': 1.4}
        self.assertEqual(metrics.emit_metrics(row), {})
        self.assertNotIn(14, metrics.emit_metrics(row).values())

    def test_sourced_cost_persists_and_hold_stays_absent_without_inputs(self):
        row = {'lr': {'cad_total': 12.5, 'verified': True}}
        self.assertEqual(metrics.emit_metrics(row), {'cost_cad': 12.5})
        full = dict(row, hold_sourced=True, hold_cad=3, ret_pct=8)
        got = metrics.emit_metrics(full)
        self.assertEqual(got['cost_cad'], 12.5)
        self.assertEqual(got['hold_cad'], 3)
        self.assertEqual(got['ret_pct'], 8)


class DiscoveryTests(unittest.TestCase):
    def test_discovery_resumes_and_does_not_count_transport_as_completed(self):
        rows = [{'key': str(i), 'state': 'pending'} for i in range(4)]
        batch = discovery.plan(rows, 2, 2)
        self.assertEqual([row['key'] for row in batch['discover']], ['0', '1'])
        discovery.apply_outcome(rows[0], 'acquired', now=10)
        discovery.apply_outcome(rows[1], 'transport', now=10)
        self.assertEqual(rows[1]['state'], 'pending')
        again = discovery.plan(rows, 2, 2)
        self.assertEqual([row['key'] for row in again['discover']], ['1', '2'])
        self.assertEqual(discovery.counters(['acquired', 'transport']), {'acquired': 1, 'rejected': 0, 'transport': 1, 'completed': 1})

    def test_publish_due_does_not_make_discovery_due(self):
        jobs = discovery.due({'publish': 4000, 'discovery': 10, 'refresh': 10})
        self.assertTrue(jobs['publish'])
        self.assertFalse(jobs['discovery'])
        self.assertFalse(jobs['refresh'])
        self.assertFalse(discovery.due({'discovery': 99999}, ram_ok=False)['discovery'])
        self.assertFalse(discovery.enough_ram(2047 * 1024))
        self.assertTrue(discovery.enough_ram(2048 * 1024))


class PrintTests(unittest.TestCase):
    def test_eno34_is_kept_and_only_authoritative_ids_undo_the_guess(self):
        kept = print_key.resolve('LAVD-ENO34')
        self.assertEqual(kept['code'], 'LAVD-ENO34')
        self.assertFalse(kept['corrected'])
        self.assertFalse(kept['quarantine'])
        guessed = print_key.resolve('LAVD-EN034')
        self.assertEqual(guessed['code'], 'LAVD-EN034')
        self.assertTrue(guessed['quarantine'])
        fixed = print_key.resolve('LAVD-EN034', password='86066372')
        self.assertEqual(fixed['code'], 'LAVD-ENO34')
        self.assertTrue(fixed['corrected'])
        other = print_key.resolve('LAVD-ENO12')
        self.assertEqual(other['code'], 'LAVD-ENO12')
        self.assertFalse(other['quarantine'])

    def test_rarity_mismatch_stays_quarantined(self):
        reason = print_key.quarantine_reason(
            "Ash Blossom & Joyous Spring|RA04-EN025|Collector's Rare|",
            'Ash Blossom & Joyous Spring [Ultra Rare] RA04-EN025 Prices',
        )
        self.assertIn('rarity mismatch', reason)
        same = print_key.quarantine_reason(
            'Stardust Dragon|TDGS-EN040|Ghost Rare|1st',
            'Stardust Dragon [Ghost Rare 1st Edition] TDGS-EN040 Prices',
        )
        self.assertIsNone(same)


class FreshnessTests(unittest.TestCase):
    def test_failure_keeps_last_good_record_and_does_not_look_fresh(self):
        now = 1_700_000_000
        record = {
            'verified_at': '2026-11-06T18:00:00+00:00',
            'mtime': now,
            'lr': {'url': 'https://www.ebay.com/itm/123456789012', 'cad_total': 20, 'verified': True, 'verified_at': '2026-11-06T18:00:00+00:00'},
        }
        failed = freshness.note_failure(record, '2026-11-07T12:00:00+00:00', '401')
        self.assertEqual(failed['verified_at'], '2026-11-06T18:00:00+00:00')
        self.assertNotEqual(freshness.provenance_time(failed), now)
        self.assertIsNone(failed['lr'])
        self.assertEqual(failed['retained_offers']['lr']['cad_total'], 20)
        self.assertEqual(failed['freshness'], 'verification_unavailable')
        self.assertNotEqual(freshness.health_fields(failed)['freshness'], 'current')
        self.assertIsNone(freshness.provenance_time({'mtime': now}))

    def test_stale_offer_is_not_buyable(self):
        now = 1_700_000_000
        old = {
            'url': 'https://www.ebay.com/itm/123456789012',
            'verified': True,
            'vetted': True,
            'verified_at': now - 40 * 3600,
            'listing_state': 'current',
        }
        self.assertFalse(freshness.listing_buyable(old, now))
        fresh = dict(old, verified_at=now - 3600)
        self.assertTrue(freshness.listing_buyable(fresh, now))


class JourneyGateTests(unittest.TestCase):
    def test_low_ram_defers_and_is_not_a_pass(self):
        calls = []
        result = journey_decision(1000, lambda: calls.append(1) or {'status': 'pass'})
        self.assertEqual(result['status'], 'deferred')
        self.assertEqual(calls, [])
        self.assertEqual(decide('OK', 'deferred', 'pending'), 3)
        self.assertNotEqual(decide('OK', 'deferred', 'pending'), 0)

    def test_periodic_cadence_does_not_rerun_or_invent_a_pass(self):
        state = {}
        calls = []
        first = consider_journey(state, 100, 4096, lambda: calls.append(1) or {'status': 'pass'})
        self.assertEqual(first['status'], 'pass')
        second = consider_journey(state, 200, 4096, lambda: calls.append(1) or {'status': 'pass'})
        self.assertEqual(second['reason'], 'not due')
        self.assertEqual(calls, [1])
        self.assertEqual(second['status'], 'pass')
        never = {}
        skipped = consider_journey(never, 0, 500, lambda: {'status': 'pass'})
        self.assertEqual(skipped['status'], 'deferred')
        self.assertNotEqual(never.get('journey_status'), 'pass')


if __name__ == '__main__':
    unittest.main()
