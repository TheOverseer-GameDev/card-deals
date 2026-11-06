# Market shards

`scan/tools/export_market.py` writes one JSON file per print here:

`scan/market/<game>/<id>.json`

The browser loads a shard only after you confirm that catalog row. Until a shard exists, completed sales and asking prices stay **Unavailable**. The app does not invent a price, a sale, or a scenario.

These files are not in the service-worker install list. `scan/market/index.json` is an operator index, not a price.
