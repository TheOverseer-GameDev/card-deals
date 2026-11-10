"""Freshness is current only when both trackers finished today and prices were verified."""
import datetime
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'ops'))
sys.path.insert(0, str(REPO / 'ops' / 'deploy'))
import freshness
import install


def iso_hours_ago(hours):
    when = datetime.datetime.now().astimezone() - datetime.timedelta(hours=hours)
    return when.isoformat(timespec='seconds')


def card(verified_at, item):
    return {
        'title': 'Example Card',
        'raw': 10,
        'score': 1,
        'lr': {
            'url': 'https://www.ebay.com/itm/' + item,
            'price': 4,
            'cad_total': 6,
            'verified': True,
            'vetted': True,
            'verified_at': verified_at,
            'listing_state': 'current',
        },
    }


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class AssessCatalogTests(unittest.TestCase):
    def catalog(self, ygo_stamp, mtg_stamp, ygo_at, mtg_at, **kw):
        now = kw.pop('now', 1_700_000_000)
        games = {
            'ygo': {'stamp': ygo_stamp, 'verified_at': ygo_at},
            'mtg': {'stamp': mtg_stamp, 'verified_at': mtg_at},
        }
        return freshness.assess_catalog(
            games, transport_stopped=kw.pop('transport_stopped', False),
            today=kw.pop('today', '2026-11-10'), now=now, **kw)

    def test_today_and_recent_verified_at_is_current(self):
        older = '2026-11-10T10:00:00+00:00'
        newer = '2026-11-10T12:00:00+00:00'
        now = datetime.datetime.fromisoformat(newer).timestamp() + 3600
        got = self.catalog('2026-11-10', '2026-11-10', [older], [newer], now=now, today='2026-11-10')
        self.assertEqual(got['freshness'], 'current')
        self.assertTrue(got['last_attempt_ok'])
        self.assertEqual(got['verified_at'], newer)
        self.assertNotIn('mtime', got)

    def test_mtime_and_date_only_are_not_verification_times(self):
        now = 1_700_000_000
        got = self.catalog('2026-11-10', '2026-11-10', [now], ['2026-11-10'], now=now)
        self.assertNotEqual(got['freshness'], 'current')
        self.assertIsNone(got['verified_at'])
        self.assertFalse(got['last_attempt_ok'])
        self.assertIsNone(freshness.provenance_time({'mtime': now}))

    def test_stale_or_missing_stamp_or_old_price_is_not_current(self):
        now = datetime.datetime.fromisoformat('2026-11-10T12:00:00+00:00').timestamp()
        recent = ['2026-11-10T11:00:00+00:00']
        old = ['2026-11-08T12:00:00+00:00']
        self.assertEqual(self.catalog('2026-11-09', '2026-11-10', recent, recent, now=now)['freshness'], 'stale')
        self.assertEqual(self.catalog(None, '2026-11-10', recent, recent, now=now)['freshness'], 'unknown')
        self.assertEqual(self.catalog('2026-11-10', '2026-11-10', old, recent, now=now)['freshness'], 'stale')
        for got in (
            self.catalog('2026-11-09', '2026-11-10', recent, recent, now=now),
            self.catalog(None, '2026-11-10', recent, recent, now=now),
            self.catalog('2026-11-10', '2026-11-10', old, recent, now=now),
        ):
            self.assertNotEqual(got['freshness'], 'current')
            self.assertFalse(got['last_attempt_ok'])

    def test_transport_stop_overrides_a_fresh_stamp(self):
        now = datetime.datetime.fromisoformat('2026-11-10T12:00:00+00:00').timestamp()
        recent = ['2026-11-10T11:00:00+00:00']
        got = self.catalog('2026-11-10', '2026-11-10', recent, recent, now=now, transport_stopped=True)
        self.assertEqual(got['freshness'], 'verification_unavailable')
        self.assertFalse(got['last_attempt_ok'])
        self.assertEqual(got['verified_at'], recent[0])
        health = freshness.health_fields(got)
        self.assertNotEqual(health['freshness'], 'current')
        self.assertFalse(health['last_attempt_ok'])


class PrepublishFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        install.apply(self.dest)
        self._env = {
            'CARD_ROOT': os.environ.get('CARD_ROOT'),
            'CARD_OPS': os.environ.get('CARD_OPS'),
            'CARD_SITE': os.environ.get('CARD_SITE'),
            'CARD_PREPUBLISH_STATE': os.environ.get('CARD_PREPUBLISH_STATE'),
            'CARD_BACKUP_MANIFEST': os.environ.get('CARD_BACKUP_MANIFEST'),
        }

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def write_cards(self, ygo_at, mtg_at):
        (self.dest / 'ygo_cards' / 'latest.json').write_text(json.dumps([card(ygo_at, '123456789012')]))
        (self.dest / 'mtg_cards' / 'latest.json').write_text(json.dumps([card(mtg_at, '123456789013')]))

    def write_stamp(self, game, text, mtime=None):
        path = self.dest / game / '.stamp'
        path.write_text(text)
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def gate(self):
        site = self.dest / 'card_app' / 'site'
        tools = site / 'scan' / 'tools'
        tools.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / 'scan' / 'tools' / 'integrate.py', tools / 'integrate.py')
        for rel in ('scan/boot.js', 'scan/engine.js', 'scan/prices.js', 'scan/scan.css'):
            path = site / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// fixture\n')
        env = {
            'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
            'HOME': '/tmp',
            'CARD_ROOT': str(self.dest),
            'PYTHONDONTWRITEBYTECODE': '1',
        }
        status = subprocess.run(
            [sys.executable, str(self.dest / 'card_ops' / 'status.py')],
            env=env, text=True, capture_output=True)
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        build = subprocess.run(
            [sys.executable, str(self.dest / 'card_app' / 'build.py')],
            env=env, cwd=self.dest / 'card_app', text=True, capture_output=True)
        self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
        raw = (site / 'data.js').read_text()
        data = json.loads(raw[len('window.D='):].rstrip().rstrip(';'))
        state_path = self.dest / 'card_ops' / 'prepublish_state.json'
        os.environ['CARD_ROOT'] = str(self.dest)
        os.environ['CARD_OPS'] = str(self.dest / 'card_ops')
        os.environ['CARD_SITE'] = str(site)
        os.environ['CARD_PREPUBLISH_STATE'] = str(state_path)
        os.environ['CARD_BACKUP_MANIFEST'] = ''
        ops = str(self.dest / 'card_ops')
        sys.path.insert(0, ops)
        try:
            pre = load_module(self.dest / 'card_ops' / 'prepublish.py', 'prepublish_' + self.dest.name)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = pre.main([], runner=lambda: {'status': 'pass', 'reason': 'fixture journey'})
        finally:
            sys.path.remove(ops)
        saved = json.loads((self.dest / 'card_ops' / 'status.json').read_text())
        state = json.loads(state_path.read_text())
        return saved, data['health'], code, state, buf.getvalue(), build.stdout + build.stderr

    def test_both_stamps_today_and_recent_verified_at_lets_prepublish_pass(self):
        # Stamp text is today. mtime is two days old, so a check that used mtime would refuse.
        ygo_at = iso_hours_ago(2)
        mtg_at = iso_hours_ago(1)
        self.write_cards(ygo_at, mtg_at)
        old = datetime.datetime.now().timestamp() - 48 * 3600
        today = datetime.date.today().isoformat()
        self.write_stamp('ygo_cards', today, mtime=old)
        self.write_stamp('mtg_cards', today, mtime=old)
        (self.dest / 'ygo_cards' / 'verify_run.json').write_text(json.dumps({
            'transport_failures': 0, 'ok': True, 'label': 'verified', 'publish': True,
        }))
        saved, health, code, state, out, _build = self.gate()
        self.assertEqual(saved['freshness'], 'current', saved)
        self.assertTrue(saved['last_attempt_ok'])
        self.assertEqual(saved['verified_at'], mtg_at)
        self.assertNotIn('mtime', saved)
        self.assertNotEqual(saved['verified_at'], today)
        self.assertEqual(health['freshness'], 'current', health)
        self.assertEqual(health['verified_at'], mtg_at)
        self.assertTrue(health['last_attempt_ok'])
        self.assertEqual(code, 0, out + json.dumps(state))
        self.assertNotEqual(state['level'], 'FAIL')
        fresh = state['incidents'].get('freshness')
        self.assertTrue(fresh is None or (fresh.get('status') == 'OK' and not fresh.get('unresolved')))
        self.assertEqual(state['incidents']['backup']['status'], 'DEFERRED')
        self.assertEqual(state['provenance'], mtg_at)

    def test_stale_stamp_mtime_is_not_freshness_and_prepublish_fails(self):
        recent = iso_hours_ago(1)
        self.write_cards(recent, recent)
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        now = datetime.datetime.now().timestamp()
        self.write_stamp('ygo_cards', yesterday, mtime=now)
        self.write_stamp('mtg_cards', yesterday, mtime=now)
        saved, health, code, state, out, _build = self.gate()
        self.assertEqual(saved['freshness'], 'stale', saved)
        self.assertNotEqual(saved['freshness'], 'current')
        self.assertFalse(saved['last_attempt_ok'])
        self.assertNotEqual(health['freshness'], 'current')
        self.assertEqual(code, 1, out)
        self.assertEqual(state['level'], 'FAIL')
        self.assertEqual(state['incidents']['freshness']['status'], 'DEGRADED')
        self.assertTrue(state['incidents']['freshness']['unresolved'])

    def test_missing_stamp_keeps_prepublish_failing(self):
        recent = iso_hours_ago(1)
        self.write_cards(recent, recent)
        saved, health, code, state, out, _build = self.gate()
        self.assertEqual(saved['freshness'], 'unknown', saved)
        self.assertNotEqual(health['freshness'], 'current')
        self.assertFalse(saved['last_attempt_ok'])
        self.assertEqual(code, 1, out)
        self.assertTrue(state['incidents']['freshness']['unresolved'])

    def test_transport_stopped_run_keeps_prepublish_failing(self):
        recent = iso_hours_ago(1)
        self.write_cards(recent, recent)
        today = datetime.date.today().isoformat()
        self.write_stamp('mtg_cards', today)
        os.environ['CARD_ROOT'] = str(self.dest)
        os.environ['CARD_OPS'] = str(self.dest / 'card_ops')
        tracker = load_module(self.dest / 'ygo_cards' / 'tracker.py', 'ygo_tracker_fresh_' + self.dest.name)
        tracker.commit_stamp(False)
        self.assertFalse((self.dest / 'ygo_cards' / '.stamp').exists())
        saved, health, code, state, out, _build = self.gate()
        self.assertNotEqual(saved['freshness'], 'current', saved)
        self.assertNotEqual(health['freshness'], 'current')
        self.assertEqual(code, 1, out)
        self.assertTrue(state['incidents']['freshness']['unresolved'])

        # A later verify that logged transport=N cannot be papered over by today's stamps.
        self.write_stamp('ygo_cards', today)
        (self.dest / 'ygo_cards' / 'verify_run.json').write_text(json.dumps({
            'transport_failures': 2,
            'ok': False,
            'label': 'verification_unavailable',
            'publish': False,
        }))
        saved, health, code, state, out, _build = self.gate()
        self.assertEqual(saved['freshness'], 'verification_unavailable', saved)
        self.assertFalse(saved['last_attempt_ok'])
        self.assertEqual(saved['verified_at'], recent)
        self.assertNotEqual(health['freshness'], 'current')
        self.assertEqual(code, 1, out)
        self.assertEqual(state['level'], 'FAIL')
        self.assertTrue(state['incidents']['freshness']['unresolved'])

    def test_today_stamp_with_stale_verified_at_is_not_current(self):
        old = iso_hours_ago(40)
        self.write_cards(old, old)
        today = datetime.date.today().isoformat()
        self.write_stamp('ygo_cards', today)
        self.write_stamp('mtg_cards', today)
        saved, health, code, state, out, _build = self.gate()
        self.assertEqual(saved['freshness'], 'stale', saved)
        self.assertEqual(saved['verified_at'], old)
        self.assertNotEqual(health['freshness'], 'current')
        self.assertEqual(code, 1, out)
        self.assertTrue(state['incidents']['freshness']['unresolved'])


if __name__ == '__main__':
    unittest.main()
