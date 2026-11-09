import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from export_verified_prices import merge
from integrate import apply, integrated, patch_index, patch_sw


class IntegrateTests(unittest.TestCase):
    def test_hooks_are_idempotent_and_keep_the_fetch_guard(self):
        index = "<html><body><p>Hi</p></body></html>"
        sw = (
            "const C='cd3-1',F=['./','index.html'];\n"
            "self.addEventListener('fetch',e=>{const r=e.request;if(r.method!='GET')return;"
            "const u=new URL(r.url);if(u.origin!=location.origin)return;"
            "const fresh=/\\.(html|json|js)$/.test(u.pathname);});"
        )
        once = patch_index(index)
        self.assertEqual(once, patch_index(once))
        self.assertIn('src="scan/boot.js"', once)
        self.assertEqual(once.count("scan/boot.js"), 1)
        patched = patch_sw(sw)
        self.assertEqual(patched, patch_sw(patched))
        self.assertIn("'scan/boot.js'", patched)
        self.assertIn("'scan/verified-prices.json'", patched)
        self.assertIn("'scan/prices.js'", patched)
        self.assertIn("'scan/charts.js'", patched)
        self.assertIn("'scan/gauges.js'", patched)
        self.assertIn("r.method!='GET'", patched)
        self.assertIn("u.origin!=location.origin", patched)
        self.assertNotIn("tesseract", patched)
        self.assertIn("\\.(html|json|js|css)$", patched)
        self.assertEqual(patched.count("\\.(html|json|js|css)$"), 1)
        gated = patch_index(
            "const offer=c=>[c.lr,c.lg].find(l=>l&&l.url&&l.verified===true&&l.vetted!==false);\n"
            "function btn(l,lab,cls){if(!l)return`<a class=\"btn g\">No live ${lab}</a>`;"
            "if(l.verified!==true||l.vetted===false)return`<a class=\"btn g mut\" href=\"${e(l.url)}\" target=_blank rel=noopener "
            "style=\"font-size:12px;font-weight:400\">${lab} (unverified)</a>`;"
        )
        self.assertIn("function liveBuy", gated)
        self.assertNotIn("(unverified)", gated)
        self.assertEqual(gated, patch_index(gated))

    def test_apply_puts_the_hook_back_after_a_generator_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text("<html><body><p>rebuilt</p></body></html>")
            (root / "sw.js").write_text("const C='cd3-1',F=['./','index.html'];\n")
            apply(root)
            index = (root / "index.html").read_text()
            sw = (root / "sw.js").read_text()
            self.assertTrue(integrated(index, sw))
            self.assertEqual(index.count("scan/boot.js"), 1)
            apply(root)
            self.assertEqual((root / "index.html").read_text().count("scan/boot.js"), 1)
            self.assertIn('id="card-freshness"', (root / "index.html").read_text())
            apply(root)
            self.assertEqual((root / "index.html").read_text().count('id="card-freshness"'), 1)


class ExportTests(unittest.TestCase):
    def test_only_complete_grades_survive_and_gaps_stay_absent(self):
        now = datetime(2026, 11, 5, tzinfo=timezone.utc)
        doc = {
            "prints": [
                {
                    "game": "ygo",
                    "id": "abc",
                    "grades": {
                        "psa8": {
                            "price": 12.5,
                            "currency": "USD",
                            "source": "PriceCharting",
                            "source_url": "https://www.pricecharting.com/x",
                            "observed_at": "2026-11-01T00:00:00Z",
                            "sales_count": 4,
                        },
                        "psa7": {
                            "price": 0,
                            "currency": "USD",
                            "source": "PriceCharting",
                            "observed_at": "2026-11-01T00:00:00Z",
                        },
                        "psa6": {
                            "price": 9,
                            "currency": "USD",
                            "observed_at": "2026-11-01T00:00:00Z",
                        },
                    },
                }
            ]
        }
        out = merge([doc], now)
        grades = out["prints"]["ygo:abc"]["grades"]
        self.assertEqual(list(grades), ["psa8"])
        self.assertEqual(grades["psa8"]["sales_count"], 4)
        self.assertNotIn("psa5", grades)
        self.assertNotIn("psa9", grades)
        self.assertTrue(any(item["grade"] == "psa7" for item in out["rejected"]))
        self.assertTrue(any(item["grade"] == "psa6" and "source" in item["reason"] for item in out["rejected"]))
        named = merge([{
            "prints": [{
                "game": "ygo",
                "id": "abc",
                "grades": {"gem": {"price": 10, "currency": "USD", "source": "Shop", "observed_at": "2026-11-01T00:00:00Z"}},
            }],
        }], now)
        self.assertEqual(named["prints"], {})
        self.assertTrue(any(item["reason"] == "unknown grade" for item in named["rejected"]))


if __name__ == "__main__":
    unittest.main()
