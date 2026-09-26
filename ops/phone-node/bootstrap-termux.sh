#!/data/data/com.termux/files/usr/bin/sh
# One-shot setup of a fresh Termux install into a PROJEXA phone node.
# Run inside Termux (or via `adb shell run-as com.termux` with the env from
# docs/phone-node/RUNBOOK.md). Idempotent. Contains no secrets.
#   sh bootstrap-termux.sh <path-to-laptop-public-key-file>
set -eu
export PATH=/data/data/com.termux/files/usr/bin:$PATH
export DEBIAN_FRONTEND=noninteractive
HERE=$(cd "$(dirname "$0")" && pwd)
PUBKEY_FILE="${1:-}"

apt-get update -y
apt-get -o Dpkg::Options::=--force-confnew -y install nodejs-lts cloudflared openssh curl procps iproute2 termux-api termux-services

mkdir -p "$HOME/.termux/boot" "$HOME/logs" "$HOME/node" "$HOME/projexa/releases" "$HOME/.ssh"
printf 'allow-external-apps = true\nwake-lock = true\n' > "$HOME/.termux/termux.properties"

# key-only SSH on 8022 (never a password)
if [ -n "$PUBKEY_FILE" ]; then cat "$PUBKEY_FILE" >> "$HOME/.ssh/authorized_keys"; sort -u -o "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys"; fi
chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys" 2>/dev/null || true
grep -q '^PasswordAuthentication no' "$PREFIX/etc/ssh/sshd_config" || \
  printf 'PasswordAuthentication no\nPubkeyAuthentication yes\nPort 8022\n' >> "$PREFIX/etc/ssh/sshd_config"

cp "$HERE/hello.js" "$HOME/node/hello.js"
cp "$HERE/start-web.sh" "$HERE/health.sh" "$HOME/.termux/"
cp "$HERE/boot-start.sh" "$HOME/.termux/boot/00-start.sh"
cp "$HERE/deploy.sh" "$HOME/deploy.sh"
chmod 700 "$HOME/.termux/start-web.sh" "$HOME/.termux/health.sh" "$HOME/.termux/boot/00-start.sh" "$HOME/deploy.sh"
echo "bootstrap done. Open the Termux:Boot app once, then reboot to test."
