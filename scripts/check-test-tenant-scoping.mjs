#!/usr/bin/env bun
// P2.2 (W-ENV, R81-ADDENDUM-B phase S5): test-tenant scoping checker.
//
// WHAT. Every e2e spec or fixture in this repo's e2e/ tree must only ever
// exercise a tenant (a row in `organizations`) whose slug starts with the
// literal prefix "test-". This script:
//   (a) statically scans e2e/**/*.ts for every tenant-identifying literal it
//       knows how to recognise -- an email address (its domain identifies
//       the tenant) or a raw UUID -- and FAILS if any such literal is NOT
//       listed in the REGISTRY below. This is the drift guard: a new e2e
//       file that quietly starts hitting a different tenant can't slip in
//       unreviewed, it has to be added to the registry and classified first.
//   (b) when DATABASE_URL (or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD)
//       is set, live-checks every REGISTRY row classified "test" against the
//       real `organizations.slug` and FAILS if it does not start with
//       "test-".
//
// WHY. The shared-database model (see scripts/check-migration-guard.mjs's
// header) cuts both ways: an e2e run that accidentally touches real/demo
// data doesn't just pollute a throwaway fixture, it pollutes the same
// database production reads from the moment Vercel unpauses. A registry +
// drift check is cheap insurance at the one point (e2e) most likely to
// write to whatever tenant it happens to be pointed at.
//
// INVENTORY (2026-09-10). e2e/**/*.ts in this repo references exactly one
// tenant: the org backing e2e/users.ts's 4 seeded login accounts
// (organizations.id 42d7bac5-ffe1-4e10-a783-deaa90f8ce03, "Meridian
// Construction Group"). Its slug was "meridian-construction-e2e-test-ed12a"
// -- contains "test" but did not START with "test-" -- and has been renamed
// to "test-meridian-construction-e2e-ed12a" as part of this fix. No other
// tenant identifier (UUID or email domain) appears anywhere in e2e/; the 4
// project UUIDs in e2e/helpers.ts are VERIDIAN project ids belonging to that
// SAME org, not separate tenants, and the nil UUID in
// e2e/hr-employees-payroll.spec.ts is a deliberate "not found" probe value,
// not a tenant reference -- both are excluded explicitly below rather than
// by accident.
//
// USAGE.
//   bun scripts/check-test-tenant-scoping.mjs                # static + live (if DATABASE_URL set)
//   bun scripts/check-test-tenant-scoping.mjs --static-only   # skip the DB round-trip
//
// EXIT CODE. 0 = every literal found is registered, and every live-checked
// "test" tenant's slug starts with "test-". 1 = otherwise.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Windows import.meta.url gotcha (confirmed elsewhere in this repo's history
// to silently no-op .mjs scripts if done wrong): always resolve paths via
// fileURLToPath, never by string-slicing the URL.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SCAN_DIRS = ["e2e"];

// ---------------------------------------------------------------------------
// REGISTRY -- every tenant identifier this repo's e2e tree is known to
// reference, and how it must be resolved. Extend this when e2e grows a new
// tenant reference; don't silence a failure by deleting the check.
// ---------------------------------------------------------------------------
const REGISTRY = [
  {
    match: { type: "email-domain", value: "meridian-construction.e2e-test.projexa-ai.com" },
    classification: "test",
    id: "42d7bac5-ffe1-4e10-a783-deaa90f8ce03",
    note: "e2e/users.ts -- the 4 seeded Playwright login accounts (ceo/finance/hr/siteSupervisor).",
  },
];

// Literals that look like tenant identifiers but deliberately are not one --
// listed explicitly (never silently) so a future reader can see they were
// considered, not missed.
const KNOWN_NON_TENANT_UUIDS = new Set([
  "00000000-0000-0000-0000-000000000000", // e2e/hr-employees-payroll.spec.ts -- a deliberate "not found" probe value
  "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04", // e2e/helpers.ts -- a VERIDIAN project id under the registered test org, not a separate tenant
  "c37a232d-5535-4630-afdc-9cc78c792bd5", // "
  "6d51a606-dfc5-4a04-81f2-2b5e2a1686d5", // "
  "43b11bc8-59a9-4f0e-b91e-758de05db50a", // "
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function listFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(listFiles(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function scanStatic() {
  const files = SCAN_DIRS.flatMap((d) => listFiles(join(REPO_ROOT, d)));
  const registeredDomains = new Set(REGISTRY.filter((r) => r.match.type === "email-domain").map((r) => r.match.value));
  const registeredUuids = new Set(REGISTRY.filter((r) => r.match.type === "uuid").map((r) => r.match.value.toLowerCase()));
  const unregistered = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(EMAIL_RE)) {
      const domain = m[1];
      if (!registeredDomains.has(domain)) unregistered.push({ file, kind: "email-domain", value: domain });
    }
    for (const m of text.matchAll(UUID_RE)) {
      const uuid = m[0].toLowerCase();
      if (KNOWN_NON_TENANT_UUIDS.has(uuid)) continue;
      if (!registeredUuids.has(uuid)) unregistered.push({ file, kind: "uuid", value: uuid });
    }
  }
  return unregistered;
}

function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0];
    return `postgresql://postgres.${ref}:${dbPassword}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;
  }
  return null;
}

async function liveCheck() {
  const conn = getConnectionString();
  if (!conn) return { ran: false, failures: [] };
  const postgres = (await import("postgres")).default;
  const sql = postgres(conn, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 });
  const failures = [];
  try {
    for (const row of REGISTRY.filter((r) => r.classification === "test")) {
      const [orgRow] = await sql`select slug from organizations where id = ${row.id}`;
      const slug = orgRow?.slug ?? null;
      const ok = !!slug && slug.startsWith("test-");
      console.log(`  ${ok ? "PASS" : "FAIL"}: ${row.id} (${row.note}) -> slug=${slug ?? "NOT FOUND"}`);
      if (!ok) failures.push({ ...row, slug });
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
  return { ran: true, failures };
}

async function main() {
  const staticOnly = process.argv.includes("--static-only");

  console.log("=== test-tenant scoping: static scan of e2e/ ===");
  const unregistered = scanStatic();
  if (unregistered.length === 0) {
    console.log("  no unregistered tenant-identifying literals found.");
  } else {
    for (const u of unregistered) console.log(`  UNREGISTERED ${u.kind}: ${u.value} (${u.file})`);
  }

  console.log("\n=== test-tenant scoping: documented non-test exceptions (not checked, listed for visibility) ===");
  const exceptions = REGISTRY.filter((r) => r.classification === "documented-exception");
  if (exceptions.length === 0) console.log("  (none in this repo)");
  for (const row of exceptions) console.log(`  ALLOWED: ${JSON.stringify(row.match)} -- ${row.note}`);

  let live = { ran: false, failures: [] };
  if (!staticOnly) {
    console.log("\n=== test-tenant scoping: live DB check of registry rows classified 'test' ===");
    live = await liveCheck();
    if (!live.ran) console.log("  SKIPPED: no DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL+SUPABASE_DB_PASSWORD in env.");
  }

  const nonTestTenantCount = unregistered.length + live.failures.length;
  console.log(`\nnon-test tenants: ${nonTestTenantCount}`);
  console.log(nonTestTenantCount === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(nonTestTenantCount === 0 ? 0 : 1);
}

main();
