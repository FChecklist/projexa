/// <reference types="bun-types" />
// PROJEXA-E2E-001 cold-load investigation, continuation (2026-09-21):
// SettingsClient used to always start `loading=true` and fire its own
// client-side Promise.all([GET /api/organization, GET /api/org-members])
// on mount, blocking the ENTIRE page (Organization/Your Account/Team cards)
// behind one spinner even though settings/page.tsx's server component now
// resolves the same two reads during SSR. Mirrors MeetingsClient.test.tsx's
// shape: the real regression to prove is that `initialOrgInfo`/
// `initialMembers` answer the screen with ZERO network requests on first
// paint, and that omitting them still falls back to the original
// client-fetch behavior (a defensive path, not the common case post-fix).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/settings",
}));

const mod = await import("./SettingsClient");
const SettingsClient = mod.default;

const ORG_INFO = {
  organization: { id: "org-1", name: "Meridian Construction Group", slug: "meridian", created_at: "2026-01-01T00:00:00.000Z" },
  role: "owner",
  email: "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com",
};

const MEMBERS = [
  { user_id: "u-1", role: "owner", profiles: { email: "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com", display_name: "Arjun Mehta" } },
];

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubOk() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/api/organization/currency")) {
      return new Response(JSON.stringify({ baseCurrency: null, country: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/organization")) {
      return new Response(JSON.stringify(ORG_INFO), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/org-members")) {
      return new Response(JSON.stringify({ members: MEMBERS }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // Sub-cards (WorkspaceConnectionCard/OrgInvitesCard/GoogleSheetsCard/
    // BoqCategoriesCard/DailyDigestCard) each fire their own independent
    // fetch on mount too -- deliberately out of THIS fix's scope (see
    // settings/page.tsx's own comment), so they get a generic empty-ok
    // response here rather than being asserted on.
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
  stubOk();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("SettingsClient -- the cold-load fix: initialOrgInfo/initialMembers answer with zero org/members requests", () => {
  test("server-seeded org info and members render immediately, with NO /api/organization or /api/org-members fetch", () => {
    const view = render(<SettingsClient initialOrgInfo={ORG_INFO} initialMembers={MEMBERS} />);
    // Synchronous assertion, deliberately not wrapped in waitFor: if this
    // needed a tick to appear, the server-seeded props did not do their job.
    expect(view.getByText("Meridian Construction Group")).toBeTruthy();
    expect(view.getByText("Arjun Mehta")).toBeTruthy();
    expect(requested.some((u) => u.endsWith("/api/organization"))).toBe(false);
    expect(requested.some((u) => u.endsWith("/api/org-members"))).toBe(false);
  });

  test("with no initial props (defensive fallback), the component still fetches organization+members itself", async () => {
    const view = render(<SettingsClient />);
    await waitFor(() => expect(view.getByText("Meridian Construction Group")).toBeTruthy());
    expect(requested.some((u) => u.endsWith("/api/organization"))).toBe(true);
    expect(requested.some((u) => u.endsWith("/api/org-members"))).toBe(true);
  });

  test("the currency fetch still runs even when org info/members are server-seeded (deliberately left client-side, out of this fix's scope)", async () => {
    render(<SettingsClient initialOrgInfo={ORG_INFO} initialMembers={MEMBERS} />);
    await waitFor(() => expect(requested.some((u) => u.includes("/api/organization/currency"))).toBe(true));
  });
});
