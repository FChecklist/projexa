#!/data/data/com.termux/files/usr/bin/sh
# Internet watcher for a phone on flaky Wi-Fi. Started by boot-start.sh.
#
# - Internet up:   checks once a minute (needs 2 independent targets to fail
#                  before it calls an outage, so one slow site is not an outage).
# - Internet down: re-checks every 20 s so a blip of a few seconds is noticed
#                  quickly, and a 15-minute outage is followed until it ends.
# - The web node itself keeps serving on the LAN during an outage (it does not
#   need the internet to answer on 192.168.x.x); this script only makes sure the
#   things that DO need the internet recover cleanly the moment it returns:
#     * on recovery it restarts cloudflared (fresh tunnel connections instead of
#       waiting on a stale backoff timer) if the owner has set a tunnel token;
#     * it checks the local web node is healthy and restarts it if not;
#     * after 2 min of outage it nudges Wi-Fi (best effort, may be refused by Android).
# State and history are written to ~/logs/net.log and ~/logs/net.state.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
LOG="$HOME/logs/net.log"; STATE="$HOME/logs/net.state"
UP_EVERY=60; DOWN_EVERY=20
mkdir -p "$HOME/logs"

now() { date +%s; }
stamp() { date -Is; }
ok1() { curl -s -o /dev/null -m 6 -w '%{http_code}' "$1" 2>/dev/null; }
internet_up() {
  # two independent targets; up if either answers
  [ "$(ok1 http://connectivitycheck.gstatic.com/generate_204)" = "204" ] && return 0
  c=$(ok1 https://www.cloudflare.com/cdn-cgi/trace); [ "$c" = "200" ] && return 0
  return 1
}
web_healthy() { curl -sf -m 5 http://127.0.0.1:3100/api/health >/dev/null; }
restart_web() {
  pkill -f "node.*(server|hello)\.js"; sleep 2
  nohup sh "$HOME/.termux/start-web.sh" >> "$HOME/logs/web.log" 2>&1 &
}
restart_tunnel() {
  [ -s "$HOME/.projexa.tunnel" ] || return 0
  pkill -x cloudflared; sleep 2
  nohup cloudflared tunnel --no-autoupdate run --token "$(cat "$HOME/.projexa.tunnel")" \
    >> "$HOME/logs/cloudflared.log" 2>&1 &
}

status=up; since=$(now); down_at=0; nudged=0
echo "$(stamp) netwatch start" >> "$LOG"
printf 'up %s\n' "$since" > "$STATE"

while true; do
  if internet_up; then
    if [ "$status" = "down" ]; then
      dur=$(( $(now) - down_at ))
      echo "$(stamp) INTERNET BACK after ${dur}s" >> "$LOG"
      restart_tunnel
      web_healthy || { echo "$(stamp) web node unhealthy after outage, restarting" >> "$LOG"; restart_web; }
      status=up; since=$(now); nudged=0
      printf 'up %s\n' "$since" > "$STATE"
    fi
    sleep "$UP_EVERY"
  else
    # confirm with one more try 5 s later so a single dropped packet is not an outage
    sleep 5
    if internet_up; then sleep "$UP_EVERY"; continue; fi
    if [ "$status" = "up" ]; then
      status=down; down_at=$(now); since=$down_at
      echo "$(stamp) INTERNET DOWN" >> "$LOG"
      printf 'down %s\n' "$since" > "$STATE"
    fi
    # after 2 minutes down, nudge Wi-Fi once per outage (Android 12 may refuse; harmless)
    if [ "$nudged" = 0 ] && [ $(( $(now) - down_at )) -ge 120 ]; then
      nudged=1
      echo "$(stamp) outage >2 min, asking Android to re-scan Wi-Fi" >> "$LOG"
      termux-wifi-scaninfo >/dev/null 2>&1 || true
    fi
    sleep "$DOWN_EVERY"
  fi
  # cap the log at about 5 MB
  [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ] && tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
done
