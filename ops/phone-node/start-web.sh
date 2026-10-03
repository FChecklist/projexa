#!/data/data/com.termux/files/usr/bin/sh
# Runs the web node in the foreground. Secrets come from ~/.projexa.env, a file
# the OWNER creates on the phone (chmod 600). It is never in git or an artifact.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
set -a
[ -f "$HOME/.projexa.env" ] && . "$HOME/.projexa.env"
set +a
export NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# never let Node take more than about half of the phone's free RAM
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"

if [ -f "$HOME/projexa/current/server.js" ]; then
  cd "$HOME/projexa/current" && exec node server.js
fi
# nothing deployed yet: serve the placeholder so the phone is still reachable
exec node "$HOME/node/hello.js"
