import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// R52 -- regression guard for fault R48_DUAL_MAIN_LANDMARK_01.
//
// THE DEFECT: every authenticated page rendered TWO <main> landmarks.
// The shell owns one (@fchecklist/veridian-ui-kit/shell AppShell.tsx:94
// wraps {children} in <main className="min-h-0 min-w-0 flex-1 ...">), and
// each page under src/app/(app) opened a SECOND one of its own
// (<main className="flex-1 space-y-6 p-6">), nested inside it.
//
// WHY IT MATTERS, twice over:
//   1. ACCESSIBILITY. HTML and WAI-ARIA allow exactly one visible `main`
//      landmark per document. A screen-reader user got two and could not
//      tell which one was the page.
//   2. INSTRUMENT DAMAGE. document.querySelector("main") returns the FIRST
//      one. Every automated check keyed on "the rendered main text" was
//      therefore measuring the wrong element -- which is how a working page
//      gets reported as blank. Fault R48_BLANK_CONTENT_NO_CREDENTIALS_01
//      was measured exactly that way.
//
// THE RULE: the shell owns the landmark. A page under (app) renders a
// plain <div>. Pages OUTSIDE that layout (src/app/auth/callback,
// src/app/invite/[token], src/app/share/report/[token]) get no shell at
// all, so their own <main> IS the document's only landmark and must stay --
// they are deliberately not walked here.
const APP_DIR = join(process.cwd(), "src", "app", "(app)");

// A <main> written inside a comment renders nothing, so strip comments
// before looking -- otherwise this file's own explanatory prose, and the
// (app)/layout.tsx comment stating this very rule, would trip the guard.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function opensAMainLandmark(file: string): boolean {
  return /<main[\s>]/.test(withoutComments(readFileSync(file, "utf8")));
}

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// R67 WS-A, review fix -- WHERE THE FILE READS HAPPEN, AND WHAT THE BUDGET IS.
//
// The rule below is unchanged; what changed is that both sweeps used to
// readFileSync every .tsx file in their tree INSIDE the test, against bun's
// default 5 s per-test budget. That is fine on a quiet machine and not on a
// loaded one: running the full suite during this fix pass, "no route file under
// src/app/(app) opens its own <main>" took 9,597 ms and failed with "this test
// timed out after 5000ms", then passed on the next run -- and CI's own
// `bun test --isolate` across all 49 files on a shared runner IS the loaded
// case. The scan now happens once, here, where no per-test timeout applies, and
// each sweep carries an explicit budget so a slow runner reports the real
// assertion rather than a timeout.
const SWEEP_TIMEOUT_MS = 30_000;

describe("single <main> landmark per page (R48_DUAL_MAIN_LANDMARK_01)", () => {
  const files = tsxFilesUnder(APP_DIR);
  const routeOffenders = files.filter(opensAMainLandmark);
  // Two client components ARE a page body -- (app)/dashboard/page.tsx and
  // (app)/dashboard/overview/page.tsx return them directly, so a <main>
  // there lands inside the shell's landmark exactly like a page's own would.
  // ui/sidebar.tsx's SidebarInset is the one legitimate <main> in this tree:
  // an unmounted shadcn primitive (nothing imports SidebarInset), kept as
  // shipped.
  const componentOffenders = tsxFilesUnder(join(process.cwd(), "src", "components"))
    .filter((f) => !f.endsWith(join("ui", "sidebar.tsx")))
    .filter(opensAMainLandmark);

  test("the (app) tree is actually being walked", () => {
    // Guards against the walk silently finding nothing and the assertion
    // below passing vacuously.
    expect(files.length).toBeGreaterThan(40);
  });

  test(
    "no route file under src/app/(app) opens its own <main>",
    () => {
      expect(routeOffenders.map((f) => f.replace(process.cwd(), ""))).toEqual([]);
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    "no page-body client component opens its own <main>",
    () => {
      expect(componentOffenders.map((f) => f.replace(process.cwd(), ""))).toEqual([]);
    },
    SWEEP_TIMEOUT_MS
  );
});
