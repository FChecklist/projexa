/// <reference types="bun-types" />
// Cold-load fix (PROJEXA-E2E-001 work order section 5) -- see
// MeetingsClient.test.tsx's header comment for the shared rationale; this
// mirrors it for the sibling fix on /mood-boards.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/mood-boards",
}));

const mod = await import("./MoodBoardsClient");
const MoodBoardsClient = mod.default;

const PROPS = { projectId: "p1" };

const BOARD = {
  id: "mb-1",
  title: "Master Bedroom",
  roomOrArea: "Level 2",
  status: "draft",
  items: [],
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubBoards(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify({ boards: rows }), { status: 200, headers: { "content-type": "application/json" } });
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
  stubBoards([BOARD]);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("MoodBoardsClient -- the cold-load fix: `initial` answers with zero requests", () => {
  test("rows passed as `initial` render immediately, with NO fetch on first paint", () => {
    const view = render(
      <MoodBoardsClient {...PROPS} initial={{ rows: [BOARD], errorMessage: null }} />
    );
    expect(view.getByText("Master Bedroom")).toBeTruthy();
    expect(requested).toHaveLength(0);
  });

  test("an `initial` failure starts the screen in the error branch", () => {
    const view = render(
      <MoodBoardsClient {...PROPS} initial={{ rows: [], errorMessage: "The construction data service did not respond in time." }} />
    );
    expect(view.container.textContent).toContain("The construction data service did not respond in time.");
    expect(requested).toHaveLength(0);
  });

  test("with no `initial`, the component falls back to its own fetch", async () => {
    const view = render(<MoodBoardsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("Master Bedroom")).toBeTruthy());
    expect(requested.some((url) => url.includes("/api/mood-boards?projectId=p1"))).toBe(true);
  });
});

describe("MoodBoardsClient -- the four branches", () => {
  test("loading is a spinner, marked aria-busy", () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const view = render(<MoodBoardsClient {...PROPS} />);
    expect(view.container.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  test("a failed read shows the backend's own words and a Retry", async () => {
    stubFailure(504, "The construction data service did not respond.");
    const view = render(<MoodBoardsClient {...PROPS} />);
    await waitFor(() => expect(view.container.textContent).toContain("The construction data service did not respond."));
    expect(view.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
  });

  test("a successful empty read shows the empty sentence, not an error", async () => {
    stubBoards([]);
    const view = render(<MoodBoardsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("No mood boards yet.")).toBeTruthy());
  });

  test("a real card renders and routes to its Object Page on click", async () => {
    const view = render(<MoodBoardsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("Master Bedroom")).toBeTruthy());
    view.getByText("Master Bedroom").click();
    expect(push).toHaveBeenCalledWith("/mood-boards/mb-1");
  });

  test("'New Mood Board' routes to the create screen with the project id", async () => {
    const view = render(<MoodBoardsClient {...PROPS} initial={{ rows: [], errorMessage: null }} />);
    await waitFor(() => expect(view.getByText("No mood boards yet.")).toBeTruthy());
    view.getByRole("button", { name: /New Mood Board/ }).click();
    expect(push).toHaveBeenCalledWith("/mood-boards/new?projectId=p1");
  });
});
