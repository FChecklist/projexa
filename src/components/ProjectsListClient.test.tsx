/// <reference types="bun-types" />
// R67 D-69. The item's acceptance is a Playwright run against a local dev
// server, which this lane may not start, so its assertions are made here with
// /api/projects stubbed: the list renders a real row for the demo project, the
// header controls are Filter | Export | New in that DOM order, no [role=dialog]
// exists on this route, and a failed read never renders the empty-state
// sentence.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

const ProjectsListClient = (await import("./ProjectsListClient")).default;

const PROJECTS = [
  {
    id: "p1",
    name: "Cedar Heights Villa - Phase 1",
    revenue: 500000,
    expenses: 750000,
    taskCount: 10,
    delayedTaskCount: 1,
    contractValue: 4000000,
    projectValue: 4200000,
    projectValueSource: "entered",
    earnedValue: 1000000,
    percentByValue: 25,
  },
  {
    id: "p2",
    name: "Riverside Business Park",
    revenue: 0,
    expenses: 0,
    taskCount: 0,
    delayedTaskCount: 0,
    contractValue: null,
    projectValue: null,
    projectValueSource: null,
    earnedValue: null,
    percentByValue: null,
  },
];

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Response) {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => handler(String(input))) as unknown as typeof fetch;
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  stubFetch((url) => {
    if (url.includes("/api/projects")) return ok({ projects: PROJECTS });
    if (url.includes("/api/currencies")) {
      return ok({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    }
    return ok({});
  });
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = originalFetch;
  try {
    window.sessionStorage.clear();
  } catch {
    // sessionStorage is a convenience the kit's ListScreen uses; its absence
    // must not fail a test.
  }
});

describe("ProjectsListClient", () => {
  test("renders a real row for each project, with its name as a link to its dashboard", async () => {
    const view = render(<ProjectsListClient />);
    await waitFor(() => {
      const link = view.getByRole("link", { name: "Cedar Heights Villa - Phase 1" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/dashboard/project?projectId=p1");
    });
  });

  test("the header controls are Filter, Export and New, in that DOM order", async () => {
    const view = render(<ProjectsListClient />);
    await waitFor(() => expect(view.getByRole("link", { name: "Cedar Heights Villa - Phase 1" })).toBeTruthy());
    const names = view
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "")
      .filter((n) => ["Filter", "Export", "New"].includes(n));
    expect(names.slice(0, 3)).toEqual(["Filter", "Export", "New"]);
  });

  test("no dialog exists on this route -- D-69's own rule after CreateProjectDialog was deleted", async () => {
    const view = render(<ProjectsListClient />);
    await waitFor(() => expect(view.getByRole("link", { name: "Cedar Heights Villa - Phase 1" })).toBeTruthy());
    expect(view.queryByRole("dialog")).toBeNull();
  });

  test("a project's status is a glyph AND a word, and an untouched project is not called On track", async () => {
    const view = render(<ProjectsListClient />);
    await waitFor(() => expect(view.getByText("Delayed")).toBeTruthy());
    expect(view.getByText("No tasks yet")).toBeTruthy();
    expect(view.queryByText("On track")).toBeNull();
  });

  test("a project with no BOQ says so in words rather than drawing an empty 0% bar", async () => {
    const view = render(<ProjectsListClient />);
    await waitFor(() => expect(view.getByText("No BOQ yet")).toBeTruthy());
    expect(view.getByText("No scope yet")).toBeTruthy();
    expect(view.getByText("Not set")).toBeTruthy();
  });

  test("a failed read shows the backend's words and a Retry, and NEVER the empty-state sentence", async () => {
    stubFetch((url) => {
      if (url.includes("/api/projects")) {
        return new Response(JSON.stringify({ error: "The construction data service did not respond in time." }), {
          status: 504,
          headers: { "Content-Type": "application/json" },
        });
      }
      return ok({ currencies: [] });
    });
    const view = render(<ProjectsListClient />);
    await waitFor(() => {
      expect(view.getByText(/Could not load projects: The construction data service did not respond in time\./)).toBeTruthy();
    });
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(view.queryByText("No projects yet.")).toBeNull();
  });

  test("Export is disabled with a reason rather than producing an empty file", async () => {
    stubFetch((url) => (url.includes("/api/projects") ? ok({ projects: [] }) : ok({ currencies: [] })));
    const view = render(<ProjectsListClient />);
    await waitFor(() => expect(view.getByText("No projects yet.")).toBeTruthy());
    // The frame appends the reason to the label when a header action is
    // disabled, so the accessible name is "Export (No rows to export)".
    const exportButton = view.getByRole("button", { name: /^Export/ }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.getAttribute("title")).toBe("No rows to export");
    expect(exportButton.textContent).toContain("No rows to export");
  });
});
