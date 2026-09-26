#!/data/data/com.termux/files/usr/bin/sh
# Watchdog: every 30 s GET /api/health on the local node; after 3 consecutive
# failures restart it. Also caps every log in ~/logs at about 20 MB.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
LOG="$HOME/logs/health.log"; FAILS=0
mkdir -p "$HOME/logs"
while true; do
  if curl -sf -m 5 http://127.0.0.1:3100/api/health >/dev/null; then
    FAILS=0
  else
    FAILS=$((FAILS+1)); echo "$(date -Is) health fail $FAILS" >> "$LOG"
    if [ "$FAILS" -ge 3 ]; then
      echo "$(date -Is) restarting web node" >> "$LOG"
      pkill -f "node.*(server|hello)\.js"; sleep 2
      nohup sh "$HOME/.termux/start-web.sh" >> "$HOME/logs/web.log" 2>&1 &
      FAILS=0; sleep 20
    fi
  fi
  for f in "$HOME"/logs/*.log; do
    [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 20000000 ] && tail -c 5000000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  sleep 30
done
