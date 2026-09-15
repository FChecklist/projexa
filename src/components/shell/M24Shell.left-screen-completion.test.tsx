/// <reference types="bun-types" />
// LEFT SCREEN COMPLETION, 2026-09-14 -- REAL, END-TO-END drill-down coverage
// for the 7-view left panel, mounted against the ACTUAL M24Shell (not a
// reimplementation of its handlers), matching this repo's own established
// pattern for exactly this class of coverage --
// M24Shell.loaded-chain-reset.test.tsx's own header explains why: M24Shell
// is a large, heavily-context-dependent component with its own bootstrap,
// and the only way to prove a real handler (onLeftBack, onSelectReportsView,
// onLeafSelect, ...) actually does what its comment says is to mount the
// real component tree and click through it, with only the boundary a
// browser/server provides faked.
//
// PER-VIEW PROTOCOL (each `describe` below follows this, per the
// orchestrating session's own testing requirement):
//   1. drill through the view's own real selection flow to its end;
//   2. press Back and confirm it steps back through what was just selected,
//      one real level at a time -- not a no-op, not a jump to something
//      unrelated;
//   3. confirm the RIGHT pane (next/navigation's mocked router.push, into
//      the `pushed` array) syncs at the point selection actually causes a
//      navigation -- and, just as importantly, does NOT push when the real,
//      existing app design says a given selection step should not navigate
//      yet (e.g. picking "Permits" narrows the sentence; only picking one of
//      its verbs -- "New"/"Expiring soon"/"Open" -- opens a route). Both are
//      asserted explicitly below, not just the happy path.
//
// WHAT THIS FILE DOES NOT COVER: Tasks' own row-level "click a task, load
// its chain, navigate" wiring (TaskMaster -> onLoadChain -> router.push) is
// pre-existing and untouched by this feature -- it is not re-proven here,
// only that Box 1's Tasks VIEW is reachable, that its own sub-tab drill-down
// works, and that Back steps back through the sub-tab before the view.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// --- next/navigation --------------------------------------------------
const pushed: string[] = [];
let CURRENT_PATHNAME = "/dashboard";
const RealNextNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...RealNextNavigation,
  useRouter: () => ({
    push: (url: string) => pushed.push(url),
    refresh: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => CURRENT_PATHNAME,
  useSearchParams: () => new URLSearchParams("projectId=p1"),
}));

// --- @/lib/supabase/client ----------------------------------------------
const RealSupabaseClient = await import("@/lib/supabase/client");
mock.module("@/lib/supabase/client", () => ({
  ...RealSupabaseClient,
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

// --- global fetch ---------------------------------------------------------
function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const BOOTSTRAP = {
  organization: { id: "org1", name: "Skyline Builders", slug: "skyline", country: "IN" },
  role: "owner",
  email: "owner@example.com",
  userId: "u1",
  projects: [{ id: "p1", name: "Cedar Heights Villa - Phase 1" }],
  notifications: [],
  unreadCount: 0,
  pillUsage: [],
  recentChains: [],
  history: [],
  isNewUser: false,
  capabilityTree: [],
  currencies: [],
  fetchedAt: Date.now(),
  errors: {},
};
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

globalThis.fetch = mock(async (input: unknown) => {
  const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
  if (url.startsWith("/api/shell")) return fakeResponse(200, BOOTSTRAP);
  if (url.startsWith("/api/tasks")) {
    return fakeResponse(200, {
      tasks: [],
      nextCursor: null,
      counts: { total: 0, needsYou: 0, running: 0, done: 0, tabs: {} },
    });
  }
  if (url.startsWith("/api/capability-tree")) return fakeResponse(200, { nodes: [] });
  if (url.startsWith("/api/pill-usage")) return fakeResponse(200, {});
  return fakeResponse(200, {});
}) as unknown as typeof fetch;

const { VeriChatProvider } = await import("@/components/veri-chat/veri-chat-context");
const { ShellScreenProvider } = await import("@/components/shell/shell-screen-context");
const M24Shell = (await import("./M24Shell")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
  CURRENT_PATHNAME = "/dashboard";
});

function renderShell(children: ReactNode = <p>PAGE</p>) {
  return render(
    <VeriChatProvider>
      <ShellScreenProvider>
        <M24Shell>{children}</M24Shell>
      </ShellScreenProvider>
    </VeriChatProvider>
  );
}

/** Box 1's own 7-control row (see LeftScreenCompletion.tsx). Scoped by its
 *  own aria-label so it is never confused with TaskMaster's own, unlabelled
 *  role="tablist" once the Tasks view is open. */
function leftNav(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[aria-label="Left panel views"]');
  if (!el) throw new Error("Box 1's 7-control row never rendered");
  return el as HTMLElement;
}

function clickView(container: HTMLElement, label: string) {
  const tab = [...leftNav(container).querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  if (!tab) throw new Error(`no Box 1 view tab named "${label}"`);
  fireEvent.click(tab);
}

function clickBack(container: HTMLElement) {
  const btn = [...leftNav(container).querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Back one step");
  if (!btn) throw new Error("Box 1's Back control never rendered");
  fireEvent.click(btn);
}

async function bootstrapped(container: HTMLElement) {
  await waitFor(() => expect(leftNav(container)).toBeTruthy());
  // The default view ("Frequent Action") must be showing the same real band
  // R-92's own tests depend on, before any of the 7 buttons are touched.
  await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
}

describe("Left Screen Completion -- 1. MODULES (full drill-down, Back, right-pane sync at every step)", () => {
  test("Modules -> Permits -> New: each step checked, then Back walks it back one level at a time", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    // STEP 1: open the Modules view.
    clickView(container, "Modules");
    const catalogue = await waitFor(() => {
      const el = container.querySelector('[aria-label="All modules"]');
      if (!el) throw new Error("the Modules catalogue never rendered");
      return el;
    });
    // Sync check for THIS step: opening the catalogue is browsing, not a
    // commitment -- the real, existing app design (M24's own "the module
    // narrows the sentence; its verbs open routes") means the right pane
    // must NOT have navigated yet.
    expect(pushed).toEqual([]);

    // STEP 2: pick a module ("Permits").
    const permitsPill = [...catalogue.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Permits"));
    if (!permitsPill) throw new Error('no "Permits" entry in the Modules catalogue');
    fireEvent.click(permitsPill);

    // Box 1's own chain sentence syncs immediately (this IS the left pane's
    // own real-time reflection of the selection).
    await waitFor(() => expect(container.querySelector('[data-testid="left-chain-sentence"]')?.textContent).toContain("Permits"));
    // OWNER ESCALATION, 2026-09-14 (direct quote: "the sync of left
    // selections and right screen... it has to be for every selection,
    // every chain, for each step") -- SUPERSEDES this test's original
    // assertion here (`expect(pushed).toEqual([])`), which encoded the
    // shell's earlier, now-overruled rule that only a leaf/verb navigates.
    // Picking the MODULE itself now opens its own list route immediately.
    await waitFor(() => expect(pushed).toContain("/permits?projectId=p1"));

    // STEP 3: pick one of Permits' own verbs ("New") -- band 2's real leaves,
    // rendered by the same ChainOptionsPanel/`optionLevel` mechanism this
    // shell has always used.
    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Permits' own leaves never rendered");
      return el;
    });
    const newLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "New");
    if (!newLeaf) throw new Error('Permits has no "New" leaf');
    fireEvent.click(newLeaf);

    // THIS is the step that actually navigates -- the real, existing rule
    // ("it is the VERB that navigates"). Right-pane sync, checked directly.
    await waitFor(() => expect(pushed).toContain("/permits/new?projectId=p1"));

    // --- BACK, one real level at a time -----------------------------------
    // Tier 1: a leaf was picked -- Back cuts it via the SAME cutChainFrom
    // mechanism the old ControlStrip Back always used.
    clickBack(container);
    await waitFor(() => expect(container.querySelector("fieldset")).not.toBeNull());
    // "New" is offered again, and nothing is pre-selected -- genuinely
    // undone, not just hidden.
    const leavesAgain = container.querySelector("fieldset")!;
    expect([...leavesAgain.querySelectorAll('[aria-pressed="true"]')]).toHaveLength(0);

    // Tier 1 again: the module itself is still selected -- Back cuts THAT.
    clickBack(container);
    await waitFor(() => expect(container.querySelector('[aria-label="All modules"]')).not.toBeNull());
    expect(container.querySelector("fieldset")).toBeNull();

    // Tier 3: nothing left to unwind on Modules -- Back pops the view
    // history, landing back on "Frequent Action" (the view open before
    // Modules was ever clicked).
    clickBack(container);
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
    const frequentTab = [...leftNav(container).querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Frequent Action")!;
    expect(frequentTab.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Left Screen Completion -- 2. REPORTS (real MODULE_CATALOGUE entry, its own leaf, Back, sync)", () => {
  test("Reports -> Open: reuses selectEntity() like any other module, navigates, and Back walks it back", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Reports");
    // Selecting the Reports view is, itself, `selectEntity(REPORTS_MODULE)`
    // -- a real chain segment, visible immediately in Box 1's own sentence.
    await waitFor(() => expect(container.querySelector('[data-testid="left-chain-sentence"]')?.textContent).toContain("Reports"));
    // OWNER ESCALATION, 2026-09-14 -- see the Modules test's own comment
    // above for the full quote. Reports needs no project (module-catalogue.ts:
    // `reports.needsProject: false`), so the real push carries no ?projectId=.
    await waitFor(() => expect(pushed).toContain("/reports"));

    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Reports' own leaf never rendered");
      return el;
    });
    const openLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "Open");
    if (!openLeaf) throw new Error('Reports has no "Open" leaf');
    fireEvent.click(openLeaf);

    // Reports' own leaf needs no project (module-catalogue.ts:
    // `reports.open` -> `needsProject: false`), so the real href carries no
    // ?projectId= -- confirmed exactly, not just "some push happened".
    await waitFor(() => expect(pushed).toContain("/reports"));

    // Back once: the leaf is cut, the module stays selected.
    clickBack(container);
    await waitFor(() => expect(container.querySelector("fieldset")).not.toBeNull());
    // Back again: the module itself is cut.
    clickBack(container);
    await waitFor(() => expect(container.querySelector("fieldset")).toBeNull());
    // Back a third time: nothing left on Reports -- pops back to the view
    // that was open before ("Frequent Action").
    clickBack(container);
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
  });
});

describe("Left Screen Completion -- 3. DASHBOARD (real MODULE_CATALOGUE entry, 2 leaves, Back, sync)", () => {
  test("Dashboard -> Company hierarchy: a needs-no-project leaf, navigates, Back walks it back", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Dashboard");
    await waitFor(() => expect(container.querySelector('[data-testid="left-chain-sentence"]')?.textContent).toContain("Dashboard"));
    expect(pushed).toEqual([]);

    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Dashboard's own leaves never rendered");
      return el;
    });
    // Both real leaves are offered -- module-catalogue.ts's dashboard entry.
    expect([...stepGroup.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Project dashboard", "Company hierarchy"])
    );
    const hierarchyLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "Company hierarchy")!;
    fireEvent.click(hierarchyLeaf);

    await waitFor(() => expect(pushed).toContain("/dashboard/hierarchy"));

    clickBack(container);
    await waitFor(() => expect(container.querySelector("fieldset")).not.toBeNull());
    clickBack(container);
    await waitFor(() => expect(container.querySelector("fieldset")).toBeNull());
    clickBack(container);
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
  });

  // ─── BUG B INVESTIGATION, 2026-09-14/15 (live-browser report) ────────────
  //
  // Reported: after Dashboard's "Which step?" chips appeared, the right pane
  // showed a real error banner -- "Couldn't load this project's dashboard --
  // it isn't there any more (NOT_FOUND)" -- for project id
  // uya50ufhzxv5io5931o2e7nb.
  //
  // VERIFIED, NOT ASSUMED (read-only Supabase MCP query against the live
  // compliance-tracker database, pcrjmlpuqsbocqfwoxod):
  //   - The project genuinely EXISTS: compliance.projects has a row with
  //     that exact id, name "R74 Test Project", status "active",
  //     is_active=true, org_id f384a4fc-7193-4296-929c-32646879173d. It was
  //     never deleted, so "it isn't there any more" is not a literally
  //     accurate description of this project's own state.
  //   - The backend query that answers the failing endpoint
  //     (getProjectDashboards()'s SQL, construction-dashboard-service.ts)
  //     was re-run directly with this exact org_id + project id and DOES
  //     return a row -- and every join in that statement is a LEFT JOIN
  //     starting FROM the matched project row, so a project with zero
  //     BOQ/budget/progress data is never dropped from the result either.
  //     A correctly org-scoped request for this real, active project cannot
  //     legitimately 404 through this code path.
  //
  // CONCLUSION: this is NOT a routing bug in Left Screen Completion's own
  // code. `onSelectDashboardView`/`selectEntity` push DASHBOARD_MODULE's own
  // real, already-shipped route (/dashboard, which intentionally renders the
  // per-project dashboard once a project is in scope -- see
  // src/app/(app)/dashboard/page.tsx's own header), and the "Project
  // dashboard" leaf below pushes /dashboard/project -- a real route, a real
  // file on disk (src/app/(app)/dashboard/project/page.tsx), not a broken
  // link this feature invented. It is also NOT "this project legitimately
  // has no dashboard data" -- the project is real, active and the query
  // returns rows for it. The evidence instead points at a cross-context
  // org/credential resolution question in the PROJEXA<->VERIDIAN proxy layer
  // (src/lib/veridian-client.ts's per-org API key resolution) that requires
  // live login to pin down conclusively and is out of scope for this task
  // (no live browser access here, and touching multi-tenant auth/credential
  // resolution blind is a materially riskier change than leaving it
  // reported). Flagged, not silently assumed fixed.
  //
  // What IS tested here, per this task's own two acceptable encodings: the
  // routing itself -- proving "Project dashboard" is a real, served route,
  // not a broken link.
  test("BUG B: 'Project dashboard' navigates to a real, existing route -- not a broken link", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Dashboard");
    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Dashboard's own leaves never rendered");
      return el;
    });
    const projectDashboardLeaf = [...stepGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Project dashboard"
    )!;
    fireEvent.click(projectDashboardLeaf);

    // The real href module-catalogue.ts's own `dashboard.project` leaf
    // resolves to (moduleHref: needsProject defaults to true for this leaf,
    // so the harness's own project id is carried).
    await waitFor(() => expect(pushed).toContain("/dashboard/project?projectId=p1"));

    // And that route is a REAL FILE, not merely a string this test hardcodes
    // -- confirming this is not a broken/invented link.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pagePath = path.join(process.cwd(), "src/app/(app)/dashboard/project/page.tsx");
    expect(fs.existsSync(pagePath)).toBe(true);
  });
});

describe("Left Screen Completion -- 4. TASKS (its own sub-tab drill-down, Back walks the sub-tab back first)", () => {
  test("Tasks -> Approval Pending: sub-tab selection, then Back steps to Home tab, then Back again pops the view", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Tasks");
    const taskTablist = await waitFor(() => {
      const el = container.querySelector('[data-testid="left-view-content"] [role="tablist"]');
      if (!el) throw new Error("Task Master's own tab row never rendered inside the Tasks view");
      return el as HTMLElement;
    });
    // No navigation just from opening the Tasks view.
    expect(pushed).toEqual([]);

    // Task Master's own tab labels carry a count suffix when the server (or,
    // for the active tab, a client-rendered fallback) supplies one --
    // countedTabLabel's own "Home (0)" -- so matched by prefix, not equality.
    const homeSubTab = [...taskTablist.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith("Home"))!;
    expect(homeSubTab.getAttribute("aria-selected")).toBe("true");

    const approvalTab = [...taskTablist.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Approval Pending")!;
    fireEvent.click(approvalTab);
    await waitFor(() => expect(approvalTab.getAttribute("aria-selected")).toBe("true"));
    expect(homeSubTab.getAttribute("aria-selected")).toBe("false");

    // Back, tier 2: no chain is mid-build (segments empty), Tasks is active
    // and NOT on its own Home sub-tab -- step that back first.
    clickBack(container);
    await waitFor(() => expect(homeSubTab.getAttribute("aria-selected")).toBe("true"));
    expect(approvalTab.getAttribute("aria-selected")).toBe("false");
    // Still inside Tasks -- the view itself has not changed yet.
    expect(container.querySelector('[data-testid="left-view-content"] [role="tablist"]')).not.toBeNull();

    // Back again, tier 3: nothing left to unwind inside Tasks -- pops the
    // view history back to "Frequent Action".
    clickBack(container);
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
  });
});

describe("Left Screen Completion -- 5. FREQUENT ACTION (the default view, also reachable as an explicit target)", () => {
  test("is the real startup view (R-92 compatibility), and is reachable again after navigating away", async () => {
    const { container } = renderShell();
    await bootstrapped(container);
    const frequentTab = [...leftNav(container).querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Frequent Action")!;
    expect(frequentTab.getAttribute("aria-selected")).toBe("true");

    // Navigate away, then explicitly click back to it -- proving it's a
    // real, reachable target, not just an artifact of the default state.
    clickView(container, "Reports");
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).toBeNull());

    clickView(container, "Frequent Action");
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
    expect(frequentTab.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Left Screen Completion -- 6. HOME (right-pane sync only when it is a real navigation)", () => {
  test("on the home route already: no redundant push, Box 1 still switches to its own Home view", async () => {
    CURRENT_PATHNAME = "/dashboard"; // HOME_ROUTE
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Home");
    await waitFor(() => expect(container.querySelector('[data-testid="left-view-content"]')?.textContent).toContain("Jump to any module"));
    // Already on HOME_ROUTE -- a push here would be the exact "a control
    // that appears to navigate and does nothing" defect this shell has
    // documented against since R67 A-08. Confirmed it did NOT happen.
    expect(pushed).toEqual([]);
    const homeTab = [...leftNav(container).querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Home")!;
    expect(homeTab.getAttribute("aria-selected")).toBe("true");
  });

  test("from a different route: Home really does navigate the right pane", async () => {
    CURRENT_PATHNAME = "/permits";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Home");
    await waitFor(() => expect(pushed).toContain("/dashboard"));
  });
});

// ─── BUG A REGRESSION, 2026-09-14/15 (live-browser report) ─────────────────
//
// Reproduced from a fresh dashboard: click "Dashboard" (Box 1 correctly
// shows "Which step?" with the Project dashboard/Company hierarchy leaves,
// right pane navigates to DASHBOARD_MODULE's own route), then click "Home".
// Box 1 showed BOTH the Modules catalogue (Home's own, correct content) AND
// a leftover "Which step?" panel with Dashboard's own leaves, stacked
// together -- leftover chain/option state from Dashboard was not being
// cleared when switching to Home.
//
// ROOT CAUSE (verified by reading the code, not assumed): DASHBOARD_MODULE's
// own route ("/dashboard", module-catalogue.ts) IS HOME_ROUTE
// (M24Shell.tsx). So Dashboard -> Home lands on `onLeftHome`'s
// `screen.pathname === HOME_ROUTE` branch -- a genuine no-op navigation, the
// pathname never changes -- which is also the ONLY condition under which the
// `screen.pathname` effect (the ONE other place `segments` is cleared on an
// ordinary navigation) never re-runs. The Dashboard action segment
// `selectEntity` set therefore survived into "home", `optionLevel` kept
// resolving it every render from that stale `segments` entry, and Box 2's
// `conversation` band (Composer.tsx) -- whose fallback to `optionLevel` is
// gated on `boxOneShowsOptionLevel`, which deliberately does NOT include
// "home" because Box 1's own Home content is always the plain module
// catalogue, never `optionLevel` -- went on rendering it as a stale,
// disconnected "Which step?" panel next to Home's own Modules catalogue.
describe("BUG A (2026-09-14/15 live report) -- Home after Dashboard was active never shows a stale 'Which step?' panel", () => {
  test("Dashboard's own leaves panel is gone the moment Home is selected, alongside Home's real Modules catalogue", async () => {
    // DASHBOARD_MODULE's own route is HOME_ROUTE itself -- start there, same
    // as the live repro's "fresh dashboard" starting point.
    CURRENT_PATHNAME = "/dashboard";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Dashboard");
    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Dashboard's own leaves never rendered");
      return el;
    });
    expect([...stepGroup.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Project dashboard", "Company hierarchy"])
    );
    // Dashboard's own module route IS HOME_ROUTE, so this click is a genuine
    // no-op navigation -- confirmed, matching the live repro's own
    // observation that the URL did not change on this click either.
    expect(pushed).toEqual([]);

    clickView(container, "Home");

    // Home's own, correct content -- the Modules catalogue.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="left-view-content"]')?.textContent).toContain("Jump to any module")
    );
    // THE BUG: no leftover "Which step?" fieldset anywhere in the tree --
    // neither in Box 1 (which never showed one for "home" to begin with) nor
    // in Box 2's `conversation` band, where the stale panel actually
    // rendered.
    expect(container.querySelector("fieldset")).toBeNull();
    // And no redundant push either -- Home's own no-op-navigation rule is
    // unaffected by this fix.
    expect(pushed).toEqual([]);
  });
});

describe("Left Screen Completion -- structural invariant: never two views' content at once", () => {
  test("switching views never leaves a PREVIOUS view's own marker on screen", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    // Frequent Action's own marker.
    expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull();

    clickView(container, "Modules");
    await waitFor(() => expect(container.querySelector('[aria-label="All modules"]')).not.toBeNull());
    // Frequent Action's marker is GONE, not merely hidden behind the new one.
    expect(container.querySelector('[aria-label="Things you can do"]')).toBeNull();

    clickView(container, "Tasks");
    await waitFor(() => expect(container.querySelector('[data-testid="left-view-content"] [role="tablist"]')).not.toBeNull());
    expect(container.querySelector('[aria-label="All modules"]')).toBeNull();
    expect(container.querySelector('[aria-label="Things you can do"]')).toBeNull();
  });
});

// ─── BUG-FIX REGRESSION SUITE, 2026-09-14 ──────────────────────────────────
//
// Covers the 4 live bugs the orchestrating session found by hand in a real
// authenticated browser session, plus the owner's own mid-task escalation on
// bug 2 ("the sync of left selections and right screen... it has to be for
// every selection, every chain, for each step" -- overruling this shell's
// earlier "only the verb navigates" rule). Each `describe` names the bug it
// reproduces and proves fixed.

describe("BUG 1 + BUG 2 -- Tasks/Modules tab sync when opened from a stale route left behind by a deeper selection", () => {
  // Reproduces the orchestrating session's exact live repro: Modules ->
  // Permits -> New Permit (right pane lands on /permits/new), THEN switch to
  // Tasks. Simulated here by rendering with that pathname already current --
  // this test harness's router mock does not make `usePathname()` reactive
  // to an earlier `router.push()` call within the same render (see the
  // "every step" suite below for why that is the right tool for THAT job),
  // so the equivalent, harness-honest way to prove this fix is to arrive on
  // the stale route directly, exactly as `describe "6. HOME"` already does
  // for the same reason.
  test("Tasks: opens Task Master's real content and navigates the right pane home, not a stuck skeleton over the old Permits form", async () => {
    CURRENT_PATHNAME = "/permits/new";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Tasks");
    // BUG 1's own reported symptom: Task Master's real tab row (Home/
    // Approval Pending/In Queue/Completed/History) must render -- not a
    // stuck loading skeleton, not the Permits screen's own leftover
    // composer suggestions bleeding through because the right pane never
    // left /permits/new.
    await waitFor(() => expect(container.querySelector('[data-testid="left-view-content"] [role="tablist"]')).not.toBeNull());
    // BUG 2's escalated requirement: opening Tasks itself is a real
    // selection and must sync the right pane too, not leave it on a route
    // that belongs to a screen Box 1 no longer shows.
    await waitFor(() => expect(pushed).toContain("/dashboard"));
  });

  test("Modules: same stale-route sync when the catalogue is opened", async () => {
    CURRENT_PATHNAME = "/permits/new";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Modules");
    await waitFor(() => expect(container.querySelector('[aria-label="All modules"]')).not.toBeNull());
    await waitFor(() => expect(pushed).toContain("/dashboard"));
  });

  test("Frequent Action is exempt by design: it describes whatever screen is already on the right, so it must NOT force a navigation away from a real in-progress screen", async () => {
    CURRENT_PATHNAME = "/permits/new";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Frequent Action");
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());
    expect(pushed).toEqual([]);
  });
});

describe("BUG 2 (owner escalation) -- right-pane sync fires at EVERY step of a chain, not only the final leaf", () => {
  test("Modules -> Permits -> New: pushed grows by exactly one real navigation at each step, in order", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Modules");
    const catalogue = await waitFor(() => {
      const el = container.querySelector('[aria-label="All modules"]');
      if (!el) throw new Error("the Modules catalogue never rendered");
      return el;
    });
    // Tab-level step: already on /dashboard (this suite's default), so no
    // redundant push -- see the guard on `onLeftSelectView`.
    expect(pushed).toEqual([]);

    const permitsPill = [...catalogue.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Permits"));
    if (!permitsPill) throw new Error('no "Permits" entry in the Modules catalogue');
    fireEvent.click(permitsPill);
    // Module-level step: picking Permits opens its own list route, before
    // any verb is chosen.
    await waitFor(() => expect(pushed).toEqual(["/permits?projectId=p1"]));

    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Permits' own leaves never rendered");
      return el;
    });
    const newLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "New");
    if (!newLeaf) throw new Error('Permits has no "New" leaf');
    fireEvent.click(newLeaf);
    // Leaf/verb-level step: unchanged from this shell's original rule --
    // the leaf's own real route, appended, not replacing the step above.
    await waitFor(() => expect(pushed).toEqual(["/permits?projectId=p1", "/permits/new?projectId=p1"]));
  });

  test("Reports -> Open: the tab-level module pick AND the leaf both push, in order", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Reports");
    await waitFor(() => expect(pushed).toEqual(["/reports"]));

    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Reports' own leaf never rendered");
      return el;
    });
    const openLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "Open");
    if (!openLeaf) throw new Error('Reports has no "Open" leaf');
    fireEvent.click(openLeaf);
    // Reports' own leaf resolves to the same route as the module itself
    // (module-catalogue.ts: `reports.open` -> "/reports", needsProject
    // false) -- so the SAME href is pushed a second time, honestly, rather
    // than suppressed for looking redundant.
    await waitFor(() => expect(pushed).toEqual(["/reports", "/reports"]));
  });
});

describe("BUG 3 -- the 'Which step?' panel renders exactly once, never stacked twice", () => {
  // Reproduces the orchestrating session's exact live repro: select a
  // module while standing on one of the three views that render
  // `optionLevel` INSIDE Box 1 (Modules/Reports/Dashboard) -- the
  // Composer's own separate `conversation` band used to fall back to the
  // very same `optionLevel` element with no gate checking whether Box 1 was
  // already showing it, so both rendered it at once. `boxOneShowsOptionLevel`
  // (see M24Shell.tsx, right above `leftViewContent`) is the fix.
  test("Modules -> Permits: exactly one 'Which step?' panel renders, not two stacked copies", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Modules");
    const catalogue = await waitFor(() => container.querySelector('[aria-label="All modules"]')!);
    const permitsPill = [...catalogue.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Permits"))!;
    fireEvent.click(permitsPill);

    await waitFor(() => expect(container.querySelectorAll("fieldset").length).toBeGreaterThan(0));
    expect(container.querySelectorAll("fieldset").length).toBe(1);
  });

  test("Reports: exactly one panel, same rule", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Reports");
    await waitFor(() => expect(container.querySelectorAll("fieldset").length).toBeGreaterThan(0));
    expect(container.querySelectorAll("fieldset").length).toBe(1);
  });
});

describe("BUG 2 -- Back walks the right pane back through the same steps it walked forward, not just the chain sentence", () => {
  test("Back cuts a leaf and returns the right pane to the module's own list route", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Modules");
    const catalogue = await waitFor(() => container.querySelector('[aria-label="All modules"]')!);
    const permitsPill = [...catalogue.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Permits"))!;
    fireEvent.click(permitsPill);
    await waitFor(() => expect(pushed).toContain("/permits?projectId=p1"));

    const stepGroup = await waitFor(() => container.querySelector("fieldset")!);
    const newLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "New")!;
    fireEvent.click(newLeaf);
    await waitFor(() => expect(pushed).toContain("/permits/new?projectId=p1"));

    // Back once: the "New" leaf is cut. The right pane must return to
    // Permits' own list route -- the same route picking the module alone
    // (with no leaf yet) already opens -- not stay on /permits/new. This is
    // the original bug 2 report, reproduced and fixed: Back used to walk
    // only the chain sentence back while the right pane stayed exactly
    // where it was.
    clickBack(container);
    await waitFor(() => expect(pushed[pushed.length - 1]).toBe("/permits?projectId=p1"));
  });

  test("Back cuts a bare module selection (no leaf chosen yet) and returns the right pane to the module directory", async () => {
    // A pathname OTHER than HOME_ROUTE, set up front (this harness's router
    // mock does not make `usePathname()` reactive to an earlier `push()`
    // within the same render -- see the stale-route suite above for the
    // same technique), so the module-directory push this assertion checks
    // for is unambiguously Back's own doing, not a no-op against an
    // already-current route.
    CURRENT_PATHNAME = "/dashboard/hierarchy";
    const { container } = renderShell();
    await bootstrapped(container);

    clickView(container, "Dashboard");
    // Picking the module itself (Dashboard, via selectEntity) opens its own
    // list route first.
    await waitFor(() => expect(pushed).toContain("/dashboard?projectId=p1"));

    // Back, with no leaf picked yet: the module segment itself is cut,
    // leaving nothing selected -- the right pane must land on the module
    // directory (HOME_ROUTE), the same "nothing selected" destination a
    // fresh Modules/Tasks tab click uses.
    clickBack(container);
    await waitFor(() => expect(pushed[pushed.length - 1]).toBe("/dashboard"));
  });
});

// ─── BUG-FIX REGRESSION SUITE, 2026-09-14 PART 2 ───────────────────────────
//
// Every suite above shares one real harness limitation, documented on
// `CURRENT_PATHNAME` at the top of this file and in the "Modules -> Permits
// -> New" test's own inline notes: this mock's `usePathname()` never
// actually changes mid-test as a RESULT of a `router.push()` call --
// `CURRENT_PATHNAME` is only ever reassigned BEFORE `renderShell()`. That is
// exactly why a real, live-browser-reproduced bug was invisible to every one
// of those tests: it lives inside M24Shell.tsx's OWN `lastPathRef`
// navigation effect, which only runs again when `usePathname()` genuinely
// returns a NEW value on a later render -- something no suite above ever
// triggers. This suite closes that gap on purpose: after a click produces a
// real push, it sets `CURRENT_PATHNAME` to the pushed route (exactly what
// Next's own router would resolve to a tick later) and calls RTL's
// `rerender()` with a structurally identical tree, which re-invokes every
// hook against the new value -- including `usePathname()` -- while
// preserving all of M24Shell's own component state, the same as a real
// navigation landing.
function shellTree() {
  return (
    <VeriChatProvider>
      <ShellScreenProvider>
        <M24Shell>
          <p>PAGE</p>
        </M24Shell>
      </ShellScreenProvider>
    </VeriChatProvider>
  );
}

describe("BUG FIX (2026-09-14) -- Back does not lag a click behind a REAL route change", () => {
  test("Modules -> Permits -> New -> Back: the right pane navigates on the FIRST Back click and lands on the Permits module tier, not a lagged second click that skips straight past it", async () => {
    const { container, rerender } = render(shellTree());
    await bootstrapped(container);

    clickView(container, "Modules");
    const catalogue = await waitFor(() => {
      const el = container.querySelector('[aria-label="All modules"]');
      if (!el) throw new Error("the Modules catalogue never rendered");
      return el;
    });
    const permitsPill = [...catalogue.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Permits"));
    if (!permitsPill) throw new Error('no "Permits" entry in the Modules catalogue');
    fireEvent.click(permitsPill);
    await waitFor(() => expect(pushed).toContain("/permits?projectId=p1"));

    // The real router landing on /permits, one tick later -- exactly like
    // the live app, and exactly what `selectEntity`'s own `selfModuleNavRef`
    // guard is written to survive.
    CURRENT_PATHNAME = "/permits";
    rerender(shellTree());

    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("Permits' own leaves never rendered");
      return el;
    });
    const newLeaf = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "New");
    if (!newLeaf) throw new Error('Permits has no "New" leaf');
    fireEvent.click(newLeaf);
    await waitFor(() => expect(pushed).toContain("/permits/new?projectId=p1"));

    // The real router landing on /permits/new -- this is the exact moment
    // the live bug fired: the navigation effect used to wipe `segments`
    // here because `onLeafSelect`'s own push carried no `selfModuleNavRef`
    // guard.
    CURRENT_PATHNAME = "/permits/new";
    rerender(shellTree());

    // Box 1's own header must not double-name anything now that the route
    // has genuinely landed on Permits' own leaf page (BUG 3's own repro --
    // "R74 Test Project › Permits › New permit", not "… › Permits › New
    // permit › Permits" or "… › New permit › Permits › New").
    await waitFor(() =>
      expect(container.querySelector('[data-testid="left-chain-sentence"]')?.textContent).toBe(
        "Cedar Heights Villa - Phase 1 › Permits › New permit"
      )
    );

    const pushedBeforeBack = pushed.length;

    // THE FIRST BACK CLICK. Before the fix: `segments` had already been
    // silently cleared to `[]` by the navigation effect the instant
    // /permits/new landed, so `onLeftBack`'s tier 1 (`segments.length > 0`)
    // was skipped on this exact click and it fell straight to tier 3 -- which
    // only changes Box 1's own view (popping to "Frequent Action", which has
    // no destination of its own) and pushes NOTHING on this click.
    clickBack(container);
    await waitFor(() => expect(pushed.length).toBe(pushedBeforeBack + 1));
    // The right pane moved on THIS click, to Permits' own list route -- not
    // still sitting on /permits/new waiting for a second Back press.
    expect(pushed[pushed.length - 1]).toBe("/permits?projectId=p1");
    // Box 1's own view is still "Modules" -- this click did not ALSO jump
    // the view itself to "Frequent Action" (the original bug's other
    // symptom: the left panel's own tier skipped ahead of the right pane).
    const modulesTab = [...leftNav(container).querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Modules")!;
    expect(modulesTab.getAttribute("aria-selected")).toBe("true");

    // The real router landing on /permits, exactly as it did after every
    // earlier push in this test -- the same one-tick-later simulation, now
    // for THIS click's own navigation.
    CURRENT_PATHNAME = "/permits";
    rerender(shellTree());

    // Landed on the PERMITS MODULE TIER specifically -- its own leaf list is
    // showing again, with nothing selected -- not skipped past it to
    // "Frequent Action" or all the way back out to the module catalogue.
    const leavesAgain = container.querySelector("fieldset");
    expect(leavesAgain).not.toBeNull();
    expect([...leavesAgain!.querySelectorAll('[aria-pressed="true"]')]).toHaveLength(0);

    // THE SECOND BACK CLICK -- one more real level, landing on the bare
    // module directory (HOME_ROUTE), exactly one tier per click.
    clickBack(container);
    await waitFor(() => expect(pushed[pushed.length - 1]).toBe("/dashboard"));
    expect(container.querySelector("fieldset")).toBeNull();
  });
});

describe("BUG FIX (2026-09-14) -- opening Tasks from a fresh Home/dashboard state actually asks for tasks", () => {
  // TASK_REVALIDATE_MS (M24Shell.tsx, private): 5 * 60_000. Duplicated here
  // rather than imported -- it is not exported, and this file already
  // duplicates other private-module facts the same way (e.g. HOME_ROUTE's
  // real value, asserted against throughout the suites above).
  const TASK_REVALIDATE_MS = 5 * 60_000;

  function fetchCalls(): unknown[][] {
    return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  }
  function tasksCallCount(from: number): number {
    return fetchCalls()
      .slice(from)
      .filter(([input]) => {
        const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
        return url.startsWith("/api/tasks");
      }).length;
  }

  test("clicking the Tasks view when no earlier navigation or tab switch has happened still fetches /api/tasks", async () => {
    const { container } = renderShell();
    await bootstrapped(container);

    // The mount-time bootstrap already issues its own GET /api/tasks for the
    // default "home" sub-tab (M24Shell.tsx's own `loadTasks` mount effect) --
    // wait for that to settle, then record where it left off, so the
    // assertion below is about what the CLICK does, not what mounting
    // already did.
    await waitFor(() => expect(tasksCallCount(0)).toBeGreaterThan(0));
    const callsAtMount = fetchCalls().length;

    // The mount-time fetch's own per-tab staleness bookkeeping
    // (`tasksFetchedAtRef`) would otherwise correctly suppress a second read
    // moments later -- real, intended behaviour (see that effect's own
    // comment: a tab visited under 5 minutes ago should not refetch). Pushed
    // past that window here so this test is unambiguously about the CLICK's
    // own job (asking again because the view was just opened after being
    // stale), not a race against real wall-clock time.
    const RealDateNow = Date.now;
    Date.now = () => RealDateNow() + TASK_REVALIDATE_MS + 1000;
    try {
      // Never navigated anywhere, never touched a sub-tab -- a "fresh
      // dashboard/home state" click, exactly the coordinator's own live
      // repro. Before the fix: `onLeftSelectView`'s "tasks" branch touched
      // neither `activeTab` nor (already on HOME_ROUTE) `pathname`, so the
      // effect that owns `loadTasks()` never saw a changed dependency and
      // never re-ran -- confirmed live via the dev server's own request log
      // showing zero new `/api/tasks` calls after the click.
      clickView(container, "Tasks");

      await waitFor(() => expect(container.querySelector('[data-testid="left-view-content"] [role="tablist"]')).not.toBeNull());
      // A real, additional GET /api/tasks happened because Box 1's own Tasks
      // view was opened while the last read was stale -- not merely because
      // the shell had already fetched it once at mount regardless of
      // whether anyone ever opens this view.
      await waitFor(() => expect(tasksCallCount(callsAtMount)).toBeGreaterThan(0));
    } finally {
      Date.now = RealDateNow;
    }
  });

  test("clicking Tasks again while the last read is still fresh does not re-fetch (the staleness gate still applies)", async () => {
    const { container } = renderShell();
    await bootstrapped(container);
    await waitFor(() => expect(tasksCallCount(0)).toBeGreaterThan(0));
    const callsAtMount = fetchCalls().length;

    // No clock manipulation this time: the mount-time read is only moments
    // old, well inside TASK_REVALIDATE_MS.
    clickView(container, "Tasks");
    await waitFor(() => expect(container.querySelector('[data-testid="left-view-content"] [role="tablist"]')).not.toBeNull());

    // Give any (wrongly) unconditional fetch a moment to have shown up.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tasksCallCount(callsAtMount)).toBe(0);
  });
});
