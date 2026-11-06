import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from export_verified_prices import merge
from integrate import patch_index, patch_sw


class IntegrateTests(unittest.TestCase):
    def test_hooks_are_idempotent_and_keep_the_fetch_guard(self):
        index = "<html><body><p>Hi</p></body></html>"
        sw = (
            "const C='cd3-1',F=['./','index.html'];\n"
            "self.addEventListener('fetch',e=>{const r=e.request;if(r.method!='GET')return;"
            "const u=new URL(r.url);if(u.origin!=location.origin)return;});"
        )
        once = patch_index(index)
        self.assertEqual(once, patch_index(once))
        self.assertIn('src="scan/boot.js"', once)
        self.assertEqual(once.count("scan/boot.js"), 1)
        patched = patch_sw(sw)
        self.assertEqual(patched, patch_sw(patched))
        self.assertIn("'scan/boot.js'", patched)
        self.assertIn("'scan/verified-prices.json'", patched)
        self.assertIn("r.method!='GET'", patched)
        self.assertIn("u.origin!=location.origin", patched)
        self.assertNotIn("tesseract", patched)


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


if __name__ == "__main__":
    unittest.main()
