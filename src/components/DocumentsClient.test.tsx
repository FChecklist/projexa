/// <reference types="bun-types" />
// R67 MERGE (lane D0/F2 x lane D1). Both lanes wrote a suite for this screen
// from the same starting defect, and BOTH survive here -- lane D1's assertions
// are RESTATED against the merged component rather than deleted, per decision
// D-11.
//
// THE SHARED FINDING, in R-184's own words: "'No documents found for this
// project.' after a 504". The catch was a four-second toast and `docs` stayed
// at [], so a failed read fell through to the branch the EMPTY case renders and
// reported a false claim as fact, with the only contradiction fading away.
//
// WHAT CHANGED UNDER LANE D1'S TESTS, and why each restatement is the same
// assertion and not a weaker one:
//
//   * documentsLoadErrorText() is gone. Lane D1 owned the failure sentence in
//     this screen; the merged component takes it from the ONE dictionary
//     (paneError, asserted in src/lib/pane-state.test.ts), so the wording is
//     tested once for every module instead of once per screen. Its two cases
//     survive below as rendered behaviour: the backend's own words are kept,
//     and "supabaseKey is required" never reaches a user.
//   * load()/`loading` are gone, replaced by useListRead()/PaneState. Lane D1's
//     four-branch describe block therefore asserts the four BRANCHES rather
//     than the flag: loading, error, empty-with-a-successful-read, rows.
//   * The `fellBack` banner test is dropped, not restated -- that fact moved
//     onto the page heading (PageHeading contextNote="auto-selected"), one
//     place instead of two, and the prop no longer exists. See DocumentsClient's
//     own header comment, which records the same decision.
//   * "+ New Document" is a Button that routes, not an <a>, so it is queried as
//     a button. The destination is asserted through the router mock instead of
//     through an href.
//
// Everything lane D1 tested as a PURE FUNCTION -- emptyStateText, categoryWords,
// applyDocumentFilters, hasActiveFilter -- is carried over verbatim, because
// those exports survived the merge unchanged.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// `screen` is deliberately NOT imported: it binds to document.body at module
// init, which under bun + happy-dom happens before the registrator above has
// run. Every query here comes from render()'s own return value instead.
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/documents",
}));

const mod = await import("./DocumentsClient");
const DocumentsClient = mod.default;
const { EMPTY_DOCUMENT_FILTERS, applyDocumentFilters, categoryWords, emptyStateText, hasActiveFilter } = mod;

const PROJECT = "Cedar Heights Villa - Phase 1";
const PROPS = { projectId: "p1", projectName: PROJECT };

const DOC = {
  id: "doc-1",
  name: "DEWA permit 2026.pdf",
  category: "permit",
  fileType: "application/pdf",
  fileSize: 240_000,
  expiryDate: null,
  versionNumber: 1,
  createdAt: "2026-08-14T09:30:00.000Z",
  linkedEntityType: "project",
  linkedEntityId: "p1",
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** The documents read answers with `rows`; every other lookup answers empty. */
function stubDocuments(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const body = url.includes("/api/documents") ? { documents: rows } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

/** Only the documents read fails -- the Relates-to lookups are not the subject. */
function stubFailure(status: number, error: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (!url.includes("/api/documents")) {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
  stubDocuments([DOC]);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("emptyStateText", () => {
  test("names the project, and says which filter is holding rows back", () => {
    expect(emptyStateText("all", PROJECT)).toBe(`No documents yet for ${PROJECT}.`);
    expect(emptyStateText("permit", PROJECT)).toBe(`No permit documents for ${PROJECT}.`);
    // A category reads as words, never as its wire value.
    expect(emptyStateText("site_photo", PROJECT)).toBe(`No site photo documents for ${PROJECT}.`);
    expect(categoryWords("site_photo")).toBe("site photo");
  });

  test("R67 D-14: a filter that is not Category still cannot produce 'No documents yet'", () => {
    expect(emptyStateText("all", PROJECT, true)).toBe(`No documents match this filter for ${PROJECT}.`);
  });
});

describe("applyDocumentFilters -- R67 D-14", () => {
  const ROWS = [
    { ...DOC, id: "a", fileType: "application/pdf", createdAt: "2026-08-14T09:30:00.000Z", linkedEntityType: "project" },
    { ...DOC, id: "b", fileType: "image/jpeg", createdAt: "2026-09-01T09:30:00.000Z", linkedEntityType: "permit" },
  ];

  test("File type, Added between and Relates to each narrow the rows on screen", () => {
    expect(applyDocumentFilters(ROWS, { ...EMPTY_DOCUMENT_FILTERS, fileType: "image/jpeg" }).map((d) => d.id)).toEqual(["b"]);
    expect(applyDocumentFilters(ROWS, { ...EMPTY_DOCUMENT_FILTERS, relatesTo: "permit" }).map((d) => d.id)).toEqual(["b"]);
    expect(
      applyDocumentFilters(ROWS, { ...EMPTY_DOCUMENT_FILTERS, addedFrom: "2026-08-01", addedTo: "2026-08-31" }).map((d) => d.id)
    ).toEqual(["a"]);
  });

  test("the range is inclusive at both ends -- a document added ON the boundary is in it", () => {
    expect(
      applyDocumentFilters(ROWS, { ...EMPTY_DOCUMENT_FILTERS, addedFrom: "2026-08-14", addedTo: "2026-08-14" }).map((d) => d.id)
    ).toEqual(["a"]);
  });

  test("an untouched filter set changes nothing and is not 'active'", () => {
    expect(applyDocumentFilters(ROWS, EMPTY_DOCUMENT_FILTERS)).toHaveLength(2);
    expect(hasActiveFilter(EMPTY_DOCUMENT_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...EMPTY_DOCUMENT_FILTERS, relatesTo: "rfi" })).toBe(true);
  });
});

describe("DocumentsClient -- the four branches", () => {
  test("THE ACCEPTANCE: a 504 shows the failure and a Retry, and never the empty sentence", async () => {
    stubFailure(504, "The construction data service did not respond.");
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.container.textContent).toContain("Couldn't load documents"));
    expect(view.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
    // The empty-state wording must never appear over a failed GET -- in either
    // lane's phrasing of it.
    expect(view.queryByText(/No documents/)).toBeNull();
    expect(view.container.textContent).not.toContain("No documents found for this project.");
    // ...and no record count is minted from a read that did not answer.
    expect(view.container.textContent).not.toContain("0 records");
    // The reason survives below the card, counted, after the table scrolls away.
    expect(view.container.textContent).toContain("1 error on this screen");
  });

  test("'supabaseKey is required' becomes words a user can act on", async () => {
    // Documents is the module where this message actually surfaces -- the file
    // store is what serves them.
    stubFailure(500, "supabaseKey is required.");
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() =>
      expect(view.container.textContent).toContain("file storage is not configured for this environment")
    );
    expect(view.container.textContent).not.toContain("supabaseKey");
  });

  test("the backend's own words are kept when they are safe to show", async () => {
    stubFailure(500, "The BOQ has no published revision.");
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.container.textContent).toContain("Couldn't load documents"));
    expect(view.container.textContent).toContain("The BOQ has no published revision.");
  });

  test("only a 200 with zero rows shows the empty sentence, it names the project, and it offers the create route", async () => {
    stubDocuments([]);
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.getByText(`No documents yet for ${PROJECT}.`)).toBeTruthy());
    expect(view.container.textContent).toContain("0 records");
    expect(view.container.textContent).not.toContain("Couldn't load documents");

    // R67 D-14: "+ New Document" is a Button that routes, not an <a>. The
    // destination is the same one lane D1 asserted as an href.
    const create = view.getAllByRole("button", { name: /New Document/ }).at(-1) as HTMLButtonElement;
    create.click();
    expect(push).toHaveBeenCalledWith("/documents/upload?projectId=p1");
  });

  test("the loading branch is a skeleton carrying the REAL column headers, marked aria-busy", () => {
    // Never resolves, so the component stays in the loading branch.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const view = render(<DocumentsClient {...PROPS} />);

    expect(view.container.querySelector("[aria-busy='true']")).toBeTruthy();
    for (const header of ["Name", "Category", "Type", "Size", "Expiry", "Added", "Relates to"]) {
      expect(view.getAllByText(header).length).toBeGreaterThan(0);
    }
    // No claim about the data is made while the read is still running.
    expect(view.queryByText(/No documents/)).toBeNull();
  });

  test("rows are scoped to the project, and a real row renders with a real count", async () => {
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());
    expect(view.container.textContent).toContain("1 record");
    // R67 D-14: by project SCOPE, so a document filed against one of this
    // project's permits is still on this list. This URL must stay byte-identical
    // to module-list-source.ts's own prefetch, or F-18's server-seeded first
    // paint silently stops matching.
    expect(requested.some((url) => url.includes("/api/documents?projectScopeId=p1"))).toBe(true);
  });
});

describe("DocumentsClient -- R67 D-15 the word View", () => {
  test("every row's LAST cell is a View link to the object page", async () => {
    const view = render(<DocumentsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());

    const link = view.getByRole("link", { name: "View" });
    expect(link.getAttribute("href")).toBe("/documents/doc-1");
    // Last cell of the row, not somewhere in the middle of the data columns.
    const cells = [...view.container.querySelectorAll("tbody tr td")];
    expect(cells[cells.length - 1].contains(link)).toBe(true);
  });

  test("an empty value is an en dash on every column -- a null category never reads 'other'", async () => {
    stubDocuments([{ ...DOC, category: null, fileType: null, linkedEntityType: null, linkedEntityId: null }]);
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());
    expect(view.queryByText("other")).toBeNull();
    expect(view.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});

describe("DocumentsClient -- R67 D-14 header trio", () => {
  test("the header controls are Filter | Export | + New Document, in that DOM order", async () => {
    const view = render(<DocumentsClient {...PROPS} />);
    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());

    const header = view.container.querySelector("div.flex.shrink-0") as HTMLElement;
    const labels = [...header.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["Filter", "Export", "New Document"]);
    // The old unlabelled category dropdown is gone from the header -- Category
    // now lives in the Filter bar with a label of its own.
    expect(header.querySelector("select")).toBeNull();
  });

  test("Export refuses to produce an empty file, and says why", async () => {
    stubDocuments([]);
    const view = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => expect(view.getByText(`No documents yet for ${PROJECT}.`)).toBeTruthy());
    const exportButton = [...view.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("Export")
    ) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.textContent).toContain("Nothing to export");
  });
});
