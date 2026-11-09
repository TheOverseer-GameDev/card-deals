#!/bin/sh
# capok.sh NAME STAMPFILE [MAXAGE]: zero-token restart cap. If job is due (stamp older than MAXAGE),
# allow at most 4 attempts per 24h; beyond that log + refuse until a success refreshes the stamp.
# PAT: process pattern; if already running it is not counted as an attempt.
# Also refuses on /workspace/card_STOP and when MemAvailable < 2 GB.
ROOT=${CARD_ROOT:-/workspace}
H=$ROOT/card_ops/hb; mkdir -p $H; N=$1; ST=$2; AGE=${3:-86400}; PAT=$4; NOW=$(date +%s)
[ -f $ROOT/card_STOP ] && exit 1
[ $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) -lt 2048 ] && exit 1
if [ -f "$ST" ] && [ $((NOW-$(stat -c %Y "$ST"))) -le $AGE ]; then : > $H/$N.attempts; exit 0; fi
[ -n "$PAT" ] && pgrep -f "$PAT" | grep -vx "$$" >/dev/null && { echo $NOW > $H/$N.beat; exit 0; }  # already running: not a new attempt
touch $H/$N.attempts
awk -v n=$NOW '$1>n-86400' $H/$N.attempts > $H/$N.a2 2>/dev/null; mv $H/$N.a2 $H/$N.attempts
if [ $(wc -l < $H/$N.attempts) -ge 4 ]; then
  [ -f $H/$N.capped ] || { echo "$(date '+%F %T %Z') $N restart cap reached (4/24h); paused until it succeeds or attempts age out" >> $H/ops.log; touch $H/$N.capped; }
  exit 1
fi
rm -f $H/$N.capped; echo $NOW >> $H/$N.attempts; echo $NOW > $H/$N.beat; exit 0
