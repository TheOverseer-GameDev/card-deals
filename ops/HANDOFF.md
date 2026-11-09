# Tracker repair and health checks

Operational sources live on the machine under `/workspace` and are not in this repo. Copy the modules below back. Do not run them against live eBay from this change, and do not merge on the strength of these tests alone.

The 26 YGO offers already removed by the old verifier (24 HTTP 401, 2 rate limits) are not in this repo. Nothing here restores them. A row is recoverable only when `retained_offers` is still present.

## What the packaged sources were doing

- `ygo_cards/verify.py` set `lr`/`lg` to null on every failure, including `getItem failed` after 401 or a rate limit. `publish.sh` then ran `verify.py --test`, which saw no links and exited 0.
- `ygo_cards/tracker.py` rewrote any set code matching `O` before digits, so the printed code `LAVD-ENO34` became the guess `LAVD-EN034`. Yugipedia and the Legendary Arc-V set list print Accesscode Talker as `LAVD-ENO34` (password `86066372`, Konami `15032`). Only that identity may undo `LAVD-EN034`. Other `ENO` codes stay as printed.
- `final_rank` left `hold_cad` / `ret_pct` unset when the offer was not vetted, and the row dump used `cost_cad or raw * fx`. Missing sourced cost must stay missing.
- The queue stamp was written at the start of a run, discovery and refresh shared one daily slot, and publish never advanced the queue. A transport error must stay `pending`, not completed.
- Keepalive runs trackers daily and publish hourly. This does not add a second loop.

## Deployable tree

`ops/deploy/` is the patched production source. `python3 ops/deploy/install.py` only prints the mapping. `python3 ops/deploy/install.py --apply <staging-dir>` copies it. The script refuses `--apply /workspace`. Nothing in this PR has been copied onto the live machine.

| Staged file | Production path | What the file itself calls |
| --- | --- | --- |
| `ops/quota.py` and the other helpers | `/workspace/card_ops/` | library used by the scripts below |
| `ops/supervisor_periodic.py` | `/workspace/card_ops/supervisor_periodic.py` | one keepalive tick, 120s gap, no extra loop |
| `ops/deploy/ygo_cards/tracker.py` | `/workspace/ygo_cards/tracker.py` | `fetch_status` → `Guard.handle`; `normalize_set_code`; `next_work` / `mark_queue`; `public_metrics`; `commit_stamp` only after a run that was not stopped for transport |
| `ops/deploy/ygo_cards/verify.py` | `/workspace/ygo_cards/verify.py` | `fetch_status`, `apply_result`, `finish_run`; exit 2 after transport; `--test` reads `verify_run.json` and does not pass on an empty list |
| `ops/deploy/mtg_cards/tracker.py` | `/workspace/mtg_cards/tracker.py` | `ygo_tracker.get` and `ygo_tracker.next_work`; stamp written at the end, not the start; transport 401/429/503 stops the batch |
| `ops/deploy/card_ops/doctor.py` | `/workspace/card_ops/doctor.py` | `fetch_item` → `Guard.handle`; transport result calls `apply_result` and keeps `retained_offers` |
| `ops/deploy/card_app/publish.sh` | `/workspace/card_app/publish.sh` | verify exit non-zero stops publish; then `prepublish.py --journey`; exit 3 is deferred |
| `ops/deploy/card_app/build.py` | `/workspace/card_app/build.py` | `freshness.health_fields`; still calls `scan/tools/integrate.py` |
| `ops/deploy/card_app/index.tpl.html` | `/workspace/card_app/index.tpl.html` | `build.py` renders `index.html` from it; must equal the repo `index.html` apart from the version (`ops/test_publish_fixes.py`) |
| `ops/deploy/card_common/categories.py` | `/workspace/card_common/categories.py` | hidden `listing_state` is not rankable |
| `ops/deploy/yugioh/keepalive.sh` | `/workspace/yugioh/keepalive.sh` | the existing loop calls `supervisor_periodic.py` once per pass |
| `ops/deploy/card_ops/capok.sh`, `doctor_cycle.sh`, `status.py` | same names under `/workspace/card_ops/` | `CARD_ROOT` / `card_STOP`; RAM floor unchanged |

`CARD_ROOT` defaults to `/workspace`. Do not overwrite an existing `config.json` on the machine; the staged configs are the allowlisted keys from the audit package. The 26 already-deleted offers are still not recovered.

Staging check, from a clean temp directory (this is what `ops/test_e2e.py` runs):

```sh
python3 -m unittest ops.test_e2e ops.test_repair ops.test_supervisor ops.test_backup
```

Observed on this run: installed `verify.py` hid the offer after HTTP 401 (`transport 401`), kept `cad_total` 19.5, did not mark it ended, and `--test` exited 2. `publish.sh` then exited 1 and did not print `gate PASS`. `doctor.fix` retained the offer. A transport queue row stayed `last_checked=0` and no success stamp was written. `LAVD-EN034` with Konami id 15032 became `LAVD-ENO34`. `supervisor_periodic.py` printed `DEGRADED pending` with no backup manifest, and `DEFERRED` at 500 MB.

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

`ops/test_fresh.py` reruns the installed entrypoints with `python3 -I` and an empty `PYTHONPATH`. `fetch_status` adds `card_ops` to `sys.path` before importing `quota`. `build.py` and `build_market_input.py` read `CARD_ROOT`. A fixture titled `STAGING-ONLY-7f3c9a` shows up in the staged `data.js`, and that process does not open `/workspace` or the network.

`scan/test/journey.test.js` is headless Chrome with a fake camera and a local server. It is not a phone and it does not open eBay.

## Limits

Headless only. The erased 26 offers are not recovered. Installed PWA on hardware was not opened. No live eBay call was made. The supervisor does not catch every fault. A passed isolated backup check is not a production restore.

## Box publish fixes (2026-11-09)

These match what is installed on the box byte for byte.

- `index.tpl.html` is rebuilt from the merged `index.html` with the three `__V__` placeholders. Before this, a rebuild undid the stale-buy and CAD changes.
- `prepublish.py` reads `CARD_SITE` (the site checkout) and writes state to `CARD_PREPUBLISH_STATE`. Without them it looked at `/workspace` itself.
- `supervisor_periodic.py` reads `CARD_SITE`, defaulting to `$CARD_ROOT/card_app/site`.
- `publish.sh` runs `prepublish.py --journey` on the new build, after `doctor.py --gate` and before `gate PASS`. A fail (1) or a deferred journey (3) restores `site_prev` like the doctor gate does. Before this, it checked the previous site, so old data blocked every publish.
- `build.py` keeps `scan/test`, which is tracked in git and needed by the journey. It still drops `scan/bench` and npm files.
- The bot commit email is `bot@users.noreply.github.com` again.
