# Tracker repair and health checks

Operational sources live on the machine under `/workspace` and are not in this repo. Copy the modules below back. Do not run them against live eBay from this change, and do not merge on the strength of these tests alone.

The 26 YGO offers already removed by the old verifier (24 HTTP 401, 2 rate limits) are not in this repo. Nothing here restores them. A row is recoverable only when `retained_offers` is still present.

## What the packaged sources were doing

- `ygo_cards/verify.py` set `lr`/`lg` to null on every failure, including `getItem failed` after 401 or a rate limit. `publish.sh` then ran `verify.py --test`, which saw no links and exited 0.
- `ygo_cards/tracker.py` rewrote any set code matching `O` before digits, so the printed code `LAVD-ENO34` became the guess `LAVD-EN034`. Yugipedia and the Legendary Arc-V set list print Accesscode Talker as `LAVD-ENO34` (password `86066372`, Konami `15032`). Only that identity may undo `LAVD-EN034`. Other `ENO` codes stay as printed.
- `final_rank` left `hold_cad` / `ret_pct` unset when the offer was not vetted, and the row dump used `cost_cad or raw * fx`. Missing sourced cost must stay missing.
- The queue stamp was written at the start of a run, discovery and refresh shared one daily slot, and publish never advanced the queue. A transport error must stay `pending`, not completed.
- Keepalive runs trackers daily and publish hourly. This does not add a second loop.

## Copy back

| In this repo | Copy to |
| --- | --- |
| `ops/quota.py` | `/workspace/card_ops/quota.py` |
| `ops/verify_outcome.py` | `/workspace/card_ops/verify_outcome.py` |
| `ops/metrics.py` | `/workspace/card_ops/metrics.py` |
| `ops/discovery.py` | `/workspace/card_ops/discovery.py` |
| `ops/print_key.py` | `/workspace/card_ops/print_key.py` |
| `ops/freshness.py` | `/workspace/card_ops/freshness.py` |
| `ops/supervisor.py` | `/workspace/card_ops/supervisor.py` |
| `ops/prepublish.py` | `/workspace/card_ops/prepublish.py` |
| `ops/backup_check.py` | `/workspace/card_ops/backup_check.py` |

Call sites, still on the machine:

- `ygo_cards/tracker.py` `get()` and `mtg_cards/tracker.py` `get()`: on 401/429 call `Guard.handle` instead of sleeping and raising. Do not mark the queue row completed on transport.
- Delete the `O` to `0` substitution. Call `print_key.resolve(code, password=card_id)`.
- Persist metrics with `metrics.emit_metrics`. Do not fill cost from `raw * fx`.
- `ygo_cards/verify.py`: `apply_result` for transport, `finish_run` for the exit code. Exit 2 means do not publish. `--test` must read that record and must not pass just because no links remain.
- Split discovery (`discovery.plan`, untouched `pending` first) from listing refresh. Publish does not discover. A successful run is the only thing that should refresh a daily stamp.
- `doctor.py` `fetch_item`: 401 and 429 hide the offer and keep `retained_offers`. 404/410 still count as ended. Do not treat an empty recheck as success.
- `publish.sh`: after verify, exit 1 on code 2. Then `python3 /workspace/card_ops/prepublish.py --journey`. Exit 3 is deferred, not a pass. Honor `/workspace/card_STOP` and `/workspace/card_PUBLISH_PAUSE`. RAM under 2 GB skips the phone journey with status `deferred`.
- `keepalive.sh`: keep the existing loop. About every 2 minutes, if RAM is at least 2 GB and stop is absent, run `python3 /workspace/card_ops/supervisor.py` only if you add a one-shot `--periodic` wrapper later. Do not start a second `while true`. Phone journey cadence is 6 hours (`consider_journey`), also from prepublish.
- `index.tpl.html`: same `liveBuy` / freshness strings as `index.html`. `scan/tools/integrate.py` puts them back when the generator still emits the old lines. The freshness line is hidden while `html.scan-cam` is on, so capture stays camera-only. Results use `#scan-freshness` inside the panel.

## Supervisor

Zero-token, no model calls, no purchases, no messages. Allowlist only: reapply integration, restart a crashed managed worker (cap 3, refused while `card_STOP` or under 2 GB), refresh auth once, record a 429 cooldown, quarantine a bad offer, retry publish only after the gate passed, restore last-known-good as containment. Containment stays unresolved. An unknown incident is not cleared by a later healthy pass. The report says it does not see every failure.

## Backup

`CARD_BACKUP_MANIFEST` may point at the Overseer nightly manifest. If it is unset or missing, the result is `pending` / not tested. The checker copies into a temp directory, checks sha256, required roles, and card-list shape, then deletes the temp directory. It does not write to the source. A synthetic manifest is never `restoration_verified`.

## Tests

```sh
python3 -m unittest discover -s ops -p 'test_*.py'
python3 -m unittest scan.test.test_tools
node --test --test-timeout 180000 scan/test/journey.test.js
node --test --test-timeout 180000 scan/test/browser.test.js
python3 ops/prepublish.py --journey
```

`scan/test/journey.test.js` is headless Chrome with a fake camera and a local server. It is not a phone and it does not open eBay.

## Limits

Headless only. The erased 26 offers are not recovered. Installed PWA on hardware was not opened. No live eBay call was made. The supervisor does not catch every fault. A passed isolated backup check is not a production restore.
