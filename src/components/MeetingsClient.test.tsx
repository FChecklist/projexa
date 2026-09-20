/// <reference types="bun-types" />
// Cold-load fix (PROJEXA-E2E-001 work order section 5, owner-flagged "single
// biggest risk to a live demo"): MeetingsClient used to always start loading
// and fire its own client-side fetch on mount, even when meetings/page.tsx
// had already fetched the same rows on the server -- the exact "two
// sequential VERIDIAN hops" defect R67 F-18 fixed on DocumentsClient/etc.
// (see that suite's own header comment for the shared finding). This suite
// mirrors DocumentsClient.test.tsx's shape: the real regression to prove is
// that `initial` answers the screen with ZERO network requests on first
// paint, plus the same four branches (loading, error, empty, rows) every
// other converted module list asserts.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/meetings",
}));

const mod = await import("./MeetingsClient");
const MeetingsClient = mod.default;

const PROPS = { projectId: "p1" };

const MEETING = {
  id: "m-1",
  title: "Weekly site sync",
  scheduledAt: "2026-09-14T09:30:00.000Z",
  durationMinutes: 30,
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubMeetings(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify({ meetings: rows }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

function stubFailure(status: number, error: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
  stubMeetings([MEETING]);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("MeetingsClient -- the cold-load fix: `initial` answers with zero requests", () => {
  test("rows passed as `initial` render immediately, with NO fetch on first paint", () => {
    const view = render(
      <MeetingsClient {...PROPS} initial={{ rows: [MEETING], errorMessage: null }} />
    );
    // Synchronous assertion, deliberately not wrapped in waitFor: if this
    // needed a tick to appear, `initial` did not do its job and the screen
    // spent a round trip it should not have.
    expect(view.getByText("Weekly site sync")).toBeTruthy();
    expect(requested).toHaveLength(0);
  });

  test("an `initial` failure starts the screen in the error branch, never a spinner that never resolves", () => {
    const view = render(
      <MeetingsClient {...PROPS} initial={{ rows: [], errorMessage: "The construction data service did not respond in time." }} />
    );
    expect(view.container.textContent).toContain("The construction data service did not respond in time.");
    expect(requested).toHaveLength(0);
  });

  test("with no `initial` (a project switch), the component falls back to its own fetch", async () => {
    const view = render(<MeetingsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("Weekly site sync")).toBeTruthy());
    expect(requested.some((url) => url.includes("/api/meetings?projectId=p1"))).toBe(true);
  });
});

describe("MeetingsClient -- the four branches", () => {
  test("loading is a spinner, marked aria-busy, with no claim about the data", () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const view = render(<MeetingsClient {...PROPS} />);
    expect(view.container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(view.queryByText(/No meetings/)).toBeNull();
  });

  test("a failed read shows the backend's own words and a Retry, never the empty sentence", async () => {
    stubFailure(504, "The construction data service did not respond.");
    const view = render(<MeetingsClient {...PROPS} />);
    await waitFor(() => expect(view.container.textContent).toContain("The construction data service did not respond."));
    expect(view.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
    expect(view.queryByText(/No meetings/)).toBeNull();
  });

  test("a successful empty read shows the empty sentence, not an error", async () => {
    stubMeetings([]);
    const view = render(<MeetingsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("No meetings scheduled yet.")).toBeTruthy());
  });

  test("a real row renders and routes to its Object Page on click", async () => {
    const view = render(<MeetingsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("Weekly site sync")).toBeTruthy());
    view.getByText("Weekly site sync").closest("tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(push).toHaveBeenCalledWith("/meetings/m-1");
  });

  test("'New Meeting' routes to the create screen with the project id", () => {
    const view = render(<MeetingsClient {...PROPS} initial={{ rows: [], errorMessage: null }} />);
    view.getByRole("button", { name: /New Meeting/ }).click();
    expect(push).toHaveBeenCalledWith("/meetings/new?projectId=p1");
  });
});
