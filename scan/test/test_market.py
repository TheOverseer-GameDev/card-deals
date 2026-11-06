import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from export_market import build_market


class MarketExportTests(unittest.TestCase):
    def test_rejects_zero_missing_source_and_cross_label(self):
        now = datetime(2026, 11, 6, tzinfo=timezone.utc)
        doc = {
            "prints": [
                {
                    "game": "ygo",
                    "id": "abc",
                    "released_at": "2024-06-01T00:00:00Z",
                    "sales": [
                        {
                            "price": 12.5,
                            "currency": "USD",
                            "source": "PriceCharting",
                            "observed_at": "2026-11-01T00:00:00Z",
                            "condition": "Ungraded",
                        },
                        {
                            "price": 0,
                            "currency": "USD",
                            "source": "PriceCharting",
                            "observed_at": "2026-11-01T00:00:00Z",
                        },
                        {
                            "price": 40,
                            "currency": "USD",
                            "source": "Shop",
                            "observed_at": "2026-11-01T00:00:00Z",
                            "kind": "ask",
                            "condition": "PSA 10",
                        },
                    ],
                    "asks": [
                        {
                            "price": 20,
                            "currency": "USD",
                            "source": "eBay",
                            "observed_at": "2026-11-02T00:00:00Z",
                            "condition": "PSA 10",
                        },
                        {
                            "price": 8,
                            "currency": "USD",
                            "observed_at": "2026-11-02T00:00:00Z",
                        },
                    ],
                    "scenarios": [{"tag": "reprint-risk", "note": "Reprint exists."}],
                },
                {"id": "nope", "sales": [{"price": 5, "currency": "USD", "source": "Shop", "observed_at": "2026-11-01T00:00:00Z"}]},
            ]
        }
        out = build_market([doc], now)
        kept = out["prints"]["ygo:abc"]
        self.assertEqual(len(kept["sales"]), 1)
        self.assertEqual(kept["sales"][0]["kind"], "sold")
        self.assertEqual(kept["sales"][0]["condition"], "Ungraded")
        self.assertEqual(len(kept["asks"]), 1)
        self.assertEqual(kept["asks"][0]["condition"], "PSA 10")
        self.assertEqual(kept["asks"][0]["kind"], "ask")
        self.assertTrue(all(row["kind"] != "ask" for row in kept["sales"]))
        self.assertTrue(all(row["kind"] != "sold" for row in kept["asks"]))
        reasons = [item["reason"] for item in out["rejected"]]
        self.assertIn("price must be a positive number", reasons)
        self.assertIn("cross-label", reasons)
        self.assertIn("source is missing", reasons)
        self.assertIn("exact print id missing", reasons)
        self.assertEqual(kept["scenarios"][0]["tag"], "reprint-risk")


if __name__ == "__main__":
    unittest.main()
