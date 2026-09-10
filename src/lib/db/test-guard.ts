// P2.3 (W-ENV, R81-ADDENDUM-B phase S5): destructive-test guard, pure logic.
//
// WHAT. `assertTestDatabase` throws unless a connection string resolves to
// either a genuinely local Postgres (localhost/127.0.0.1) or this repo's own
// known dev/test Supabase project (KNOWN_PROJECT_REF). It is wired to run
// automatically before any test file via bunfig.toml's `[test] preload` ->
// test-guard-preload.ts, which is the only file that should ever call this
// for its side effect -- everything else (including this file's own test)
// should call it directly to check a specific string.
//
// WHY. This repo has no separate local database (this app's DB is mostly a
// stub -- see src/lib/db/index.ts's own comment -- but drizzle/ still runs
// real migrations against, and any DB-touching test would hit, the one real
// Supabase project that also backs whatever production traffic exists the
// moment Vercel unpauses). A bad env var, a copy-pasted .env, or a future
// multi-project config mistake pointing DATABASE_URL somewhere unexpected
// should not fail quietly by writing test data into it -- it should refuse
// to run at all, before a single query executes.
//
// SCOPE, deliberately narrow and an allowlist (not a denylist): an
// unrecognised connection string is refused by default, not merely warned
// about. "Local or test" means localhost/127.0.0.1, or a connection string
// naming this repo's own known project ref. If a real, separate test
// project is ever provisioned, add its ref here explicitly -- do not widen
// this to "anything that isn't obviously named prod".
const KNOWN_PROJECT_REF = "evpckeuxgvahguwsaeul"; // this repo's Supabase project ("projexa")

export function assertTestDatabase(rawUrl) {
  if (!rawUrl) return; // no DATABASE_URL at all -- nothing to connect to, nothing to guard
  let host;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(`DESTRUCTIVE-TEST GUARD: DATABASE_URL is not a valid connection URL: ${rawUrl}`);
  }
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const isKnownTestProject = rawUrl.includes(KNOWN_PROJECT_REF);
  if (!isLocal && !isKnownTestProject) {
    throw new Error(
      `DESTRUCTIVE-TEST GUARD: refusing to run -- DATABASE_URL does not point at localhost or the known dev/test project (${KNOWN_PROJECT_REF}). ` +
        `Host was: ${host}. If this is intentionally a new test database, add its project ref to KNOWN_PROJECT_REF in src/lib/db/test-guard.ts -- do not delete this check.`
    );
  }
}
