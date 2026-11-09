"""Run the installed production scripts, not the helper modules in isolation."""
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'ops' / 'deploy'))
import install


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class ProductionCallSiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        os.environ['CARD_ROOT'] = str(self.dest)
        os.environ['CARD_OPS'] = str(self.dest / 'card_ops')
        install.apply(self.dest)
        sys.path.insert(0, str(self.dest / 'card_ops'))
        sys.path.insert(0, str(self.dest / 'ygo_cards'))
        sys.path.insert(0, str(self.dest / 'card_common'))
        self.tracker = load(self.dest / 'ygo_cards' / 'tracker.py', 'ygo_tracker_e2e')
        sys.modules['tracker'] = self.tracker

    def tearDown(self):
        self.tmp.cleanup()

    def test_verify_publish_doctor_and_discovery_use_the_installed_files(self):
        offer = {'url': 'https://www.ebay.com/itm/123456789012', 'price': 10, 'cad_total': 19.5, 'verified': True, 'vetted': True}
        latest = [{'q': 'Example|SET-EN001|Ultra Rare|', 'title': 'Example', 'score': 10, 'lr': offer}]
        (self.dest / 'ygo_cards' / 'latest.json').write_text(json.dumps(latest))
        fixture = self.dest / 'http.json'
        (self.dest / 'ygo_cards' / '.ebay_env').write_text('EBAY_CLIENT_ID=example\nEBAY_CLIENT_SECRET=example\n')
        fixture.write_text(json.dumps([
            {'url_contains': 'oauth2', 'status': 200, 'body': '{"access_token":"abc"}'},
            {'url_contains': 'get_item', 'status': 401, 'body': ''},
            {'url_contains': 'oauth2', 'status': 200, 'body': '{"access_token":"abc"}'},
            {'url_contains': 'get_item', 'status': 401, 'body': ''},
        ]))
        os.environ['CARD_HTTP_FIXTURE'] = str(fixture)
        os.environ['CARD_RUN_ID'] = 'verify-e2e'
        verify = load(self.dest / 'ygo_cards' / 'verify.py', 'ygo_verify_e2e')
        self.assertEqual(verify.main(test=False), 2)
        saved = json.loads((self.dest / 'ygo_cards' / 'latest.json').read_text())
        self.assertIsNone(saved[0]['lr'])
        self.assertEqual(saved[0]['retained_offers']['lr']['cad_total'], 19.5)
        self.assertNotIn('ended', saved[0])
        self.assertEqual(saved[0]['listing_state'], 'verification_unavailable')
        self.assertIn('401', saved[0]['retained_offers']['lr']['hidden_reason'])
        self.assertEqual(verify.main(test=True), 2)
        report = json.loads((self.dest / 'ygo_cards' / 'verify_run.json').read_text())
        self.assertGreater(report['transport_failures'], 0)
        self.assertFalse(report['publish'])

        proc = subprocess.run(
            ['sh', str(self.dest / 'card_app' / 'publish.sh')],
            cwd=self.dest / 'card_app',
            env={**os.environ, 'CARD_E2E_STOP': '1', 'CARD_RUN_ID': 'publish-e2e', 'CARD_HTTP_FIXTURE': ''},
            text=True, capture_output=True,
        )
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn('not publishing', proc.stdout + proc.stderr)
        self.assertNotIn('gate PASS', (self.dest / 'card_ops' / 'gate.log').read_text())

        doctor = load(self.dest / 'card_ops' / 'doctor.py', 'doctor_e2e')
        calls = []

        def http(u, h=None, t=25):
            calls.append(u)
            return 401, b'', {}

        doctor.http = http
        os.environ['CARD_RUN_ID'] = 'doctor-e2e'
        row = {'q': 'Example|SET-EN001|Ultra Rare|', 'title': 'Example [Ultra Rare] SET-EN001 Prices', 'score': 5, 'lr': dict(offer)}
        path = self.dest / 'card_ops' / 'sample.json'
        path.write_text(json.dumps([row]))
        counts, log = doctor.fix(fetch=lambda i: doctor.fetch_item('token', i), files={'ygo': str(path)}, tok='token')
        saved = json.loads(path.read_text())
        self.assertIsNone(saved[0]['lr'])
        self.assertEqual(saved[0]['retained_offers']['lr']['cad_total'], 19.5)
        self.assertNotIn('ended', saved[0])
        self.assertGreaterEqual(counts.get('retained', 0), 1)
        self.assertLessEqual(len(calls), 2)
        self.assertTrue(any('retained' in line for line in log))

        db_path = self.dest / 'ygo_cards' / 'queue.db'
        db = sqlite3.connect(db_path)
        db.execute('create table queue(key,pri,last_checked)')
        db.executemany('insert into queue values(?,?,0)', [('a', 1), ('b', 1)])
        work = self.tracker.next_work(db, 1, 1)
        self.assertEqual([item['key'] for item in work['discover']], ['a'])
        self.tracker.mark_queue(db, 'a', 1, 'transport', 10)
        db.commit()
        checked = db.execute('select last_checked from queue where key=?', ('a',)).fetchone()[0]
        self.assertEqual(checked, 0)
        self.assertFalse((self.dest / 'ygo_cards' / '.stamp').exists())
        self.tracker.commit_stamp(False)
        self.assertFalse((self.dest / 'ygo_cards' / '.stamp').exists())
        self.tracker.commit_stamp(True)
        self.assertTrue((self.dest / 'ygo_cards' / '.stamp').exists())

        self.assertEqual(self.tracker.public_metrics({'a': {'raw': 10}, 'lr': {}}), {})
        sourced = self.tracker.public_metrics({'lr': {'cad_total': 12.5}, 'hold_sourced': True, 'hold_cad': 3, 'ret_pct': 4})
        self.assertEqual(sourced['cost_cad'], 12.5)
        self.assertEqual(sourced['hold_cad'], 3)
        self.assertNotIn(14, sourced.values())

        (self.dest / 'ygo_cards' / 'ygopro.json').write_text(json.dumps({
            'data': [{
                'name': 'Accesscode Talker', 'id': 15032,
                'misc_info': [{'views': 1}],
                'card_sets': [{'set_code': 'LAVD-EN034', 'set_rarity': 'Ultra Rare'}],
            }],
        }))
        (self.dest / 'ygo_cards' / 'cardsets.json').write_text('[]')
        universe, _meta = self.tracker.universe()
        self.assertTrue(any('LAVD-ENO34' in key for key in universe))
        self.assertFalse(any('LAVD-EN034' in key for key in universe))

        categories = load(self.dest / 'card_common' / 'categories.py', 'categories_e2e')
        hidden = {'lr': {'url': 'https://www.ebay.com/itm/123456789012', 'verified': True, 'vetted': True, 'price': 5, 'cad_total': 8, 'listing_state': 'verification_unavailable'}}
        self.assertIsNone(categories.offer(hidden))

        keepalive = (self.dest / 'yugioh' / 'keepalive.sh').read_text()
        self.assertEqual(keepalive.count('supervisor_periodic.py'), 1)
        self.assertEqual(keepalive.count('while true'), 1)
        mtg = (self.dest / 'mtg_cards' / 'tracker.py').read_text()
        self.assertIn('ygo_tracker.get', mtg)
        self.assertIn('ygo_tracker.next_work', mtg)
        self.assertNotIn("open(P('.stamp'), 'w').write", mtg.split('def main', 1)[1].split('transport_stopped', 1)[0])

    def test_periodic_supervisor_reports_backup_pending_and_low_ram_deferred(self):
        # The published catalog's verified_at ages out of the 36h window. This
        # check is about backup and memory, so it uses a fixture site with no offers.
        # The periodic supervisor reads the built site checkout under CARD_ROOT/card_app/site.
        site = self.dest / 'card_app' / 'site'
        site.mkdir(parents=True, exist_ok=True)
        (site / 'index.html').write_text('<script src="scan/boot.js"></script>')
        (site / 'version.json').write_text('{"v":"1"}')
        (site / 'sw.js').write_text(
            "const C='cd3-1';\nscan/boot.js\nscan/engine.js\nscan/prices.js\nscan/scan.css\n"
            "\\.(html|json|js|css)$\n"
        )
        (site / 'manifest.json').write_text('{"display":"standalone","icons":[{"src":"icon-192.png"}]}')
        (site / 'data.js').write_text(
            'window.D={"health":{"freshness":"current","level":"ok"},"ygo":{"cards":[]},"mtg":{"cards":[]}};'
        )
        for rel in ('scan/boot.js', 'scan/engine.js', 'scan/prices.js', 'scan/scan.css'):
            path = site / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// fixture\n')
        env = {**os.environ, 'CARD_ROOT': str(self.dest), 'CARD_SUPERVISOR_FORCE': '1', 'CARD_BACKUP_MANIFEST': ''}
        proc = subprocess.run([sys.executable, str(self.dest / 'card_ops' / 'supervisor_periodic.py')], env=env, text=True, capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn('DEGRADED', proc.stdout)
        self.assertIn('pending', proc.stdout)
        state = json.loads((self.dest / 'card_ops' / 'supervisor_state.json').read_text())
        self.assertNotEqual(state['level'], 'OK')
        self.assertFalse(state['incidents']['backup'].get('status') == 'OK')
        env['CARD_MEM_MB'] = '500'
        env['CARD_SUPERVISOR_FORCE'] = '1'
        low = subprocess.run([sys.executable, str(self.dest / 'card_ops' / 'supervisor_periodic.py')], env=env, text=True, capture_output=True)
        self.assertEqual(low.returncode, 0, low.stdout + low.stderr)
        self.assertIn('DEFERRED', low.stdout)
        state = json.loads((self.dest / 'card_ops' / 'supervisor_state.json').read_text())
        self.assertEqual(state['incidents']['memory']['status'], 'DEFERRED')
        self.assertTrue(state['incidents']['memory']['unresolved'])
        self.assertNotEqual(state['level'], 'OK')


if __name__ == '__main__':
    unittest.main()
