#!/data/data/com.termux/files/usr/bin/sh
# PROJEXA phone node: started by Termux:Boot at power-on (installed as
# ~/.termux/boot/00-start.sh by bootstrap-termux.sh). Safe to re-run: every
# step checks whether it is already running.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
mkdir -p "$HOME/logs"

termux-wake-lock                      # keep the CPU awake (Termux notification stays up)
pgrep -x sshd >/dev/null || sshd      # key-only SSH on :8022

# web node (PROJEXA standalone bundle, or the placeholder if none deployed yet)
pgrep -f "node.*(server|hello)\.js" >/dev/null || \
  nohup sh "$HOME/.termux/start-web.sh" >> "$HOME/logs/web.log" 2>&1 &

# Cloudflare tunnel: only if the OWNER has placed a token file on this phone
# (docs/phone-node/OWNER_STEPS.md). The token is never in git or in this script.
if [ -s "$HOME/.projexa.tunnel" ] && ! pgrep -x cloudflared >/dev/null; then
  nohup cloudflared tunnel --no-autoupdate run --token "$(cat "$HOME/.projexa.tunnel")" \
    >> "$HOME/logs/cloudflared.log" 2>&1 &
fi

# watchdog
pgrep -f "sh .*health\.sh" >/dev/null || nohup sh "$HOME/.termux/health.sh" >/dev/null 2>&1 &
