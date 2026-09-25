#!/usr/bin/env bash
# register: BR-327
#
# Self-test for scripts/verify/bundle-service-role-scan.sh (PROJEXA-BUILD-001, item U-26 / E-08). A scan that says HITS=0 only means
# something if it is known to say HITS>0 when a secret is there. This builds throwaway bundle folders in a temp directory, plants
# each kind of leak in a minified one-line file, and checks the scanner's exit code, its HITS=<n> last line and what it prints.
#
# Cases: clean files; each of the four detections planted alone ([literal], [env], [jwt], [sb_secret]); two occurrences on one line;
# a service_role JWT with whitespace in the payload; an anon JWT (must not hit); a bare sb_secret_ prefix (must not hit); the same
# JWT through every decoder that runs here (python3, python, node); a missing decoder (must fail closed); an allowlisted string
# (ALLOWED, not counted) and the same string without the allowlist (counted); a malformed allowlist; a missing folder, an empty
# folder and a file in place of a folder; bad arguments; BUNDLE_DIR versus the argument; the default .next/static; a binary file;
# a 300 KB single-line file; the committed default allowlist; and a redaction check (the fake key and token never appear in output).
#
# No real secret is written anywhere. Every fake token is built at run time from pieces, so this file holds no token a scanner
# would flag, and everything it creates lives in a temp directory that is removed on exit.
#
# Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env SCAN_SCRIPT points the test at a different copy of the scanner (used to prove this test can fail: plant a broken regex in a
# copy and the self-test must go red).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="${SCAN_SCRIPT:-$HERE/bundle-service-role-scan.sh}"
[ -f "$SCAN" ] || { echo "SELFTEST FAIL: scanner not found: $SCAN" >&2; exit 2; }

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT

NCASE=0
NFAIL=0
NSKIP=0

# ---------------------------------------------------------------- fake tokens
b64url() { printf '%s' "$1" | base64 | tr -d '\n=' | tr '+/' '-_'; }
mk_jwt() {   # $1 = payload JSON. Header and signature are placeholders.
  printf '%s.%s.%s' "$(b64url '{"alg":"HS256","typ":"JWT"}')" "$(b64url "$1")" "$(b64url 'selftest-not-a-real-signature')"
}
ROLE_SR="service""_role"
JWT_SR="$(mk_jwt "{\"iss\":\"selftest\",\"role\":\"$ROLE_SR\",\"exp\":1}")"
JWT_SR_SPACED="$(mk_jwt "{\"iss\":\"selftest\", \"role\": \"$ROLE_SR\", \"exp\":1}")"
JWT_ANON="$(mk_jwt '{"iss":"selftest","role":"anon","exp":1}')"
JWT_AUTH="$(mk_jwt '{"iss":"selftest","role":"authenticated","exp":1}')"
SB_BODY="Selftest""FakeKey""ABCDEFGHIJ"        # 26 characters, not a real key
SB_KEY="sb_""secret_${SB_BODY}"

# ------------------------------------------------------------------ fixtures
minified() {   # $1 = file, $2 = content. No trailing newline, like a real minified chunk.
  mkdir -p "$(dirname "$1")"
  printf '%s' "$2" > "$1"
}

EMPTY_ALLOW="$T/allow-empty.txt"
printf '# empty on purpose\n' > "$EMPTY_ALLOW"

CLEAN_JS='!function(){var e={role:"anon",name:"service",r:"role",k:"NEXT_PUBLIC_SUPABASE_ANON_KEY"};window.__e=e}();'

# ------------------------------------------------------------------- harness
# t NAME EXPECT_RC EXPECT_HITS [+needle | -needle ...] -- command...
#   EXPECT_HITS is a number (the LAST stdout line must be exactly HITS=<n>) or "none" (no HITS= line at all).
#   +needle: the text must appear in stdout. -needle: the text must appear in neither stdout nor stderr.
t() {
  local name="$1" erc="$2" ehits="$3" needle why=""
  shift 3
  local needles=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do needles+=("$1"); shift; done
  shift
  local out err rc last
  out="$("$@" 2> "$T/stderr")"; rc=$?
  err="$(cat "$T/stderr")"
  last="$(printf '%s\n' "$out" | tail -n 1)"
  NCASE=$((NCASE + 1))
  [ "$rc" = "$erc" ] || why="exit code $rc, expected $erc"
  if [ -z "$why" ]; then
    if [ "$ehits" = "none" ]; then
      if printf '%s\n' "$out" | grep -q '^HITS='; then why="a HITS= line was printed, expected none"; fi
    else
      [ "$last" = "HITS=$ehits" ] || why="last stdout line is '$last', expected HITS=$ehits"
    fi
  fi
  if [ -z "$why" ] && [ "${#needles[@]}" -gt 0 ]; then
    for needle in "${needles[@]}"; do
      case "$needle" in
        +*) printf '%s\n' "$out" | grep -qF -- "${needle#+}" || { why="stdout lacks '${needle#+}'"; break; } ;;
        -*) if printf '%s\n%s\n' "$out" "$err" | grep -qF -- "${needle#-}"; then why="output must not contain '${needle#-}'"; break; fi ;;
      esac
    done
  fi
  if [ -z "$why" ]; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL + 1))
    printf 'FAIL %s -- %s\n' "$name" "$why"
    printf '     stdout: %s\n' "$(printf '%s' "$out" | head -c 600 | tr '\n' '|')"
    printf '     stderr: %s\n' "$(printf '%s' "$err" | head -c 300 | tr '\n' '|')"
  fi
}

skip() { NSKIP=$((NSKIP + 1)); printf 'skip %s\n' "$1"; }

scan()      { env BUNDLE_ALLOWLIST="$EMPTY_ALLOW" bash "$SCAN" "$@"; }
scan_env()  { env BUNDLE_ALLOWLIST="$EMPTY_ALLOW" "$@" bash "$SCAN"; }

# ------------------------------------------------------------------- clean
D="$T/clean"
minified "$D/chunks/app.js" "$CLEAN_JS"
minified "$D/chunks/pages dir/other file.js" "$CLEAN_JS"
minified "$D/css/site.css" 'body{margin:0}.role-service{color:#000}'
t "clean bundle (js, css, subfolder and file names with spaces)" 0 0 -- scan "$D"

# ----------------------------------------------------- each detection alone
D="$T/lit"
minified "$D/chunks/a.js" '(function(){var c={role:"service_role",u:1};window.__c=c})();'
t "[literal] service_role in a minified one-line file" 1 1 +"HIT [literal]" +"chunks/a.js" -- scan "$D"

D="$T/lit2"
minified "$D/chunks/a.js" 'a="service_role";b="service_role";var z=1;'
t "[literal] two occurrences 12 characters apart on one line count as 2 hits" 1 2 -- scan "$D"

D="$T/env1"
minified "$D/chunks/a.js" 'var k=process.env.SUPABASE_SERVICE_ROLE_KEY;'
t "[env] SUPABASE_SERVICE_ROLE_KEY" 1 1 +"HIT [env]" -- scan "$D"

D="$T/env2"
minified "$D/chunks/a.js" 'var k=process.env.SERVICE_ROLE;'
t "[env] SERVICE_ROLE" 1 1 +"HIT [env]" -- scan "$D"

D="$T/jwt"
minified "$D/chunks/a.js" "var t=\"$JWT_SR\";window.t=t;"
t "[jwt] JWT whose payload role is service_role" 1 1 +"HIT [jwt]" -"$JWT_SR" -"eyJ" -- scan "$D"

D="$T/jwt-spaced"
minified "$D/chunks/a.js" "var t=\"$JWT_SR_SPACED\";"
t "[jwt] same, with spaces around the colon in the payload" 1 1 +"HIT [jwt]" -- scan "$D"

D="$T/jwt-anon"
minified "$D/chunks/a.js" "var a=\"$JWT_ANON\",b=\"$JWT_AUTH\";"
t "[jwt] anon and authenticated JWTs are not hits" 0 0 -- scan "$D"

D="$T/sb"
minified "$D/chunks/a.js" "var k=\"$SB_KEY\";"
t "[sb_secret] a secret key is a hit and is redacted in the output" 1 1 +"HIT [sb_secret]" +"sb_secret_<redacted>" -"$SB_BODY" -"$SB_KEY" -- scan "$D"

D="$T/sb-bare"
minified "$D/chunks/a.js" 'if(k.startsWith("sb_secret_"))throw new Error("no");'
t "[sb_secret] the bare prefix (a library check) is not a hit" 0 0 -- scan "$D"

# ------------------------------------------------ every decoder that runs here
D="$T/jwt"
for dec in python3 python node; do
  ok=0
  case "$dec" in
    node) node -e '0' >/dev/null 2>&1 && ok=1 ;;
    *)    "$dec" -c 'import sys' >/dev/null 2>&1 && ok=1 ;;
  esac
  if [ "$ok" = 1 ]; then
    t "[jwt] decoder $dec finds the service_role JWT" 1 1 +"HIT [jwt]" -- scan_env BUNDLE_SCAN_DECODER="$dec" BUNDLE_DIR="$D"
    t "[jwt] decoder $dec lets the anon JWT through" 0 0 -- scan_env BUNDLE_SCAN_DECODER="$dec" BUNDLE_DIR="$T/jwt-anon"
  else
    skip "decoder $dec is not available here"
  fi
done
t "no usable decoder: fails closed with exit 2 and no HITS line" 2 none -- scan_env BUNDLE_SCAN_DECODER=no-such-decoder BUNDLE_DIR="$T/clean"

# ---------------------------------------------------------- all four together
D="$T/all4"
minified "$D/chunks/a.js" "var a={role:\"$ROLE_SR\"};var b=process.env.SUPABASE_SERVICE_ROLE_KEY;var c=\"$JWT_SR\";var d=\"$SB_KEY\";"
t "all four detections in one file are 4 hits" 1 4 +"[literal]" +"[env]" +"[jwt]" +"[sb_secret]" -- scan "$D"

# ------------------------------------------------------- binary and long lines
D="$T/binary"
mkdir -p "$D"
printf 'A\0B\0C\0%s\0D\n' "$ROLE_SR" > "$D/font.bin"
t "a binary file is scanned too" 1 1 +"HIT [literal]" -- scan "$D"

D="$T/long"
mkdir -p "$D"
{ head -c 300000 /dev/zero | tr '\0' 'x'; printf '%s' "var r=\"$ROLE_SR\";"; } > "$D/big.js"
t "a 300 KB single-line file is scanned" 1 1 +"HIT [literal]" -- scan "$D"

# ---------------------------------------------------------------- allowlist
D="$T/allow"
minified "$D/vendor/lib.js" 'var LIBSTR="service_role_doc";'
ALLOW_CTX="$T/allow-context.txt"
printf '# test\nLIBSTR\tharmless library string used in the self-test\n' > "$ALLOW_CTX"
t "allowlisted by context: ALLOWED, not counted" 0 0 +"ALLOWED [literal]" +"harmless library string" -- env BUNDLE_ALLOWLIST="$ALLOW_CTX" bash "$SCAN" "$D"
t "same folder without the allowlist entry is a hit" 1 1 +"HIT [literal]" -- scan "$D"

ALLOW_PATH="$T/allow-path.txt"
printf 'vendor/lib.js\tvendored chunk that only names the role in a doc string\n' > "$ALLOW_PATH"
t "allowlisted by file path: ALLOWED, not counted" 0 0 +"ALLOWED [literal]" -- env BUNDLE_ALLOWLIST="$ALLOW_PATH" bash "$SCAN" "$D"

D="$T/allow-mixed"
minified "$D/vendor/lib.js" 'var LIBSTR="service_role_doc";'
minified "$D/chunks/app.js" 'var c={role:"service_role"};'
t "an allowlist entry does not hide a hit in another file" 1 1 +"ALLOWED" +"HIT [literal]" +"chunks/app.js" -- env BUNDLE_ALLOWLIST="$ALLOW_CTX" bash "$SCAN" "$D"

printf 'NOREASON-NO-TAB\n' > "$T/allow-bad1.txt"
t "allowlist entry without a TAB is rejected" 2 none -- env BUNDLE_ALLOWLIST="$T/allow-bad1.txt" bash "$SCAN" "$T/clean"
printf 'SOMETHING\t   \n' > "$T/allow-bad2.txt"
t "allowlist entry with an empty reason is rejected" 2 none -- env BUNDLE_ALLOWLIST="$T/allow-bad2.txt" bash "$SCAN" "$T/clean"
t "BUNDLE_ALLOWLIST pointing at a missing file is rejected" 2 none -- env BUNDLE_ALLOWLIST="$T/no-such-allowlist.txt" bash "$SCAN" "$T/clean"
t "the committed default allowlist parses (clean folder, no override)" 0 0 -- bash "$SCAN" "$T/clean"

# -------------------------------------------------- folders and arguments
t "missing folder: exit 2, no HITS line" 2 none -- scan "$T/does-not-exist"
mkdir -p "$T/empty"
t "empty folder: exit 2, no HITS line (an empty scan never passes)" 2 none -- scan "$T/empty"
mkdir -p "$T/empty-subdirs/a/b"
t "folder with only empty sub-folders: exit 2" 2 none -- scan "$T/empty-subdirs"
t "a file in place of a folder: exit 2" 2 none -- scan "$T/clean/chunks/app.js"
t "two arguments: exit 2" 2 none -- scan "$T/clean" "$T/lit"
t "an option: exit 2" 2 none -- scan --help
t "an empty argument: exit 2" 2 none -- scan ""
t "BUNDLE_DIR is used when there is no argument" 1 1 -- scan_env BUNDLE_DIR="$T/lit"
t "the argument wins over BUNDLE_DIR" 0 0 -- env BUNDLE_ALLOWLIST="$EMPTY_ALLOW" BUNDLE_DIR="$T/lit" bash "$SCAN" "$T/clean"

mkdir -p "$T/proj-hit/.next/static/chunks" "$T/proj-clean/.next/static/chunks" "$T/proj-none"
minified "$T/proj-hit/.next/static/chunks/a.js" 'var c={role:"service_role"};'
minified "$T/proj-clean/.next/static/chunks/a.js" "$CLEAN_JS"
t "default folder .next/static (planted)" 1 1 -- bash -c "cd '$T/proj-hit' && BUNDLE_ALLOWLIST='$EMPTY_ALLOW' bash '$SCAN'"
t "default folder .next/static (clean)" 0 0 -- bash -c "cd '$T/proj-clean' && BUNDLE_ALLOWLIST='$EMPTY_ALLOW' bash '$SCAN'"
t "default folder missing: exit 2" 2 none -- bash -c "cd '$T/proj-none' && BUNDLE_ALLOWLIST='$EMPTY_ALLOW' bash '$SCAN'"

# -------------------------------------------------------------------- summary
if [ "$NFAIL" -eq 0 ]; then
  [ "$NSKIP" -eq 0 ] || printf '(%s decoder case(s) skipped: not available on this machine)\n' "$NSKIP"
  printf 'SELFTEST PASS: %s cases\n' "$NCASE"
  exit 0
fi
printf 'SELFTEST FAIL: %s of %s cases failed\n' "$NFAIL" "$NCASE"
exit 1
