/// <reference types="bun-types" />
// R67 D-61 (audit R-198 / R-226). eslint.config.mjs carries the rule -- a
// direct toLocaleString/toFixed/toLocaleDateString/toLocaleTimeString call
// anywhere under src/components or src/app is an error, because each of those
// picks the RUNTIME's own locale and produced the four competing money and date
// formats the audit measured in a single visit.
//
// The rule ships with an exemption list, NOT_YET_SWEPT, holding the screens
// this item did not reach. An exemption list is the usual way a sweep like this
// quietly stops halfway: entries outlive the defect, or a new one is added to
// silence the rule. This test is what stops both.
//
//   - every listed path must EXIST      -> a rename cannot smuggle an exemption
//   - every listed file must still OFFEND -> the exemption dies with the defect
//   - the swept files must NOT be listed -> what was fixed cannot be re-exempted
//   - eslint.config.mjs must consume the same module -> one source, not two
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BANNED_METHODS, NOT_YET_SWEPT, RULE_FILES } from "../../eslint-rules/money-format.mjs";

const ROOT = process.cwd();

/**
 * Source with comments removed, so a file whose only remaining mention of a
 * banned method is the comment EXPLAINING what it replaced does not read as an
 * offender. (ESLint works on the AST and already ignores comments; this is the
 * cheap equivalent for a file-level scan.)
 *
 * Walks the text once, tracking whether it is inside a string, a template
 * literal, a regex-free // comment or a block comment -- string bodies are kept
 * verbatim so a "https://…" inside one cannot be mistaken for a comment.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      if (c === "\n") out += c;
      i++; continue;
    }
    // inside a string or template literal
    if (c === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
    if (c === mode) mode = "code";
    out += c;
    i++;
  }
  return out;
}

/**
 * Every file this suite inspects, read and comment-stripped ONCE.
 *
 * The cache is built at module scope on purpose. Two of the tests below scan
 * overlapping sets of ~50 files, and doing the read plus the char-by-char
 * stripComments() inside each test cost ~9.6 s on a cold checkout -- past bun's
 * default 5 s per-test timeout, so this suite FAILED on CI (always a cold
 * checkout) and passed locally on the second, warm run. The work is identical
 * either way; only where it is paid changes. The two file-scanning tests also
 * carry an explicit timeout, because a cold disk is slow for reasons this
 * process does not control and a timeout is not the failure worth reporting.
 */
const BANNED_PATTERNS = BANNED_METHODS.map((m) => new RegExp(`\\.${m}\\s*\\(`));
const strippedCache = new Map<string, string | null>();

function stripped(relPath: string): string | null {
  if (!strippedCache.has(relPath)) {
    const abs = join(ROOT, relPath);
    strippedCache.set(relPath, existsSync(abs) ? stripComments(readFileSync(abs, "utf8")) : null);
  }
  return strippedCache.get(relPath)!;
}

function offends(relPath: string): boolean {
  const code = stripped(relPath);
  return code !== null && BANNED_PATTERNS.some((re) => re.test(code));
}

/** Generous, because a cold CI checkout reads these files off a cold disk. */
const FILE_SCAN_TIMEOUT_MS = 30_000;

/**
 * The screens that must be clean AND unlisted.
 *
 * Not all of them were swept by THIS lane. DashboardHomeView,
 * DashboardProjectClient, WorkProgressReportClient, MaterialsClient and
 * ReportsClient were swept by lane G's G-05, which shipped the shared
 * src/lib/format-money.ts and src/lib/format-number.ts that D-61's own draft
 * module was dropped in favour of at the merge. Which lane fixed a file does
 * not change what this list is for: once a screen is clean it may never be
 * re-exempted.
 */
const SWEPT = [
  "src/components/DashboardHomeView.tsx",
  "src/components/DashboardProjectClient.tsx",
  "src/components/WorkProgressReportClient.tsx",
  "src/components/MaterialsClient.tsx",
  "src/components/ReportsClient.tsx",
  "src/components/ReportOutput.tsx",
  "src/components/BudgetAnalyticalClient.tsx",
  "src/components/ProjectsListClient.tsx",
  "src/components/screens/KpiCard.tsx",
  "src/app/share/report/[token]/page.tsx",
];

describe("the money/number/date formatting rule", () => {
  test("covers the two directories that render, and names all four methods", () => {
    expect(RULE_FILES).toEqual(["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"]);
    expect(BANNED_METHODS).toEqual(["toLocaleString", "toFixed", "toLocaleDateString", "toLocaleTimeString"]);
  });

  test("eslint.config.mjs consumes this module rather than restating the list", () => {
    const config = readFileSync(join(ROOT, "eslint.config.mjs"), "utf8");
    expect(config).toContain("./eslint-rules/money-format.mjs");
    expect(config).toContain("no-restricted-syntax");
    expect(config).toContain("NOT_YET_SWEPT");
  });
});

describe("the NOT_YET_SWEPT exemption list", () => {
  test("is not empty and not vacuous -- the scan below is really reading files", () => {
    // Without this, a list that had been emptied by a bad merge would make
    // every assertion below pass for the wrong reason.
    expect(NOT_YET_SWEPT.length).toBeGreaterThan(10);
  });

  test("every listed path exists, so a rename cannot carry an exemption with it", () => {
    const missing = NOT_YET_SWEPT.filter((p) => !existsSync(join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  test("holds no duplicates", () => {
    expect(NOT_YET_SWEPT.length).toBe(new Set(NOT_YET_SWEPT).size);
  });

  test("every listed file still offends -- an exemption cannot outlive its defect", () => {
    // When you fix one of these screens, this test fails until you delete its
    // line from NOT_YET_SWEPT. That is the intended workflow, not a nuisance:
    // it is what makes the list shrink instead of ossify.
    const stale = NOT_YET_SWEPT.filter((p) => !offends(p));
    expect(stale).toEqual([]);
  }, FILE_SCAN_TIMEOUT_MS);

  test("does not list anything this item swept", () => {
    const reExempted = SWEPT.filter((p) => NOT_YET_SWEPT.includes(p));
    expect(reExempted).toEqual([]);
  });
});

describe("the screens R67 D-61 swept", () => {
  test("all exist", () => {
    expect(SWEPT.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  test("call none of the four methods directly any more", () => {
    const offenders = SWEPT.filter((p) => offends(p));
    expect(offenders).toEqual([]);
  }, FILE_SCAN_TIMEOUT_MS);
});

describe("stripComments", () => {
  test("removes line and block comments", () => {
    expect(stripComments("a // n.toFixed(2)\nb").includes("toFixed")).toBe(false);
    expect(stripComments("a /* n.toFixed(2) */ b").includes("toFixed")).toBe(false);
  });

  test("keeps real code", () => {
    expect(stripComments("const x = n.toFixed(2);").includes("toFixed")).toBe(true);
  });

  test("does not treat a // inside a string as the start of a comment", () => {
    expect(stripComments('const u = "https://x"; const y = n.toFixed(2);').includes("toFixed")).toBe(true);
    expect(stripComments("const u = `https://x`; const y = n.toFixed(2);").includes("toFixed")).toBe(true);
  });

  test("keeps line numbering stable across a block comment", () => {
    expect(stripComments("a\n/* one\ntwo */\nb").split("\n").length).toBe(4);
  });
});
