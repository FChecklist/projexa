#!/data/data/com.termux/files/usr/bin/sh
# Atomic, rollback-able deploy of a PROJEXA standalone bundle on the phone.
#
#   deploy.sh <tag>            pull  projexa-<tag>.tar.gz (+ .sha256) from the GitHub Release
#   deploy.sh --local <file>   use a tarball already on the phone (scp'd from the laptop)
#   deploy.sh --rollback       flip `current` back to the previous release
#
# Layout:  ~/projexa/releases/<id>/   ~/projexa/current -> releases/<id>
# A release is only switched in after it answers /api/health on a spare port.
# The last 3 releases are kept. Secrets are NOT part of a release: they live in
# ~/.projexa.env, created by the owner.
set -eu
export PATH=/data/data/com.termux/files/usr/bin:$PATH
BASE="$HOME/projexa"; REL="$BASE/releases"; SPARE_PORT=3199
REPO="${PROJEXA_REPO:-FChecklist/projexa}"
mkdir -p "$REL" "$HOME/logs"

restart_web() {
  pkill -f "node.*(server|hello)\.js" 2>/dev/null || true
  sleep 2
  nohup sh "$HOME/.termux/start-web.sh" >> "$HOME/logs/web.log" 2>&1 &
}

if [ "${1:-}" = "--rollback" ]; then
  prev=$(ls -1t "$REL" | sed -n 2p)
  [ -n "$prev" ] || { echo "no previous release to roll back to"; exit 1; }
  ln -sfn "$REL/$prev" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
  restart_web; echo "rolled back to $prev"; exit 0
fi

WORK=$(mktemp -d "$TMPDIR/deploy.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
if [ "${1:-}" = "--local" ]; then
  ID=$(basename "$2" .tar.gz | sed 's/^projexa-//'); cp "$2" "$WORK/bundle.tar.gz"
  [ -f "$2.sha256" ] && cp "$2.sha256" "$WORK/bundle.sha256"
else
  ID="$1"; URL="https://github.com/$REPO/releases/download/$ID"
  AUTH=""; [ -s "$HOME/.projexa.gh_token" ] && AUTH="Authorization: Bearer $(cat "$HOME/.projexa.gh_token")"
  # public repo: plain download. Private repo: the owner provides a read-only token file.
  curl -fsSL ${AUTH:+-H "$AUTH"} -o "$WORK/bundle.tar.gz" "$URL/projexa-$ID.tar.gz"
  curl -fsSL ${AUTH:+-H "$AUTH"} -o "$WORK/bundle.sha256" "$URL/projexa-$ID.tar.gz.sha256"
fi

# verify integrity BEFORE unpacking
if [ -f "$WORK/bundle.sha256" ]; then
  want=$(cut -d' ' -f1 "$WORK/bundle.sha256"); got=$(sha256sum "$WORK/bundle.tar.gz" | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "SHA256 MISMATCH: refusing to deploy"; exit 2; }
  echo "sha256 ok"
else
  echo "no .sha256 supplied: refusing to deploy an unverified bundle"; exit 2
fi

mkdir -p "$REL/$ID"; tar -xzf "$WORK/bundle.tar.gz" -C "$REL/$ID"
[ -f "$REL/$ID/server.js" ] || { echo "bundle has no server.js"; rm -rf "$REL/$ID"; exit 3; }

# health-check the new release on a spare port with the real env, before switching
( set -a; [ -f "$HOME/.projexa.env" ] && . "$HOME/.projexa.env"; set +a
  cd "$REL/$ID"; NODE_ENV=production PORT=$SPARE_PORT HOSTNAME=127.0.0.1 \
  NODE_OPTIONS="--max-old-space-size=768" nohup node server.js > "$WORK/spare.log" 2>&1 & echo $! > "$WORK/spare.pid" )
ok=0
for i in $(seq 1 45); do
  sleep 2
  curl -sf -m 3 "http://127.0.0.1:$SPARE_PORT/api/health" >/dev/null && { ok=1; break; }
done
kill "$(cat "$WORK/spare.pid")" 2>/dev/null || true
if [ "$ok" != 1 ]; then
  echo "new release failed its health check; keeping the current one"; tail -20 "$WORK/spare.log"
  rm -rf "$REL/$ID"; exit 4
fi

# atomic switch, restart, prune to the last 3
ln -sfn "$REL/$ID" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
restart_web
ls -1t "$REL" | tail -n +4 | while read -r old; do rm -rf "$REL/$old"; done
echo "deployed $ID; releases kept: $(ls -1t "$REL" | tr '\n' ' ')"
