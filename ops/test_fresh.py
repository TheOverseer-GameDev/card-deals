"""Fresh-process checks. No inherited PYTHONPATH or imported modules."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'ops' / 'deploy'))
import install

MARKER = 'STAGING-ONLY-7f3c9a'


def isolated_env(dest, **extra):
    env = {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
        'HOME': '/tmp',
        'CARD_ROOT': str(dest),
        'PYTHONDONTWRITEBYTECODE': '1',
    }
    env.update(extra)
    return env


def run_isolated(args, env, cwd=None):
    return subprocess.run(
        [sys.executable, '-I', *args],
        env=env, cwd=cwd, text=True, capture_output=True,
    )


LOAD = textwrap.dedent('''
import importlib.util, os, sys
path = os.environ["ENTRY"]
sys.path.insert(0, os.path.dirname(path))
spec = importlib.util.spec_from_file_location("entry", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
action = os.environ["ACTION"]
if action == "tracker":
    result = mod.fetch_status(
        "https://fixture.invalid/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=1",
        run_id="fresh")
    if result.get("action") != "ok" or "STAGING-HTTP" not in result.get("body", ""):
        raise SystemExit(repr(result))
    print("tracker-ok")
elif action == "mtg":
    result = mod.get(
        "https://fixture.invalid/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=1")
    if "STAGING-HTTP" not in result[1]:
        raise SystemExit(repr(result))
    print("mtg-ok")
elif action == "doctor":
    def http(u, h=None, t=25):
        return 401, b"", {}
    mod.http = http
    got = mod.fetch_item("token", "123456789012")
    if not got.get("retain") or "401" not in str(got.get("transport")):
        raise SystemExit(repr(got))
    print("doctor-ok")
else:
    raise SystemExit("unknown action")
''')


class FreshProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        install.apply(self.dest)
        self.env = isolated_env(self.dest)

    def tearDown(self):
        self.tmp.cleanup()

    def test_tracker_fetch_status_finds_quota_without_inherited_path(self):
        fixture = self.dest / 'http.json'
        fixture.write_text(json.dumps([
            {'url_contains': 'get_item', 'status': 200, 'body': 'STAGING-HTTP'},
        ]))
        env = dict(self.env, ENTRY=str(self.dest / 'ygo_cards' / 'tracker.py'),
                   ACTION='tracker', CARD_HTTP_FIXTURE=str(fixture), CARD_RUN_ID='fresh-tracker')
        proc = run_isolated(['-c', LOAD], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('tracker-ok', proc.stdout)
        self.assertNotIn('ModuleNotFoundError', proc.stderr)

    def test_mtg_get_and_doctor_fetch_use_the_same_guard(self):
        fixture = self.dest / 'http.json'
        fixture.write_text(json.dumps([
            {'url_contains': 'get_item', 'status': 200, 'body': 'STAGING-HTTP'},
        ]))
        env = dict(self.env, ENTRY=str(self.dest / 'mtg_cards' / 'tracker.py'),
                   ACTION='mtg', CARD_HTTP_FIXTURE=str(fixture), CARD_RUN_ID='fresh-mtg')
        proc = run_isolated(['-c', LOAD], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('mtg-ok', proc.stdout)
        env = dict(self.env, ENTRY=str(self.dest / 'card_ops' / 'doctor.py'),
                   ACTION='doctor', CARD_RUN_ID='fresh-doctor')
        proc = run_isolated(['-c', LOAD], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('doctor-ok', proc.stdout)

    def test_verify_script_exits_unavailable_without_a_token(self):
        (self.dest / 'ygo_cards' / 'latest.json').write_text(json.dumps([
            {'q': 'Example|SET-EN001|Ultra Rare|', 'title': MARKER, 'score': 1,
             'lr': {'url': 'https://www.ebay.com/itm/123456789012', 'price': 4, 'cad_total': 5, 'verified': True}},
        ]))
        proc = run_isolated([str(self.dest / 'ygo_cards' / 'verify.py')], self.env)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        saved = json.loads((self.dest / 'ygo_cards' / 'latest.json').read_text())
        self.assertIsNone(saved[0]['lr'])
        self.assertEqual(saved[0]['retained_offers']['lr']['cad_total'], 5)
        self.assertIn(MARKER, saved[0]['title'])

    def test_staged_build_reads_only_the_card_root_fixture(self):
        row = {'title': MARKER, 'url': 'https://example.invalid/staging-only-7f3c9a', 'raw': 3, 'score': 1}
        (self.dest / 'ygo_cards' / 'latest.json').write_text(json.dumps([row]))
        (self.dest / 'mtg_cards' / 'latest.json').write_text(json.dumps([row]))
        (self.dest / 'card_app' / 'index.tpl.html').write_text('<html>__V__</html>\n')
        stub = self.dest / 'card_app' / 'site' / 'scan' / 'tools'
        stub.mkdir(parents=True)
        (stub / 'integrate.py').write_text('raise SystemExit(0)\n')
        guard = textwrap.dedent('''
        import os, runpy, sys
        def hook(event, args):
            if event == "open":
                path = args[0].decode() if isinstance(args[0], bytes) else args[0]
                if isinstance(path, str) and path.startswith("/workspace"):
                    raise SystemExit("production open " + path)
            if event in ("socket.connect", "socket.getaddrinfo"):
                raise SystemExit("network " + event)
        sys.addaudithook(hook)
        runpy.run_path(os.environ["ENTRY"], run_name="__main__")
        ''')
        env = dict(self.env, ENTRY=str(self.dest / 'card_app' / 'build.py'))
        proc = run_isolated(['-c', guard], env, cwd=self.dest / 'card_app')
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        data = (self.dest / 'card_app' / 'site' / 'data.js').read_text()
        self.assertIn(MARKER, data)
        self.assertNotIn('SAMPLE – Mox Pearl', data)
        env['ENTRY'] = str(self.dest / 'card_app' / 'build_market_input.py')
        (self.dest / 'ygo_cards' / 'latest.json').write_text(json.dumps([{
            'title': MARKER, 'url': 'https://example.invalid/STAGING-ONLY-7f3c9a',
            'lr': {'url': 'https://example.invalid/STAGING-ONLY-7f3c9a', 'verified': True,
                   'verified_at': '2026-11-07T00:00:00+00:00', 'cad_total': 5, 'price': 4},
        }]))
        proc = run_isolated(['-c', guard], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        market = (self.dest / 'ygo_cards' / 'market.json').read_text()
        self.assertIn(MARKER, market)
        self.assertNotIn('/workspace/', market)

    def test_link_test_and_periodic_supervisor_stay_inside_card_root(self):
        (self.dest / 'mtg_cards' / 'latest.json').write_text('[]')
        guard = textwrap.dedent('''
        import os, runpy, sys
        def hook(event, args):
            if event == "open":
                path = args[0].decode() if isinstance(args[0], bytes) else args[0]
                if isinstance(path, str) and path.startswith("/workspace"):
                    raise SystemExit("production open " + path)
            if event in ("socket.connect", "socket.getaddrinfo"):
                raise SystemExit("network " + event)
        sys.addaudithook(hook)
        runpy.run_path(os.environ["ENTRY"], run_name="__main__")
        ''')
        env = dict(self.env, ENTRY=str(self.dest / 'mtg_cards' / 'test_verified_links.py'))
        proc = run_isolated(['-c', guard], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('PASS', proc.stdout)
        env = dict(self.env, CARD_MEM_MB='500', CARD_SUPERVISOR_FORCE='1')
        proc = run_isolated([str(self.dest / 'card_ops' / 'supervisor_periodic.py')], env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('DEFERRED', proc.stdout)
        state = json.loads((self.dest / 'card_ops' / 'supervisor_state.json').read_text())
        self.assertEqual(state['incidents']['memory']['status'], 'DEFERRED')
        self.assertNotEqual(state['level'], 'OK')
