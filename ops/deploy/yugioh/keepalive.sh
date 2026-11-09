#!/bin/sh
# zero-token: runs scout + testbot daily by wall clock (survives box sleep). RAM rule >=2GB.
ROOT=${CARD_ROOT:-/workspace}
S=$ROOT/yugioh
old(){ [ ! -f "$1" ] || [ $(( $(date +%s) - $(stat -c %Y "$1") )) -gt ${2:-86400} ]; }
while true; do
  FREE=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
  if [ "$FREE" -ge 2 ]; then
    if old $S/scout/.stamp && ! pgrep -f scout.py >/dev/null; then touch $S/scout/.stamp; nice -n 19 python3 $S/scout/scout.py > $S/scout/last_run.log 2>&1; fi
    # card_ops: STOP switch (/workspace/card_STOP) + restart cap (4/24h) + heartbeats wrap the 3 original card lines below, unchanged
    if sh $ROOT/card_ops/capok.sh ygo $ROOT/ygo_cards/.stamp 86400 ygo_cards/tracker.py; then
      if old $ROOT/ygo_cards/.stamp && ! pgrep -f ygo_cards/tracker.py >/dev/null; then timeout 7200 nice -n 19 python3 $ROOT/ygo_cards/tracker.py > $ROOT/ygo_cards/last_run.log 2>&1; fi
    fi
    if sh $ROOT/card_ops/capok.sh mtg $ROOT/mtg_cards/.stamp 86400 mtg_cards/tracker.py; then
      if old $ROOT/mtg_cards/.stamp && ! pgrep -f mtg_cards/tracker.py >/dev/null; then timeout 7200 nice -n 19 python3 $ROOT/mtg_cards/tracker.py > $ROOT/mtg_cards/last_run.log 2>&1; fi
    fi
    if sh $ROOT/card_ops/capok.sh publish $ROOT/card_app/.stamp 86400 card_app/publish.sh; then
      if old $ROOT/card_app/.stamp 3600 && ! pgrep -f card_app/publish.sh >/dev/null; then touch $ROOT/card_app/.stamp; timeout 600 nice -n 19 sh $ROOT/card_app/publish.sh > $ROOT/card_app/last_publish.log 2>&1; fi
    fi
    # one-shot supervisor inside this loop. It does not start another loop.
    if [ ! -f $ROOT/card_STOP ]; then nice -n 19 python3 $ROOT/card_ops/supervisor_periodic.py || true; fi
    # card_ops: site doctor on the LIVE site + fix pass every ~4h, status line every 10 min (zero tokens)
    if [ ! -f $ROOT/card_STOP ] && old $ROOT/card_ops/.doctor_stamp 14400 && ! pgrep -f card_ops/doctor.py >/dev/null; then touch $ROOT/card_ops/.doctor_stamp; timeout 1200 nice -n 19 sh $ROOT/card_ops/doctor_cycle.sh > $ROOT/card_ops/doctor_cycle.log 2>&1; fi
    if old $ROOT/card_ops/.status_stamp 600; then touch $ROOT/card_ops/.status_stamp; nice -n 19 python3 $ROOT/card_ops/status.py >/dev/null 2>&1; nice -n 19 python3 $ROOT/card_ops/scorecard.py >/dev/null 2>&1; fi
    if old $S/testbot/.stamp 3600 && ! pgrep -f testbot.py >/dev/null; then touch $S/testbot/.stamp; echo "$(date) run start" >>$S/testbot/run.log; timeout 3900 nice -n 19 python3 $S/testbot/testbot.py 45 $(( $(date +%s) % 100000 )) >>$S/testbot/run.log 2>&1; echo "$(date) run end rc=$?" >>$S/testbot/run.log; fi
  fi
  sleep 60
done
