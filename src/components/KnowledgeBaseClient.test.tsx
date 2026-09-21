/// <reference types="bun-types" />
// PROJEXA-E2E-001 cold-load investigation, continuation (2026-09-21):
// KnowledgeBaseClient used to always start `loading=true` and fire its own
// fetch("/api/knowledge-base") on mount, even though knowledge-base/page.tsx
// now resolves the same list server-side (module-list-source.ts's
// fetchKnowledgeBasePages, SSR'd + cached + streamed via <Suspense>). Mirrors
// MeetingsClient.test.tsx's shape: the real regression to prove is that
// `initial` answers the screen with ZERO network requests on first paint.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/knowledge-base",
}));

const mod = await import("./KnowledgeBaseClient");
const KnowledgeBaseClient = mod.default;

const PAGE = { id: "kb-1", slug: "onboarding", title: "New Hire Onboarding", content: "Welcome!", version: 1 };

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubPages(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ pages: rows }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
  stubPages([PAGE]);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("KnowledgeBaseClient -- the cold-load fix: `initial` answers with zero requests", () => {
  test("pages passed as `initial` render immediately, with NO fetch on first paint", () => {
    const view = render(<KnowledgeBaseClient initial={{ rows: [PAGE], errorMessage: null }} />);
    expect(view.getByText("New Hire Onboarding")).toBeTruthy();
    expect(requested).toHaveLength(0);
  });

  test("an `initial` failure starts the screen in the error branch, never a spinner that never resolves", () => {
    const view = render(<KnowledgeBaseClient initial={{ rows: [], errorMessage: "Could not load knowledge base: timeout" }} />);
    expect(view.container.textContent).toContain("Could not load knowledge base: timeout");
    expect(requested).toHaveLength(0);
  });

  test("with no `initial`, the component falls back to its own fetch", async () => {
    const view = render(<KnowledgeBaseClient />);
    await waitFor(() => expect(view.getByText("New Hire Onboarding")).toBeTruthy());
    expect(requested.some((u) => u.includes("/api/knowledge-base"))).toBe(true);
  });

  test("a real row renders and routes to its Object Page on click", async () => {
    const view = render(<KnowledgeBaseClient initial={{ rows: [PAGE], errorMessage: null }} />);
    view.getByText("New Hire Onboarding").closest("button")?.click();
    expect(push).toHaveBeenCalledWith("/knowledge-base/kb-1");
  });
});
