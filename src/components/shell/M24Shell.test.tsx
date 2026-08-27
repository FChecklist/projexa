/// <reference types="bun-types" />
// F_025: the account/user menu (AccountMenu, rendered in M24Shell's top
// rail) showed a STALE email after the underlying Supabase auth session
// changed without this shell unmounting -- concretely, a browser tab left
// open while signed in as one account kept showing that account's email
// after a DIFFERENT account signed in via another tab sharing the same
// Supabase auth storage (GoTrueClient syncs sessions across tabs via a
// `storage` listener and fires onAuthStateChange for it). A fresh
// GET /api/organization (which src/lib/supabase/auth-guard.ts's
// requireAuth() backs with the LIVE JWT's own email claim, never a cached
// copy) already reflected the new session; only this tab's already-rendered
// `info` state did not, because the org-info fetch ran exactly once on
// mount and nothing ever told it to run again.
//
// This test exercises the real fix end to end: mount M24Shell, let its
// mount-time fetch populate AccountMenu's email, then fire a fake
// onAuthStateChange event (standing in for the cross-tab session-sync event
// GoTrueClient actually delivers) carrying a DIFFERENT session, and confirm
// the rendered email updates to match.
//
// @fchecklist/veridian-ui-kit/shell (AppShell/TopRail/Composer/TaskMaster/
// PillStrip) is stood in for with minimal presentational stubs. F_025 lives
// entirely in M24Shell's OWN data-fetching/subscription logic, not in the
// kit's rendering, and the kit's real components pull in browser APIs
// (ResizeObserver etc.) that happy-dom does not provide and that this
// suite has never exercised elsewhere -- see PayrollClient.test.tsx's own
// comment on GlobalRegistrator for the same "keep the DOM surface this
// suite depends on small and known-good" reasoning. TopRail's stub renders
// exactly the `account` node M24Shell builds for it
// (`<AccountMenu email={info?.email} />`), so the REAL AccountMenu is what
// this test renders and asserts against -- only the kit's chrome around it
// is faked.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws -- see PayrollClient.test.tsx's
// identical guard; `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";

// M24Shell itself only calls useRouter(). The other two exports are stubbed
// because they are imported (statically bound, so each must exist on this
// mock regardless of whether it is ever CALLED) by modules M24Shell pulls in
// eagerly at import time, whether or not this test ever renders the part of
// the tree that calls them: usePathname by
// @fchecklist/veridian-ui-kit/context's createVeriChatContext() (reached via
// @/components/veri-chat/veri-chat-context's HOME_ROUTE) and by
// SearchTrigger's own module (@/components/search-command, imported for
// M24Shell's `search` slot), and useSearchParams by that same
// search-command module. A minimal stub of each is enough, and safe to leave
// mocked for the whole process: nothing else in this suite currently imports
// next/navigation (confirmed by grep across src/**/*.test.tsx before adding
// this), so there is nothing for this mock to shadow real behaviour for.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// See the file-header comment: only M24Shell's own fetch/subscription logic
// is under test here, not the kit's rendering. `cutChainFrom`/`resetChain`/
// `DEFAULT_CHAIN_MODE`/`UNIVERSAL_PILLS` are real, pure, side-effect-free
// values from the kit; trivial stand-ins are used rather than the real
// exports purely to keep this mock self-contained (no partial-mock
// re-import needed) -- neither test below calls the chain-editing handlers
// that would exercise them.
mock.module("@fchecklist/veridian-ui-kit/shell", () => ({
  AppShell: (props: { topRail: unknown; taskMaster: unknown; composer: unknown; children: unknown }) => (
    <div>
      {props.topRail as never}
      {props.taskMaster as never}
      {props.composer as never}
      {props.children as never}
    </div>
  ),
  TopRail: (props: { account: unknown }) => <div>{props.account as never}</div>,
  TaskMaster: () => null,
  Composer: () => null,
  PillStrip: () => null,
  COMPOSER_PILLS_BAND_RESERVE: 0,
  cutChainFrom: (chain: unknown) => chain,
  resetChain: (chain: unknown) => chain,
  DEFAULT_CHAIN_MODE: "chat",
  UNIVERSAL_PILLS: [],
}));

// The fake auth client. `onAuthStateChange`'s callback is captured so the
// test can invoke it directly, standing in for GoTrueClient's real
// cross-tab `storage`-driven event.
let authChangeCallback: ((event: string, session: unknown) => void) | null = null;
let unsubscribeCalls = 0;

mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: () => { unsubscribeCalls++; } } } };
      },
      signOut: async () => ({ error: null }),
    },
  }),
}));

const M24Shell = (await import("./M24Shell")).default;

afterEach(() => {
  cleanup();
  authChangeCallback = null;
  unsubscribeCalls = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Every source M24Shell's mount effects read, routed by URL substring. */
function fetchStub(email: string) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/organization")) {
      return jsonRes({ organization: { id: "org1", name: "Meridian Construction Group" }, role: "owner", email });
    }
    if (url.includes("/api/projects")) return jsonRes({ projects: [] });
    if (url.includes("/api/tasks")) return jsonRes({ counts: {}, groups: {} });
    if (url.includes("/api/pill-usage")) return jsonRes({ pills: [] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

function accountAriaLabel(): string | null {
  return document.querySelector('[aria-label^="Account"]')?.getAttribute("aria-label") ?? null;
}

describe("M24Shell identity refresh (F_025)", () => {
  test("re-fetches /api/organization on a cross-tab SIGNED_IN and updates the account menu's email", async () => {
    globalThis.fetch = fetchStub("democeo@projexa-ai.com");

    render(<M24Shell>{null}</M24Shell>);

    await waitFor(() => {
      expect(accountAriaLabel()).toBe("Account: democeo@projexa-ai.com");
    });

    // Simulate the actual F_025 trigger: a DIFFERENT account signs in via
    // another tab sharing the same Supabase auth storage. This tab never
    // navigates and M24Shell never remounts -- the only way it can learn
    // the session changed is the onAuthStateChange listener the fix adds.
    globalThis.fetch = fetchStub("demo_ceo@projexa-ai.com");
    expect(authChangeCallback).not.toBeNull();
    await act(async () => {
      authChangeCallback!("SIGNED_IN", { user: { email: "demo_ceo@projexa-ai.com" } });
    });

    await waitFor(() => {
      expect(accountAriaLabel()).toBe("Account: demo_ceo@projexa-ai.com");
    });
  });

  test("ignores INITIAL_SESSION (the event GoTrueClient fires once on subscribing) so mount does not double-fetch", async () => {
    let orgCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/organization")) {
        orgCalls++;
        return jsonRes({ organization: { id: "org1", name: "Meridian" }, role: "owner", email: "demo_ceo@projexa-ai.com" });
      }
      if (url.includes("/api/projects")) return jsonRes({ projects: [] });
      if (url.includes("/api/tasks")) return jsonRes({ counts: {}, groups: {} });
      if (url.includes("/api/pill-usage")) return jsonRes({ pills: [] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    render(<M24Shell>{null}</M24Shell>);
    await waitFor(() => expect(orgCalls).toBe(1));

    await act(async () => {
      authChangeCallback!("INITIAL_SESSION", { user: { email: "demo_ceo@projexa-ai.com" } });
    });
    // Give an accidental extra fetch a tick to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(orgCalls).toBe(1);
  });

  test("unsubscribes the auth listener on unmount", async () => {
    globalThis.fetch = fetchStub("demo_ceo@projexa-ai.com");
    const { unmount } = render(<M24Shell>{null}</M24Shell>);
    await waitFor(() => expect(accountAriaLabel()).toBe("Account: demo_ceo@projexa-ai.com"));
    unmount();
    expect(unsubscribeCalls).toBe(1);
  });
});
