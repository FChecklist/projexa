import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { VISIBLE_NAV_SECTIONS } from "./AppSidebar";

// R62 B7 regression test for F_023 (Critical): "CEO-role nav item 'Company
// Dashboard' (href /dashboard/hierarchy) client-side redirects to /ffe
// (FF&E Specification) within ~500ms of mount on every load."
//
// CLOSURE HISTORY (three independent passes -- R52, R57, and this one --
// each re-derived the same result from a fresh code read rather than
// trusting the prior pass's text): no code path anywhere in this repo has
// ever navigated to /ffe on its own. `git log -S '"/ffe"' -- src/components
// src/app` returns zero commits. The nav entry's href was never mispointed
// (AppSidebar.tsx: { labelKey: "items.companyDashboard", href:
// "/dashboard/hierarchy" }, unchanged). The most plausible original cause
// (a mis-landed click during the OLD sidebar's post-mount reflow, the same
// class R48_LAYOUT_REFLOW_01 proved for eight other faults) is now
// structurally impossible: that sidebar was deleted outright by the M24
// shell rewrite (src/app/(app)/layout.tsx no longer mounts AppSidebar at
// all -- see that file's own comment). This was closed as "confirmed not
// reproducible, root cause structurally eliminated" rather than as a shipped
// fix, since there was never a line of code to change.
//
// WHAT THIS GUARDS: since there is no fix commit to point a test at, this
// pins the three structural facts the closure actually rests on, so that if
// any of them regresses -- the nav entry gets re-pointed, a redirect to
// /ffe gets introduced anywhere, or middleware starts redirecting somewhere
// other than /login or /dashboard -- a real test fails.
const SRC_DIR = join(process.cwd(), "src");

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

describe("Company Dashboard nav entry stays pointed at /dashboard/hierarchy (F_023)", () => {
  test("the source tree is actually being walked", () => {
    expect(tsFilesUnder(SRC_DIR).length).toBeGreaterThan(100);
  });

  test('AppSidebar\'s "Company Dashboard" item has NOT been re-pointed at /ffe or anywhere else', () => {
    const overview = VISIBLE_NAV_SECTIONS.find((s) => s.titleKey === "sections.overview");
    expect(overview).toBeDefined();
    const companyDashboard = overview!.items.find((i) => i.labelKey === "items.companyDashboard");
    expect(companyDashboard).toBeDefined();
    expect(companyDashboard!.href).toBe("/dashboard/hierarchy");
  });

  test("no source file ever navigates (router.push/replace, redirect(), or window.location) to /ffe", () => {
    // The exact check the closure's "git log -S" claim encodes as a
    // re-runnable assertion instead of a one-off historical grep: a
    // navigation call whose target string is "/ffe" anywhere in src.
    const NAV_TO_FFE = /(?:router\.(?:push|replace)|redirect|window\.location(?:\.href)?\s*=)\s*\(?\s*["'`]\/ffe["'`]/;
    const offenders = tsFilesUnder(SRC_DIR)
      .filter((f) => NAV_TO_FFE.test(withoutComments(readFileSync(f, "utf8"))))
      .map((f) => f.replace(process.cwd(), ""));
    expect(offenders).toEqual([]);
  });

  test("src/middleware.ts only ever redirects to /login or /dashboard, never to /ffe or any other route", () => {
    const source = withoutComments(readFileSync(join(SRC_DIR, "middleware.ts"), "utf8"));
    const targets = [...source.matchAll(/url\.pathname\s*=\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["/login", "/dashboard"]));
  });
});
