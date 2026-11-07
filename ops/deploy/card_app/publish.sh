#!/bin/sh
# zero-token daily publish: rebuild + push site/ to TheOverseer-GameDev/card-deals (gh-pages via main). Uses gh's existing auth; no secrets stored here.
# card_ops (2026-11-05): STOP switch, RAM floor, site doctor fix pass, MTG link test, gate with rollback to previous site/.
ROOT=${CARD_ROOT:-/workspace}
OPS=$ROOT/card_ops; GL=$OPS/gate.log; ts(){ date '+%F %T %Z'; }
mkdir -p "$OPS"
[ -f $ROOT/card_STOP ] && { echo "$(ts) card_STOP present - publish skipped" >> $GL; exit 0; }
[ -f $ROOT/card_PUBLISH_PAUSE ] && { echo "$(ts) card_PUBLISH_PAUSE present - publish skipped" >> $GL; exit 0; }
[ $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) -lt 2048 ] && { echo "$(ts) RAM < 2GB - publish deferred" >> $GL; exit 0; }
cd $ROOT/card_app || exit 1
nice -n 19 python3 $ROOT/ygo_cards/verify.py
vrc=$?
if [ "$vrc" -ne 0 ]; then echo "YGO verify unavailable or failed ($vrc) - not publishing"; echo "$(ts) FAIL ygo verify rc=$vrc" >> $GL; exit 1; fi
nice -n 19 python3 $ROOT/ygo_cards/verify.py --test
trc=$?
if [ "$trc" -ne 0 ]; then echo "YGO verify --test failed ($trc) - not publishing"; echo "$(ts) FAIL ygo verify --test rc=$trc" >> $GL; exit 1; fi
nice -n 19 python3 $OPS/doctor.py --fix || true
nice -n 19 python3 $ROOT/mtg_cards/test_verified_links.py > $OPS/mtg_linktest.log 2>&1 || { echo "MTG link test failed - not publishing"; echo "$(ts) FAIL mtg test_verified_links (see mtg_linktest.log)" >> $GL; exit 1; }
nice -n 19 python3 $OPS/prepublish.py --journey
prc=$?
if [ "$prc" -eq 3 ]; then echo "$(ts) phone journey deferred - not a pass" >> $GL; exit 3; fi
if [ "$prc" -ne 0 ]; then echo "$(ts) prepublish failed rc=$prc" >> $GL; exit 1; fi
nice -n 19 python3 $OPS/status.py >/dev/null 2>&1
[ -n "$CARD_E2E_STOP" ] && { echo "$(ts) gates finished (e2e stop)" >> $GL; exit 0; }
rm -rf $ROOT/card_app/site_prev && mkdir -p $ROOT/card_app/site_prev && (cd site && tar --exclude=.git -cf - .) | (cd $ROOT/card_app/site_prev && tar -xf -)
python3 build.py || exit 1
[ -n "$CARD_TEST_BREAK" ] && echo 'garbage(' >> site/data.js  # test hook: proves gate+rollback
if ! nice -n 19 python3 $OPS/doctor.py --gate > $OPS/gate_last.txt 2>&1; then
  (cd site_prev && tar -cf - .) | (cd site && tar -xf -)
  echo "$(ts) GATE FAIL - rolled back to previous site/: $(grep 'GATE FAIL' $OPS/gate_last.txt | head -5 | tr '\n' ';')" >> $GL; cat $OPS/gate_last.txt; exit 1
fi
echo "$(ts) gate PASS - publishing" >> $GL
[ -n "$CARD_DRYRUN" ] && { echo "dry run: not pushing"; exit 0; }
cd site && [ -d .git ] || { git init -q -b main && git remote add origin https://github.com/TheOverseer-GameDev/card-deals.git; }
git -c user.name="Card Deals Bot" -c user.email="redacted@example.invalid" add -A
git -c user.name="Card Deals Bot" -c user.email="redacted@example.invalid" commit -qm "daily update $(date +%F)" || true
git -c credential.helper= -c credential.helper='!/usr/local/bin/gh auth git-credential' push -q -u origin main
