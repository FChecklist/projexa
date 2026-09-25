#!/usr/bin/env bash
# register: BR-327
#
# Browser-bundle service-role scan (PROJEXA-BUILD-001, item U-26 / E-08).
#
# WHAT IT PROVES. A service_role secret must never reach a browser. Whatever `next build` puts under .next/static is served to
# every visitor, so this scans that directory (or any directory you name) and fails when it finds any of:
#   [literal]    the text  service_role  (lower case), as a value or as a key name.
#   [env]        the env-var name  SUPABASE_SERVICE_ROLE_KEY  or  SERVICE_ROLE  (upper case). Next.js leaves a non-NEXT_PUBLIC
#                `process.env.X` reference in client code as text, so this catches a server-only module that leaked into a client one.
#   [jwt]        a JWT-shaped token (three base64url segments, the middle one starting eyJ) whose DECODED payload holds
#                "role":"service_role". The payload is base64, so the [literal] check cannot see it; this check decodes it.
#                A JWT whose role is anon or authenticated is not a hit: the anon key is meant to be public.
#   [sb_secret]  a Supabase secret key: the prefix sb_secret_ followed by at least 8 key characters. The bare prefix on its own
#                (for example a library that checks key.startsWith("sb_secret_")) is not a key and is not a hit.
# Every match is one hit. Two occurrences on one minified line are two hits.
#
# Works on minified single-line files: matching is done with grep -o (byte offsets, no line splitting) and a small decoder, never
# with a line-based tool. Binary files are scanned too (grep -a): a scan that skips a file it cannot read as text would let a
# secret through, so the scan reads everything under the directory.
#
# USAGE   bash scripts/verify/bundle-service-role-scan.sh [BUNDLE_DIR]
#   BUNDLE_DIR is the argument, else the environment variable BUNDLE_DIR, else .next/static (relative to the current folder).
#
# OUTPUT  One line per hit on stdout:      HIT [category] path:line:leading-context
#         One line per allowlisted match:  ALLOWED [category] path:line:leading-context (allowlisted: reason)
#         A summary line, then, as the LAST stdout line:  HITS=<n>    (n counts hits that are not allowlisted)
#         The context is at most 16 characters BEFORE the match. Nothing after the match is printed, any sb_secret_ or eyJ text is
#         replaced by a <redacted> marker, and a JWT hit prints no part of the token, so a secret is never echoed to a log.
#
# EXIT    0  n == 0.
#         1  n > 0.
#         2  usage error, the directory is missing or holds no files, the allowlist is malformed, no decoder is available, or
#            grep failed. Nothing is printed on stdout that could be read as HITS=0. An empty scan never reports success.
#
# ALLOWLIST  scripts/verify/bundle-service-role-allow.txt (env BUNDLE_ALLOWLIST overrides). One entry per line:
#            <substring><TAB><reason>. Blank lines and lines starting with # are ignored. A hit line (the text after HIT, that is
#            [category] path:line:context) that contains an allowlisted substring is printed as ALLOWED and is not counted. An
#            entry without a tab or without a reason is rejected (exit 2): every exception has to say why.
#
# ENVIRONMENT  BUNDLE_DIR, BUNDLE_ALLOWLIST (see above); BUNDLE_SCAN_DECODER=python3|python|node forces one JWT decoder (default:
#              the first of python3, python, node that runs). Only bash, grep, sed, tr, find, mktemp and one decoder are needed.
#
# HONEST LIMITS. This finds a secret that is present as text. It cannot see one that is split into pieces and joined at run time,
# or one that is not in the scanned directory. A build that runs with placeholder env values (as CI does) will not inline a real
# key, so in CI the [env] and [literal] checks are the ones that fire on a leaked server-only import. The companion self-test is
# scripts/verify/bundle-service-role-scan.selftest.sh; CI runs both.

set -u
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  {
    echo "usage: bash scripts/verify/bundle-service-role-scan.sh [BUNDLE_DIR]"
    echo "  BUNDLE_DIR: the argument, else \$BUNDLE_DIR, else .next/static"
    echo "  env BUNDLE_ALLOWLIST: allowlist file (default: scripts/verify/bundle-service-role-allow.txt)"
    echo "  env BUNDLE_SCAN_DECODER: python3, python or node (default: first that runs)"
    echo "  exit 0 = HITS=0, exit 1 = HITS>0, exit 2 = usage error or nothing could be scanned"
  } >&2
  exit 2
}

die() { printf 'ERROR: %s\n' "$1" >&2; exit 2; }

# ------------------------------------------------------------------ arguments
if [ $# -gt 1 ]; then usage; fi
if [ $# -eq 1 ]; then
  case "$1" in -*|'') usage ;; esac
  DIR="$1"
else
  DIR="${BUNDLE_DIR:-.next/static}"
fi
[ -d "$DIR" ] || die "bundle directory not found: $DIR (run the production build first, or pass the directory)"

if [ -n "${BUNDLE_ALLOWLIST:-}" ]; then
  ALLOW_FILE="$BUNDLE_ALLOWLIST"
  [ -f "$ALLOW_FILE" ] || die "allowlist file not found: $ALLOW_FILE"
else
  ALLOW_FILE="$HERE/bundle-service-role-allow.txt"
fi

TMP="$(mktemp -d)" || die "could not create a temporary directory"
trap 'rm -rf "$TMP"' EXIT

FILES="$(find -H "$DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "${FILES:-0}" -gt 0 ] || die "no files found under $DIR: refusing to report HITS=0 for an empty scan"

# ------------------------------------------------------------------ allowlist
ALLOW_SUBS=()
ALLOW_WHY=()
if [ -f "$ALLOW_FILE" ]; then
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    [ -n "${line//[[:space:]]/}" ] || continue
    sub="${line%%$'\t'*}"
    if [ "$sub" = "$line" ]; then
      die "allowlist $ALLOW_FILE line $n has no TAB: an entry is <substring><TAB><reason>"
    fi
    why="${line#*$'\t'}"
    [ -n "$sub" ] || die "allowlist $ALLOW_FILE line $n has an empty substring"
    [ -n "${why//[[:space:]]/}" ] || die "allowlist $ALLOW_FILE line $n has no reason: every exception has to say why"
    ALLOW_SUBS+=("$sub")
    ALLOW_WHY+=("$why")
  done < "$ALLOW_FILE"
fi

# -------------------------------------------------------------- JWT decoders
PY_DECODER='
import base64, re, sys
pat = re.compile(r"\"role\"\s*:\s*\"service_role\"")
out = sys.stdout.buffer
for raw in sys.stdin.buffer:
    raw = raw.decode("latin-1").rstrip("\r\n")
    head, sep, tok = raw.rpartition(":")
    if not sep:
        continue
    parts = tok.split(".")
    if len(parts) != 3:
        continue
    seg = parts[1]
    try:
        text = base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)).decode("utf-8", "replace")
    except Exception:
        continue
    if pat.search(text):
        out.write(("%s:JWT whose payload has role=service_role (token redacted, %d chars)\n" % (head, len(tok))).encode("latin-1"))
'
NODE_DECODER='
const fs = require("fs");
const pat = /"role"\s*:\s*"service_role"/;
const out = [];
for (let raw of fs.readFileSync(0, "latin1").split("\n")) {
  raw = raw.replace(/\r$/, "");
  const i = raw.lastIndexOf(":");
  if (i < 0) continue;
  const head = raw.slice(0, i);
  const tok = raw.slice(i + 1);
  const parts = tok.split(".");
  if (parts.length !== 3) continue;
  let text;
  try { text = Buffer.from(parts[1], "base64url").toString("utf8"); } catch (e) { continue; }
  if (pat.test(text)) out.push(head + ":JWT whose payload has role=service_role (token redacted, " + tok.length + " chars)");
}
if (out.length) process.stdout.write(out.join("\n") + "\n");
'

DECODER=""
if [ -n "${BUNDLE_SCAN_DECODER:-}" ]; then CANDIDATES="$BUNDLE_SCAN_DECODER"; else CANDIDATES="python3 python node"; fi
for c in $CANDIDATES; do
  case "$c" in
    python3|python) if "$c" -c 'import sys' >/dev/null 2>&1; then DECODER="$c"; break; fi ;;
    node)           if node -e '0' >/dev/null 2>&1; then DECODER="node"; break; fi ;;
  esac
done
[ -n "$DECODER" ] || die "no JWT decoder is available (need python3, python or node; BUNDLE_SCAN_DECODER=${BUNDLE_SCAN_DECODER:-unset}): the JWT check cannot run, so the scan cannot pass"

# ------------------------------------------------------------------- scanning
: > "$TMP/hits"

redact() {
  sed -E -e 's/sb_secret_[A-Za-z0-9_-]+/sb_secret_<redacted>/g' -e 's/eyJ[A-Za-z0-9_-]{6,}/eyJ<redacted>/g' \
    | tr -c '[:print:]\n' '?'
}

scan_text() {   # $1 = category label, $2 = extended regex ending in the thing that is matched
  local cat="$1" raw="$TMP/raw.$1" rc
  grep -rHnaoE -e "$2" -- "$DIR" > "$raw" 2> "$TMP/err.$1"
  rc=$?
  if [ "$rc" -ge 2 ]; then
    die "grep failed while scanning for [$cat] (exit $rc): $(head -n 3 "$TMP/err.$1" | tr -d '\r')"
  fi
  if [ -s "$raw" ]; then
    redact < "$raw" | sed "s/^/[$cat] /" >> "$TMP/hits"
  fi
}

scan_text literal    '.{0,16}service_role'
scan_text env        '.{0,16}(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE)'
scan_text sb_secret  '.{0,16}sb_secret_[A-Za-z0-9_-]{8,}'

# JWT candidates: header.payload.signature with a payload that starts eyJ (a base64 JSON object). The decoder keeps only those
# whose payload says role=service_role.
grep -rHnaoE -e '[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*' -- "$DIR" > "$TMP/jwt.cand" 2> "$TMP/err.jwt"
rc=$?
if [ "$rc" -ge 2 ]; then
  die "grep failed while looking for JWT-shaped tokens (exit $rc): $(head -n 3 "$TMP/err.jwt" | tr -d '\r')"
fi
if [ -s "$TMP/jwt.cand" ]; then
  case "$DECODER" in
    node) node -e "$NODE_DECODER" < "$TMP/jwt.cand" > "$TMP/jwt.hits" 2> "$TMP/err.dec" ;;
    *)    "$DECODER" -c "$PY_DECODER" < "$TMP/jwt.cand" > "$TMP/jwt.hits" 2> "$TMP/err.dec" ;;
  esac
  rc=$?
  [ "$rc" -eq 0 ] || die "the JWT decoder ($DECODER) failed (exit $rc): $(head -n 3 "$TMP/err.dec" | tr -d '\r')"
  if [ -s "$TMP/jwt.hits" ]; then
    tr -d '\r' < "$TMP/jwt.hits" | redact | sed 's/^/[jwt] /' >> "$TMP/hits"
  fi
fi

# ------------------------------------------------------------------ reporting
HITS=0
ALLOWED=0
while IFS= read -r hit || [ -n "$hit" ]; do
  [ -n "$hit" ] || continue
  why=""
  i=0
  while [ "$i" -lt "${#ALLOW_SUBS[@]}" ]; do
    case "$hit" in
      *"${ALLOW_SUBS[$i]}"*) why="${ALLOW_WHY[$i]}"; break ;;
    esac
    i=$((i + 1))
  done
  if [ -n "$why" ]; then
    ALLOWED=$((ALLOWED + 1))
    printf 'ALLOWED %s (allowlisted: %s)\n' "$hit" "$why"
  else
    HITS=$((HITS + 1))
    printf 'HIT %s\n' "$hit"
  fi
done < <(LC_ALL=C sort "$TMP/hits")

printf 'scanned %s file(s) under %s: %s hit(s), %s allowlisted\n' "$FILES" "$DIR" "$HITS" "$ALLOWED"
printf 'HITS=%s\n' "$HITS"
if [ "$HITS" -eq 0 ]; then exit 0; fi
exit 1
