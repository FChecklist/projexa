/// <reference types="bun-types" />
// R-92 (platform.sumeet_requirements, Supabase project pcrjmlpuqsbocqfwoxod) --
// BUG 2: A CHAIN LOADED FROM HISTORY MUST NOT SURVIVE A REAL NAVIGATION BUILT
// ON THIS SCREEN.
//
// M24Shell.tsx's onCardSelect/onLeafSelect/onScreenCardSelect all build a
// BRAND NEW chain (a ranked card, a band-2 leaf, a screen's own card) but,
// before this fix, never called setLoaded(null) -- unlike their siblings
// (selectEntity, the "view" case in onModuleEntrySelect, resetChain, openDoor)
// which all do. So `loadedChainRef` kept describing a chain the user had
// loaded from history/"Do again" ("A-09 facts") even after the user built an
// entirely different one right here, which is what the "Loaded from history"
// banner (rendered from `loadedChain` via ControlStrip's `loaded` prop) wrongly
// kept showing, and what could make the NEXT navigation's navigationOutcome()
// (chain-navigation.ts, unchanged and separately tested) wrongly "keep" a
// stale banner or wrongly "clear-all" the user's own draft instead of
// "clear-segments".
//
// THIS TEST EXERCISES THE REAL M24Shell, not a reimplementation of its
// handlers: no sibling test in this directory renders M24Shell (confirmed by
// inspection -- every file that mentions it only mentions it in a comment),
// because it is a large (3700+ line), heavily-context-dependent component
// with its own GET /api/shell bootstrap, GET /api/tasks read, a Supabase
// auth subscription and a chat-provider capability-tree fetch. Rather than
// fall back to testing a smaller, hand-picked seam that cannot actually prove
// the real onCardSelect calls setLoaded(null), this mounts the real component
// tree exactly as app/(app)/layout.tsx composes it
// (VeriChatProvider > ShellScreenProvider > M24Shell > children), with only
// the boundary a browser/server provides (next/navigation, the Supabase
// client, and every network read M24Shell/its providers make on mount)
// faked -- following this repo's own established pattern for exactly that
// boundary (project-scoped-page-error-isolation.test.tsx's next/navigation
// and @/lib/supabase/auth-guard mocks; PayrollClient.test.tsx/
// ProcurementClient.test.tsx's fetch mocks).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// --- next/navigation ---------------------------------------------------
// Spread the real module first (this repo's own documented gotcha, CLAUDE.md
// "Test-suite gotcha: mock.module() on a real module must spread it" -- an
// unspread override drops every other real export for the rest of this bun
// test PROCESS, not just this file, and has caused real cross-file failures
// here before). usePathname/useSearchParams are fixed to a plain module route
// with no active-module/entity in its own MODULE_CATALOGUE entry
// (chainModule: false for "/dashboard"), so `cardsFor()` returns no screen
// cards and the only clickable band-3 buttons are the six ranked CARD_CATALOGUE
// cards -- exactly onCardSelect's own domain, with nothing else to click by
// accident.
const pushed: string[] = [];
// Mutable so different tests can put the shell on a different real route
// without a second mock.module() (bun's mock.module() replaces a module for
// the rest of the PROCESS -- see this repo's own CLAUDE.md gotcha quoted
// above -- so this file registers next/navigation's mock exactly once and
// lets each test just change what the fixed functions read).
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

// --- @/lib/supabase/client -----------------------------------------------
// M24Shell calls createClient() twice, for supabase.auth.getUser() (A-16's
// "whose ranking is cached") and supabase.auth.onAuthStateChange() (F_025).
// Neither real call can succeed against a fake project in this env, and
// neither is what this test is about -- both are faked to resolve/subscribe
// harmlessly, same spread-the-real-module rule as above.
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

// --- global fetch ----------------------------------------------------------
// Every network read M24Shell (or a provider it sits under) issues on mount:
// GET /api/shell (F-21's one bootstrap: organisation/role/projects/pillUsage/
// recentChains), GET /api/tasks (Task Master's own read), and GET
// /api/capability-tree (VeriChatProvider's own fetchTree, via the kit's
// createVeriChatContext). Anything else falls through to a harmless empty
// 200 rather than a real network call escaping this test.
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
  // Deliberately empty: a non-empty "Do again" row is a second, unrelated
  // click target in the same band this test's own click must not hit by
  // accident.
  recentChains: [],
  history: [],
  isNewUser: false,
  capabilityTree: [],
  currencies: [],
  fetchedAt: Date.now(),
  // MUST be a real, stable object -- useShell()'s own fallback is
  // `state.data?.errors ?? {}`, which allocates a BRAND NEW `{}` on every
  // render whenever this key is absent. That fresh reference then fails the
  // Object.is check in M24Shell.tsx's `shell.errors` dependency array, so the
  // effect that reads it re-fires every render and re-calls
  // setRecentChains(a new []) unconditionally, which is a real infinite
  // render loop that has nothing to do with R-92 -- confirmed by reproducing
  // it, tracing it to this exact omission, and fixing it here rather than
  // papering over it with an unrelated workaround.
  errors: {},
};
// happy-dom has no real layout engine -- every element's
// getBoundingClientRect() is always {height:0,...}. Composer.tsx's own
// height-measurement effects (a deliberate useLayoutEffect with NO
// dependency array, plus a ResizeObserver, both documented in that file as
// intentional real-browser resilience) are not what this test is about;
// stubbed to a no-op so measuring a permanently-zero box cannot recurse.
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

// Dynamic imports, after every mock.module()/fetch stub above, for the same
// reason project-scoped-page-error-isolation.test.tsx's do: a static import
// would be hoisted above the mocks and pick up the real next/navigation and
// @/lib/supabase/client instead.
const { VeriChatProvider } = await import("@/components/veri-chat/veri-chat-context");
const { ShellScreenProvider } = await import("@/components/shell/shell-screen-context");
const M24Shell = (await import("./M24Shell")).default;
const { useShellChain } = await import("./shell-chain-context");

afterEach(() => {
  cleanup();
  pushed.length = 0;
  CURRENT_PATHNAME = "/dashboard";
});

/** Renders the real (app) layout composition -- VeriChatProvider >
 *  ShellScreenProvider > M24Shell > children -- exactly as
 *  src/app/(app)/layout.tsx wires it, with `children` a probe that can pull
 *  the shell's own loadChain() (ShellChainApi, the same handle a real page's
 *  History/"Do again" click reaches through) and render nothing else. */
function Probe() {
  // ShellChainApi.loadChain's real signature is (chain: Chain, route?: string)
  // => void -- M24Shell.tsx's own shellChainApi wires it as
  // `(c, route) => onLoadChain(loadChain(c, route))`, using the kit's loadChain
  // to build the ChainLoad onLoadChain actually consumes. Calling it with the
  // same two-argument shape a real page does (ChainDoor.test.tsx's own
  // ShellChainApi mock confirms this shape), not a hand-built ChainLoad.
  const { loadChain } = useShellChain();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          loadChain(
            {
              mode: "projects",
              segments: [
                { id: "p1", label: "Cedar Heights Villa - Phase 1", kind: "root" },
                { id: "work-progress.entry", label: "Record progress", kind: "action" },
              ],
            } as never
            // No route: this only has to set the loaded-chain FACTS (what the
            // banner reads), not also exercise router.push -- keeps the probe's
            // one job the fact this test is about.
          )
        }
      >
        Load a chain from history
      </button>
      {/* onLeafSelect's own test needs `selectedModule` to STAY "permits"
          through the load (M24Shell.tsx's onLoadChain calls setSegments(),
          which replaces whatever segments picking "Permits" had just set --
          confirmed live: the first version of that test picked "Permits"
          THEN loaded the generic chain above, and the load's own segments
          replacement silently un-selected the module, so band 2's step
          fieldset never rendered at all). Loading a chain whose OWN action
          segment is the real MODULE_CATALOGUE id "permits" keeps
          `selectedModule` resolved to Permits either way, so this button
          alone both loads the history chain (for the banner) and puts band 2
          on the Permits leaves, with no separate "pick a module" step to
          race against it. */}
      <button
        type="button"
        onClick={() =>
          loadChain({
            mode: "projects",
            segments: [
              { id: "p1", label: "Cedar Heights Villa - Phase 1", kind: "root" },
              { id: "permits", label: "Permits", kind: "action" },
            ],
          } as never)
        }
      >
        Load a Permits chain from history
      </button>
    </>
  );
}

function renderShell() {
  return render(
    <VeriChatProvider>
      <ShellScreenProvider>
        <M24Shell>
          <Probe />
        </M24Shell>
      </ShellScreenProvider>
    </VeriChatProvider>
  ) as ReturnType<typeof render> & { container: HTMLElement };
}

describe("R-92 BUG 2: a chain built on THIS screen clears any chain loaded from history", () => {
  test("clicking a ranked card (onCardSelect) clears the 'Loaded from history' banner", async () => {
    const { container, getByText, findByText } = renderShell();

    // The real GET /api/shell bootstrap (mocked above) must resolve and reach
    // "Things you can do" before anything else in this test can happen --
    // waitFor polls with real timers rather than a fixed microtask flush.
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());

    // Load a chain from history first -- the same real ShellChainApi.loadChain
    // a page's History/"Do again" control calls.
    fireEvent.click(getByText("Load a chain from history"));

    // The banner is real, rendered DOM from ControlStrip's own `loaded` prop
    // (see ControlStrip.tsx: `{loaded.pinned && loaded.from ? ... : "Loaded
    // from history"}`) -- not an internal flag this test invents.
    expect(await findByText("Loaded from history")).toBeDefined();

    // Click the first ENABLED ranked card in "Things you can do" -- band 3's
    // role-ranked CARD_CATALOGUE cards, reached through the real PillStrip
    // this shell renders, with no screen cards or recent chains competing for
    // the click (pathname "/dashboard" -> chainModule:false -> cardsFor()
    // returns []; recentChains is [] in the mocked bootstrap above).
    const group = container.querySelector('[aria-label="Things you can do"]');
    if (!group) throw new Error("the pill strip's 'Things you can do' group never rendered");
    const buttons = [...group.querySelectorAll("button")];
    const card = buttons.find((b) => !b.hasAttribute("disabled"));
    if (!card) throw new Error("no enabled ranked card was rendered to click");
    fireEvent.click(card);

    // BUG 2's own fix: onCardSelect now calls setLoaded(null), so the stale
    // banner from the chain loaded above must be gone -- a real, persisted,
    // rendered fact about the DOM, not a call-count on a mock.
    await waitFor(() => expect(container.textContent).not.toContain("Loaded from history"));
  });

  test("clicking a screen's own card (onScreenCardSelect) clears the 'Loaded from history' banner", async () => {
    // "/work-progress" is a real MODULE_CATALOGUE prefix (chainModule !==
    // false), so cardsFor() returns that module's own leaf cards as
    // screenCardViews -- band 3's FIRST row, per M24Shell.tsx's own comment
    // ("THE SCREEN'S OWN VERBS COME FIRST"), each wired through
    // onSelectScreenCard={onScreenCardSelect}.
    CURRENT_PATHNAME = "/work-progress";
    const { container, getByText, findByText } = renderShell();
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());

    fireEvent.click(getByText("Load a chain from history"));
    expect(await findByText("Loaded from history")).toBeDefined();

    // Screen cards render with `aria-label={`${card.verb}: ${card.label}`}`
    // (PillStrip.tsx) -- "Record progress" is work-progress's own first leaf
    // (module-catalogue.ts), rendered here as the screen's own card, not the
    // ranked CARD_CATALOGUE card of the same name onCardSelect's own test
    // above clicks (two different components, two different handlers,
    // deliberately disambiguated by querying the screen-cards row only).
    const group = container.querySelector('[aria-label="Things you can do"]');
    if (!group) throw new Error("the pill strip's 'Things you can do' group never rendered");
    const screenCard = [...group.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Record:") || (b.getAttribute("aria-label") ?? "").startsWith("Run:")
    );
    if (!screenCard) throw new Error("no screen card rendered for /work-progress -- cardsFor() returned none");
    fireEvent.click(screenCard);

    // BUG 2's own fix: onScreenCardSelect now calls setLoaded(null) too.
    await waitFor(() => expect(container.textContent).not.toContain("Loaded from history"));
  });

  test("picking a band-2 step (onLeafSelect) clears the 'Loaded from history' banner", async () => {
    const { container, getByText, findByText } = renderShell();
    await waitFor(() => expect(container.querySelector('[aria-label="Things you can do"]')).not.toBeNull());

    // Load a chain from history whose own action segment is "permits" (a
    // real MODULE_CATALOGUE id) -- this both raises the "Loaded from
    // history" banner AND puts `selectedModule` on Permits (M24Shell.tsx's
    // own `segments.find(s.kind==="action")` -> MODULE_CATALOGUE lookup), so
    // band 2 renders Permits' own leaves ("New"/"Expiring soon"/"Open",
    // module-catalogue.ts) via ChainOptionsPanel; picking one calls
    // onLeafSelect(selectedModule, leaf) -- the ONE real caller of that
    // handler. (The Probe's OTHER button, used by this file's other two
    // tests, loads a chain whose action segment is a CARD id instead; using
    // that one here would leave no module selected at all once loaded, and
    // band 2 would never render a step to click -- confirmed by hitting
    // exactly that dead end while writing this test.)
    fireEvent.click(getByText("Load a Permits chain from history"));
    expect(await findByText("Loaded from history")).toBeDefined();

    // Band 2's step fieldset -- OptionChain's own <legend className="sr-only">
    // gives the <fieldset> its accessible name ("Which step?").
    const stepGroup = await waitFor(() => {
      const el = container.querySelector("fieldset");
      if (!el) throw new Error("band 2's step fieldset has not rendered yet");
      return el;
    });
    const newStep = [...stepGroup.querySelectorAll("button")].find((b) => b.textContent === "New");
    if (!newStep) throw new Error("permits.new ('New') leaf option never rendered");
    fireEvent.click(newStep);

    // BUG 2's own fix: onLeafSelect now calls setLoaded(null) too.
    await waitFor(() => expect(container.textContent).not.toContain("Loaded from history"));
  });
});
