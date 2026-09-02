/// <reference types="bun-types" />
// R67 D-28. THE FAULT: Work Progress was create-only. Three inert rows, whose
// BOQ-line cell printed a raw cuid because the names were resolved client-side
// against ONE BOQ; no way to open an entry, correct it or delete it; no sight
// of the photo you had just uploaded; and Save left you on an emptied form.
//
// These render the real object page and assert the visible outcome: real words
// where ids used to be, a delete confirmation that states what it costs before
// anything is written, and an empty photo state that says so.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
// Mocked BEFORE the component is imported. The screen calls useRouter() for
// Back and for the post-delete navigation; there is no Next app tree here.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href); }, refresh: () => {} }),
}));

const WorkProgressObjectClient = (await import("./WorkProgressObjectClient")).default;
const { NO_PHOTO_LABEL, boqLineLabel } = await import("./WorkProgressObjectClient");

afterEach(() => {
  cleanup();
  pushed.length = 0;
  DELETE_CALLS.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The enriched row VERIDIAN now returns: the activity and BOQ-line names come
// from the server's LEFT JOIN, and travel with the line's own contracted
// figures so the delete confirmation can do real arithmetic.
const ENTRY = {
  id: "entry-1",
  projectId: "proj-1",
  activityId: "act-1",
  boqLineItemId: "line-1",
  entryDate: "2026-08-25",
  quantityDone: "12",
  percentComplete: "60",
  entryBasis: "DELTA",
  remarks: null,
  activityName: "Skiphop sub",
  boqItemCode: "R60SK-A",
  boqLineDescription: "R60 skiphop sub",
  boqLineQuantity: "100",
  boqLineRate: "10",
  boqLineAmount: "1000",
  unit: "m2",
};

const SIBLING = { ...ENTRY, id: "entry-0", entryDate: "2026-08-20", quantityDone: "48", percentComplete: "48" };

const DELETE_CALLS: string[] = [];

function router(handlers: Record<string, (init?: RequestInit) => Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "DELETE") DELETE_CALLS.push(url);
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler(init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

function mount(overrides: { photos?: unknown[]; entry?: Record<string, unknown> } = {}) {
  const entry = { ...ENTRY, ...(overrides.entry ?? {}) };
  globalThis.fetch = router({
    "/api/work-progress/photos": () => jsonRes({ photos: overrides.photos ?? [] }),
    "/api/work-progress/activities": () => jsonRes({ activities: [{ id: "act-1", name: "Skiphop sub", unit: "m2" }] }),
    "/api/work-progress/entry-1": () => jsonRes(entry),
    "/api/work-progress?projectId": () => jsonRes({ entries: [SIBLING, entry] }),
  });
  return render(<WorkProgressObjectClient entryId="entry-1" />);
}

describe("boqLineLabel (R67 D-28)", () => {
  test("renders '{itemCode} - {description}', the shape the list and the page share", () => {
    expect(boqLineLabel("R60SK-A", "R60 skiphop sub")).toBe("R60SK-A - R60 skiphop sub");
  });

  test("an entry with no BOQ line gets an en-dash, never a raw id", () => {
    expect(boqLineLabel(null, null)).toBe("–");
  });

  test("a line with a description but no code still reads as words", () => {
    expect(boqLineLabel(null, "R60 skiphop sub")).toBe("R60 skiphop sub");
  });
});

describe("WorkProgressObjectClient (R67 D-28)", () => {
  test("shows the BOQ line in words and prints no raw id anywhere on the page", async () => {
    const { container, getAllByText } = mount();

    await waitFor(() => expect(getAllByText(/R60SK-A - R60 skiphop sub/).length).toBeGreaterThan(0));

    // The acceptance's own guard, applied to the rendered text: nothing on this
    // page may read as a bare cuid.
    const text = container.textContent ?? "";
    expect(/\b[a-z0-9]{20,}\b/.test(text)).toBe(false);
  });

  test("states the date in the module's one format and the quantity with its unit", async () => {
    const { getAllByText, container } = mount();
    await waitFor(() => expect(getAllByText(/25-08-2026/).length).toBeGreaterThan(0));
    expect((container.textContent ?? "").includes("12 m2")).toBe(true);
  });

  test("an entry with no photo says so, rather than showing an empty strip", async () => {
    const { getByText } = mount();
    await waitFor(() => expect(getByText(NO_PHOTO_LABEL)).toBeDefined());
  });

  test("a photo is rendered as a thumbnail captioned with the entry date", async () => {
    const { getByAltText, getAllByText } = mount({
      photos: [{ id: "p1", fileName: "wall.jpg", url: "https://example.test/wall.jpg", createdAt: "2026-08-25T00:00:00Z" }],
    });
    await waitFor(() => expect(getByAltText("wall.jpg")).toBeDefined());
    expect(getAllByText("25-08-2026").length).toBeGreaterThan(0);
  });

  test("Delete opens a confirmation stating the real blast radius, and writes NOTHING until it is accepted", async () => {
    const { getByRole, findByText } = mount();

    await waitFor(() => expect(getByRole("button", { name: /^Delete/ })).toBeDefined());
    fireEvent.click(getByRole("button", { name: /^Delete/ }));

    // 48 already logged + this entry's 12 = 60 of a 100 m2 / AED 1000 line.
    // Removing it leaves 48. Computed by work-progress-report.ts, the same
    // arithmetic the report and the PDF use.
    expect(
      await findByText("This removes 12 m2 logged on 25-08-2026 against R60SK-A; the running total drops from 60% to 48%.")
    ).toBeDefined();
    expect(DELETE_CALLS).toHaveLength(0);
  });

  test("an entry with no BOQ line still gets an honest confirmation, with no invented percentage", async () => {
    const { getByRole, findByText } = mount({
      entry: { boqLineItemId: null, boqItemCode: null, boqLineDescription: null, boqLineQuantity: null, boqLineRate: null, boqLineAmount: null, unit: "nos" },
    });

    await waitFor(() => expect(getByRole("button", { name: /^Delete/ })).toBeDefined());
    fireEvent.click(getByRole("button", { name: /^Delete/ }));

    expect(await findByText("This removes 12 nos logged on 25-08-2026 against Skiphop sub. This cannot be undone.")).toBeDefined();
  });

  test("Edit and Delete are both rendered (the D-09 fork), and Back returns to this entry's own project", async () => {
    const { getByRole } = mount();
    await waitFor(() => expect(getByRole("button", { name: /^Edit/ })).toBeDefined());
    expect(getByRole("button", { name: /^Delete/ })).toBeDefined();

    fireEvent.click(getByRole("button", { name: /Back/ }));
    expect(pushed).toContain("/work-progress?projectId=proj-1");
  });

  test("a failed load shows the backend's own words with a Retry, not a permanent 'Loading…'", async () => {
    globalThis.fetch = router({
      "/api/work-progress/entry-1": () => jsonRes({ error: "The construction data service didn't answer" }, 502),
    });
    const { findByRole, findByText } = render(<WorkProgressObjectClient entryId="entry-1" />);
    expect(await findByText(/The construction data service didn't answer/)).toBeDefined();
    expect(await findByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("landing here straight from Save confirms the entry in the persistent band", async () => {
    globalThis.fetch = router({
      "/api/work-progress/photos": () => jsonRes({ photos: [] }),
      "/api/work-progress/activities": () => jsonRes({ activities: [] }),
      "/api/work-progress/entry-1": () => jsonRes(ENTRY),
      "/api/work-progress?projectId": () => jsonRes({ entries: [ENTRY] }),
    });
    const { findByText } = render(<WorkProgressObjectClient entryId="entry-1" justLogged />);
    expect(await findByText("Progress entry entry-1 logged")).toBeDefined();
  });
});
