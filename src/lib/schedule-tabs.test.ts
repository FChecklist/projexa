/// <reference types="bun-types" />
// R62 B7 regression test for R43 F_016 (closed via PR #188).
//
// THE DEFECT (see this fault's r43_faults row and schedule-tabs.ts's own
// header comment): isScheduleTab() used to live in ScheduleTabsClient.tsx, a
// "use client" module. schedule/page.tsx is a Server Component and CALLED
// isScheduleTab(tab) directly while resolving initialTab. A function
// exported from a "use client" module becomes an opaque client reference
// when imported into a Server Component -- it can only be rendered as a
// Component or passed as a prop, never invoked directly. That mismatch
// 500'd every GET /schedule in production ("Attempted to call
// isScheduleTab() from the server but isScheduleTab is on the client",
// digest 1240219489, confirmed live 2026-08-27).
//
// THE FIX: isScheduleTab/SCHEDULE_TABS/ScheduleTab moved to this file, which
// carries no "use client" directive, so both the Server Component
// (schedule/page.tsx) and the Client Component (ScheduleTabsClient.tsx,
// which re-exports these three for anyone already importing them from
// there) can import and call them directly.
//
// This regresses silently: nothing in `tsc --noEmit` or `bun run build`
// catches a Server Component calling a function that happens to live in a
// "use client" file -- it is a runtime-only failure (a Next.js
// server/client boundary violation), which is exactly why it reached
// production. The two structural assertions below are what actually would
// have caught it before deploy.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEDULE_TABS_MODULE = join(process.cwd(), "src", "lib", "schedule-tabs.ts");
const SCHEDULE_PAGE = join(process.cwd(), "src", "app", "(app)", "schedule", "page.tsx");

describe("schedule-tabs.ts stays a server-safe module (R43 F_016)", () => {
  test("the module carries no 'use client' directive", () => {
    const source = readFileSync(SCHEDULE_TABS_MODULE, "utf8");
    const firstNonCommentLine = source
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("//"));
    // A "use client" directive must be the very first statement in the file
    // to take effect -- checking the whole file would also flag this
    // comment block itself, which quotes the phrase for documentation.
    expect(firstNonCommentLine?.replace(/;$/, "")).not.toBe('"use client"');
    expect(firstNonCommentLine?.replace(/;$/, "")).not.toBe("'use client'");
  });

  test("schedule/page.tsx (a Server Component) imports isScheduleTab from the server-safe module, not from the 'use client' tabs component", () => {
    const source = readFileSync(SCHEDULE_PAGE, "utf8");
    expect(source).toMatch(/import\s*\{\s*isScheduleTab\s*\}\s*from\s*["']@\/lib\/schedule-tabs["']/);
    // Guards against a regression that re-adds a second import of the same
    // name from the client module instead of just re-pointing this one.
    expect(source).not.toMatch(/isScheduleTab.*from\s*["']@\/components\/ScheduleTabsClient["']/);
  });

  test("isScheduleTab correctly classifies valid and invalid tab values (the extraction did not change its behavior)", async () => {
    const { isScheduleTab, SCHEDULE_TABS } = await import("./schedule-tabs");
    for (const tab of SCHEDULE_TABS) expect(isScheduleTab(tab)).toBe(true);
    expect(isScheduleTab("not-a-real-tab")).toBe(false);
    expect(isScheduleTab(undefined)).toBe(false);
    expect(isScheduleTab("")).toBe(false);
  });
});
