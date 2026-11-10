"""Box publish fixes (2026-11-09): template parity, prepublish on the new build,
CARD_SITE / CARD_PREPUBLISH_STATE, and scan/test kept by build.py."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'ops' / 'deploy'))
import install

DEPLOY = REPO / 'ops' / 'deploy'


def isolated_env(dest, **extra):
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': '/tmp',
           'CARD_ROOT': str(dest), 'PYTHONDONTWRITEBYTECODE': '1'}
    env.update(extra)
    return env


def stale_site(site):
    """A built site whose only offer is verified but far outside the 36h window."""
    site.mkdir(parents=True, exist_ok=True)
    old = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time() - 96 * 3600))
    data = {'health': {'level': 'ok', 'freshness': 'current'},
            'ygo': {'cards': [{'q': 'Example|SET-EN001|Ultra Rare|', 'name': 'Example',
                               'lr': {'url': 'https://www.ebay.com/itm/123456789012', 'verified': True,
                                      'vetted': True, 'verified_at': old, 'cad_total': 5}}]},
            'mtg': {'cards': []}}
    (site / 'data.js').write_text('window.D=' + json.dumps(data) + ';')


class TemplateParityTests(unittest.TestCase):
    def test_template_renders_to_the_published_index(self):
        tpl = (DEPLOY / 'card_app' / 'index.tpl.html').read_text()
        version = json.loads((REPO / 'version.json').read_text())['v']
        self.assertNotIn(version, tpl)
        self.assertEqual(tpl.count('__V__'), 3)
        for hook in ("chart.min.js?__V__", "data.js?__V__", "const VER='__V__'"):
            self.assertIn(hook, tpl)
        self.assertEqual(tpl.replace('__V__', version), (REPO / 'index.html').read_text())

    def test_installer_ships_the_template(self):
        self.assertIn('card_app/index.tpl.html', [rel for _, rel in install.mapping()])


class PublishOrderTests(unittest.TestCase):
    """Run the real publish.sh with every step it calls stubbed, so only its ordering is tested."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        install.apply(self.root)
        app = self.root / 'card_app'
        (app / 'site').mkdir()
        (app / 'site' / 'data.js').write_text('OLD')
        ok = 'raise SystemExit(0)\n'
        for rel in ('ygo_cards/verify.py', 'card_ops/doctor.py', 'mtg_cards/test_verified_links.py', 'card_ops/status.py'):
            (self.root / rel).write_text(ok)
        (app / 'build.py').write_text("open('site/data.js','w').write('NEW')\n")
        self.seen = self.root / 'prepublish_seen.json'
        stub = (
            'import json, os, sys\n'
            'site = os.environ.get("CARD_SITE", "")\n'
            'data = open(os.path.join(site, "data.js")).read() if site else None\n'
            'json.dump({"site": site, "state": os.environ.get("CARD_PREPUBLISH_STATE"), "argv": sys.argv[1:], "data": data},'
            ' open(SEEN, "w"))\n'
            'raise SystemExit(int(os.environ.get("STUB_RC", "0")))\n'
        ).replace('SEEN', repr(str(self.seen)))
        (self.root / 'card_ops' / 'prepublish.py').write_text(stub)

    def tearDown(self):
        self.tmp.cleanup()

    def publish(self, rc):
        env = isolated_env(self.root, STUB_RC=str(rc), CARD_DRYRUN='1')
        proc = subprocess.run(['sh', str(self.root / 'card_app' / 'publish.sh')], cwd=self.root / 'card_app',
                              env=env, text=True, capture_output=True)
        seen = json.loads(self.seen.read_text())
        data = (self.root / 'card_app' / 'site' / 'data.js').read_text()
        log = (self.root / 'card_ops' / 'gate.log').read_text()
        return proc, seen, data, log

    def test_prepublish_checks_the_new_build_with_site_and_state(self):
        proc, seen, data, log = self.publish(0)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(seen['data'], 'NEW')
        self.assertEqual(seen['site'], str(self.root / 'card_app' / 'site'))
        self.assertEqual(seen['state'], str(self.root / 'card_ops' / 'prepublish_state.json'))
        self.assertIn('--journey', seen['argv'])
        self.assertEqual(data, 'NEW')
        self.assertIn('gate PASS', log)

    def test_prepublish_failure_rolls_back_and_does_not_pass(self):
        proc, seen, data, log = self.publish(1)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertEqual(seen['data'], 'NEW')
        self.assertEqual(data, 'OLD')
        self.assertIn('prepublish failed rc=1', log)
        self.assertNotIn('gate PASS', log)

    def test_deferred_journey_rolls_back_and_exits_3(self):
        proc, seen, data, log = self.publish(3)
        self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
        self.assertEqual(data, 'OLD')
        self.assertIn('deferred', log)
        self.assertNotIn('gate PASS', log)

    def test_rollback_removes_generated_strays_and_keeps_other_files(self):
        (self.root / 'card_app' / 'build.py').write_text(
            "from pathlib import Path\n"
            "p = Path('site')\n"
            "(p / 'data.js').write_text('NEW')\n"
            "(p / 'h' / 'ygo').mkdir(parents=True)\n"
            "(p / 'h' / 'ygo' / 'stray.json').write_text('{}')\n"
            "(p / 'scan' / 'market' / 'mtg').mkdir(parents=True)\n"
            "(p / 'scan' / 'market' / 'mtg' / 'shard.json').write_text('{}')\n"
            "(p / 'keep-notes.txt').write_text('user')\n"
        )
        proc, _seen, data, log = self.publish(1)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertEqual(data, 'OLD')
        site = self.root / 'card_app' / 'site'
        self.assertFalse((site / 'h' / 'ygo' / 'stray.json').exists())
        self.assertFalse((site / 'scan' / 'market' / 'mtg' / 'shard.json').exists())
        self.assertEqual((site / 'keep-notes.txt').read_text(), 'user')
        self.assertIn('prepublish failed rc=1', log)

    def test_bot_author_email_is_the_noreply_address(self):
        text = (DEPLOY / 'card_app' / 'publish.sh').read_text()
        self.assertEqual(text.count('user.email="bot@users.noreply.github.com"'), 2)
        self.assertNotIn('example.invalid', text)


def load_cleaner():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'clean_generated', DEPLOY / 'card_app' / 'clean_generated.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CleanGeneratedSymlinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.site = self.root / 'site'
        self.prev = self.root / 'site_prev'
        self.victim = self.root / 'victim'
        self.site.mkdir()
        self.prev.mkdir()
        self.victim.mkdir()
        (self.victim / 'precious.json').write_text('keep')
        (self.victim / 'other.txt').write_text('keep')

    def tearDown(self):
        self.tmp.cleanup()

    def clean(self, site=None):
        return load_cleaner().clean(str(site or self.site), str(self.prev))

    def test_a_symlinked_generated_directory_is_not_followed(self):
        (self.site / 'h').symlink_to(self.victim, target_is_directory=True)
        market = self.root / 'market-victim'
        market.mkdir()
        (market / 'shard.json').write_text('outside')
        (self.site / 'scan').mkdir()
        (self.site / 'scan' / 'market').symlink_to(market, target_is_directory=True)
        self.clean()
        self.assertEqual((self.victim / 'precious.json').read_text(), 'keep')
        self.assertEqual((self.victim / 'other.txt').read_text(), 'keep')
        self.assertEqual((market / 'shard.json').read_text(), 'outside')
        self.assertTrue((self.site / 'h').is_symlink())
        self.assertTrue((self.site / 'scan' / 'market').is_symlink())

    def test_a_symlinked_file_does_not_delete_its_target(self):
        folder = self.site / 'h' / 'ygo'
        folder.mkdir(parents=True)
        (folder / 'link.json').symlink_to(self.victim / 'precious.json')
        self.clean()
        self.assertEqual((self.victim / 'precious.json').read_text(), 'keep')
        self.assertTrue((folder / 'link.json').is_symlink())

    def test_a_symlinked_site_root_cleans_only_the_real_tree(self):
        real = self.root / 'real-site'
        (real / 'h' / 'ygo').mkdir(parents=True)
        (real / 'h' / 'ygo' / 'stray.json').write_text('{}')
        (real / 'keep.txt').write_text('user')
        (real / 'h' / 'outside').symlink_to(self.victim, target_is_directory=True)
        linked = self.root / 'linked-site'
        linked.symlink_to(real, target_is_directory=True)
        self.clean(linked)
        self.assertFalse((real / 'h' / 'ygo' / 'stray.json').exists())
        self.assertEqual((real / 'keep.txt').read_text(), 'user')
        self.assertEqual((self.victim / 'precious.json').read_text(), 'keep')
        self.assertTrue((real / 'h' / 'outside').is_symlink())

    def test_an_empty_directory_symlink_does_not_abort_cleanup(self):
        empty = self.root / 'empty'
        empty.mkdir()
        (self.site / 'h').mkdir()
        (self.site / 'h' / 'emptylink').symlink_to(empty, target_is_directory=True)
        (self.site / 'h' / 'stray.json').write_text('{}')
        removed = self.clean()
        self.assertIn('h/stray.json', removed)
        self.assertFalse((self.site / 'h' / 'stray.json').exists())
        self.assertTrue((self.site / 'h' / 'emptylink').is_symlink())
        self.assertTrue(empty.is_dir())


class GateMessageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        install.apply(self.root)
        (self.root / 'ygo_cards' / 'latest.json').write_text('[]')
        (self.root / 'mtg_cards' / 'latest.json').write_text('[]')

    def tearDown(self):
        self.tmp.cleanup()

    def test_fix_reports_429_cooldown_instead_of_a_missing_token(self):
        (self.root / 'card_ops' / 'source_guard.json').write_text(json.dumps({
            'cooldown_until': time.time() + 90,
            'retry_after': 90,
            'reason': '429',
        }))
        proc = subprocess.run([sys.executable, str(self.root / 'card_ops' / 'doctor.py'), '--fix'],
                              env=isolated_env(self.root), text=True, capture_output=True)
        text = proc.stdout + proc.stderr
        self.assertIn('HTTP 429 cooldown', text)
        self.assertNotIn('no eBay token', text)
        status = subprocess.run([sys.executable, str(self.root / 'card_ops' / 'status.py')],
                                env=isolated_env(self.root), text=True, capture_output=True)
        self.assertIn('HTTP 429 cooldown', status.stdout)

    def test_mtg_link_test_does_not_pass_when_nothing_was_checked(self):
        proc = subprocess.run([sys.executable, str(self.root / 'mtg_cards' / 'test_verified_links.py')],
                              env=isolated_env(self.root), text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        self.assertIn('NOT CHECKED: 0 offers were checked', proc.stdout)
        self.assertNotIn('PASS all buy links verified', proc.stdout)

    def test_mtg_link_test_names_a_cooldown_when_nothing_was_checked(self):
        (self.root / 'card_ops' / 'source_guard.json').write_text(json.dumps({
            'cooldown_until': time.time() + 60,
            'retry_after': 60,
            'reason': '429',
        }))
        proc = subprocess.run([sys.executable, str(self.root / 'mtg_cards' / 'test_verified_links.py')],
                              env=isolated_env(self.root), text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        self.assertIn('HTTP 429 cooldown', proc.stdout)
        self.assertNotIn('PASS all buy links verified', proc.stdout)


class SiteRootTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        install.apply(self.root)
        self.site = self.root / 'card_app' / 'site'
        stale_site(self.site)

    def tearDown(self):
        self.tmp.cleanup()

    def run_py(self, script, *args, **env):
        # Same as publish.sh / keepalive: plain python3 with a clean environment.
        return subprocess.run([sys.executable, str(script), *args], env=isolated_env(self.root, **env),
                              text=True, capture_output=True)

    def test_prepublish_reads_card_site_and_writes_state_where_told(self):
        state = self.root / 'card_ops' / 'prepublish_state.json'
        proc = self.run_py(self.root / 'card_ops' / 'prepublish.py', CARD_SITE=str(self.site),
                           CARD_PREPUBLISH_STATE=str(state))
        # No --journey runner here, so the journey is deferred (exit 3); the level must still be FAIL.
        self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
        self.assertTrue(proc.stdout.startswith('FAIL '), proc.stdout)
        saved = json.loads(state.read_text())
        self.assertEqual(saved['incidents']['stale_buy']['status'], 'FAIL')
        self.assertFalse((self.site / 'ops').exists())
        self.assertFalse((self.root / 'ops').exists())

    def test_periodic_supervisor_reads_the_site_checkout_by_default(self):
        proc = self.run_py(self.root / 'card_ops' / 'supervisor_periodic.py', CARD_MEM_MB='4096', CARD_SUPERVISOR_FORCE='1')
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        state = json.loads((self.root / 'card_ops' / 'supervisor_state.json').read_text())
        self.assertEqual(state['incidents']['stale_buy']['status'], 'FAIL')


class BuildKeepsScanTestsTests(unittest.TestCase):
    def test_scan_test_survives_build_and_bench_does_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            install.apply(root)
            row = {'title': 'STAGING-ONLY-7f3c9a', 'url': 'https://example.invalid/x', 'raw': 3, 'score': 1}
            for game in ('ygo_cards', 'mtg_cards'):
                (root / game / 'latest.json').write_text(json.dumps([row]))
            site = root / 'card_app' / 'site'
            (site / 'scan' / 'tools').mkdir(parents=True)
            (site / 'scan' / 'tools' / 'integrate.py').write_text('raise SystemExit(0)\n')
            (site / 'scan' / 'test').mkdir()
            (site / 'scan' / 'test' / 'journey.test.js').write_text('// kept\n')
            (site / 'scan' / 'bench').mkdir()
            (site / 'scan' / 'bench' / 'run.js').write_text('// dropped\n')
            proc = subprocess.run([sys.executable, '-I', str(root / 'card_app' / 'build.py')], cwd=root / 'card_app',
                                  env=isolated_env(root), text=True, capture_output=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertTrue((site / 'scan' / 'test' / 'journey.test.js').is_file())
            self.assertFalse((site / 'scan' / 'bench').exists())
            version = json.loads((site / 'version.json').read_text())['v']
            tpl = (DEPLOY / 'card_app' / 'index.tpl.html').read_text()
            self.assertEqual((site / 'index.html').read_text(), tpl.replace('__V__', version))


if __name__ == '__main__':
    unittest.main()
