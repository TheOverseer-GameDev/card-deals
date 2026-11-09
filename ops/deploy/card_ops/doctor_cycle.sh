#!/bin/sh
# ~4h site-doctor cycle (zero tokens): fix pass on tracker data -> if anything changed, republish through the gate -> live check.
ROOT=${CARD_ROOT:-/workspace}
O=$ROOT/card_ops
[ -f $ROOT/card_STOP ] && exit 0
[ $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) -lt 2048 ] && exit 0
B=$(md5sum $ROOT/ygo_cards/latest.json $ROOT/mtg_cards/latest.json | md5sum)
python3 $O/doctor.py --selftest > $O/selftest_last.txt 2>&1 || echo "$(date '+%F %T %Z') doctor SELFTEST FAILED" >> $O/hb/ops.log
python3 $O/doctor.py --fix
A=$(md5sum $ROOT/ygo_cards/latest.json $ROOT/mtg_cards/latest.json | md5sum)
if [ "$A" != "$B" ] && ! pgrep -f card_app/publish.sh >/dev/null; then
  echo "doctor changed data -> republish via gate"; timeout 900 sh $ROOT/card_app/publish.sh > $ROOT/card_app/last_publish.log 2>&1; sleep 90
fi
python3 $O/doctor.py --live
S=$O/.wf_stamp; if [ ! -f $S ] || [ $(( $(date +%s) - $(stat -c %Y $S) )) -gt 604800 ]; then touch $S; python3 $O/walkforward.py > /dev/null 2>&1; fi  # weekly
python3 $O/calibration.py >/dev/null 2>&1
python3 $O/status.py
