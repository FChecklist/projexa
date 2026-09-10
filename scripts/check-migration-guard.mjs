#!/usr/bin/env bun
// P2.1 (W-ENV, R81 Addendum B phase S5): additive-only migration guard.
//
// WHAT. Scans every *.sql file in a migrations directory (default: drizzle/)
// for destructive DDL -- DROP TABLE, DROP COLUMN, a destructive ALTER TABLE
// (one that itself contains a DROP), or TRUNCATE -- and fails (exit 1) if it
// finds any that is not covered by an explicit, reviewed opt-out marker.
//
// WHY. The shared-database model in R81-ADDENDUM-B Part A means a migration
// applied in development is live in production the same instant (there is no
// promotion step for schema -- only code moves between environments via
// GitHub). A destructive migration merged to main is therefore a production
// incident, not a review comment. This check exists to make that structurally
// hard to do by accident, while still allowing a genuinely-reviewed
// destructive change (e.g. dropping a column that really is dead) to proceed
// with a paper trail.
//
// OPT-OUT MARKER. A migration file that must contain destructive DDL (a real,
// reviewed exception) opts out by including a line matching:
//   -- MIGRATION-GUARD-OVERRIDE: reviewed by <name> on <date> - <reason>
// The marker must be non-empty after the colon. Its presence is still
// reported (never silent) -- it downgrades a FAIL to a logged EXCEPTION, it
// does not suppress the finding.
//
// USAGE.
//   bun scripts/check-migration-guard.mjs [dir]      # scan a real dir (default: drizzle)
//   bun scripts/check-migration-guard.mjs --self-test  # run against the bundled clean+destructive fixtures
//
// EXIT CODE. 0 = clean (no unreviewed destructive DDL). 1 = destructive DDL
// found without an override marker, OR the scan target does not exist.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PATTERNS = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { name: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/i },
  { name: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
  // A destructive ALTER: narrowing/retyping a column can silently drop or
  // truncate data (e.g. varchar(200) -> varchar(20), numeric -> integer).
  // Deliberately NOT matched here: ALTER TABLE ... DROP CONSTRAINT, DROP
  // DEFAULT, DROP NOT NULL -- all schema-only, no data loss. The real repo
  // (drizzle/0012_membership_roles_pm_site_engineer.sql) does
  // `drop constraint ... ; add constraint ...` to widen a CHECK constraint's
  // allowed values -- an earlier, broader version of this pattern
  // (`ALTER TABLE ... DROP`) false-positived on exactly that file, which is
  // why constraint/default/not-null drops are excluded by name instead of
  // matching any DROP under ALTER TABLE.
  { name: "destructive ALTER (ALTER COLUMN ... TYPE, may drop/truncate data on cast)", re: /\bALTER\s+TABLE\b[^;]*?\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/is },
];

const OVERRIDE_RE = /--\s*MIGRATION-GUARD-OVERRIDE:\s*(\S.+)$/im;

// Strip `-- ...` line comments before matching DDL patterns, so prose in a
// migration's own comments (e.g. a comment that happens to say "truncate" or
// "drop table" while explaining what NOT to do) can't false-positive the
// guard. The override marker is matched against the *original* text
// separately, since it deliberately lives in a comment.
function stripLineComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function scanFile(path) {
  const text = readFileSync(path, "utf8");
  const code = stripLineComments(text);
  const hits = PATTERNS.filter((p) => p.re.test(code)).map((p) => p.name);
  const overrideMatch = text.match(OVERRIDE_RE);
  return {
    path,
    hits,
    overridden: hits.length > 0 && !!overrideMatch,
    overrideReason: overrideMatch ? overrideMatch[1].trim() : null,
  };
}

function scanDir(dir) {
  if (!existsSync(dir)) {
    return { ok: false, error: `directory does not exist: ${dir}`, results: [] };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const results = files.map((f) => scanFile(join(dir, f)));
  const unreviewed = results.filter((r) => r.hits.length > 0 && !r.overridden);
  const reviewed = results.filter((r) => r.hits.length > 0 && r.overridden);
  return { ok: unreviewed.length === 0, results, unreviewed, reviewed };
}

function printReport(label, report) {
  console.log(`\n=== migration guard: ${label} ===`);
  if (report.error) {
    console.log(`ERROR: ${report.error}`);
    return;
  }
  if (report.results.length === 0) {
    console.log("(no .sql files found)");
  }
  for (const r of report.results) {
    if (r.hits.length === 0) continue;
    const tag = r.overridden ? "EXCEPTION (reviewed)" : "FAIL (destructive, unreviewed)";
    console.log(`  ${tag}: ${r.path}`);
    console.log(`    patterns: ${r.hits.join(", ")}`);
    if (r.overrideReason) console.log(`    override reason: ${r.overrideReason}`);
  }
  console.log(`clean/reviewed: ${report.results.length - report.unreviewed.length}/${report.results.length} files pass; unreviewed destructive: ${report.unreviewed.length}`);
  console.log(report.ok ? "RESULT: PASS" : "RESULT: FAIL");
}

function selfTest() {
  const fixDir = join(__dirname, "__fixtures__", "migration-guard");
  const cleanReport = scanDir(join(fixDir, "clean"));
  const destructiveReport = scanDir(join(fixDir, "destructive"));
  const reviewedReport = scanDir(join(fixDir, "reviewed-exception"));
  printReport("clean fixture (expect PASS)", cleanReport);
  printReport("destructive fixture (expect FAIL)", destructiveReport);
  printReport("reviewed-exception fixture (expect PASS with logged exception)", reviewedReport);

  const cleanOk = cleanReport.ok === true;
  const destructiveCorrectlyFails = destructiveReport.ok === false;
  const reviewedOk = reviewedReport.ok === true && reviewedReport.reviewed.length > 0;

  console.log("\n=== self-test summary ===");
  console.log(`clean fixture passes:               ${cleanOk}`);
  console.log(`destructive fixture correctly FAILS: ${destructiveCorrectlyFails}`);
  console.log(`reviewed-exception fixture passes:  ${reviewedOk}`);
  const allOk = cleanOk && destructiveCorrectlyFails && reviewedOk;
  console.log(allOk ? "SELF-TEST: PASS" : "SELF-TEST: FAIL");
  process.exit(allOk ? 0 : 1);
}

const arg = process.argv[2];
if (arg === "--self-test") {
  selfTest();
} else {
  const dir = arg || "drizzle";
  const report = scanDir(dir);
  printReport(dir, report);
  process.exit(report.ok ? 0 : 1);
}
