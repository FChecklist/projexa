/// <reference types="bun-types" />
// R67 D-13. The item's acceptance is a Playwright run against a local dev
// server, which this lane may not start; the same assertions are made here with
// /api/documents stubbed.
//
// THE ONE THAT MATTERS: over a 500, the page says "Could not load documents",
// offers a Retry, and contains NO text matching /No documents/. That is the
// whole defect -- the catch used to show a four-second toast and then fall
// through to the same branch the empty case renders, so a failed read reported
// "No documents found for this project." as fact.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// `screen` is deliberately NOT imported: it binds to document.body at module
// init, which under bun + happy-dom happens before the registrator below has
// run. Every query here comes from render()'s own return value instead.
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./DocumentsClient");
const DocumentsClient = mod.default;
const {
  EMPTY_DOCUMENT_FILTERS,
  applyDocumentFilters,
  categoryWords,
  documentsLoadErrorText,
  emptyStateText,
  hasActiveFilter,
} = mod;

const PROJECT = "Cedar Heights Villa - Phase 1";

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

function stubDocuments(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ documents: rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function stubFailure(status: number, error: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ error }), {
      status,
      headers: { "content-type": "application/json" },
    });
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

describe("documentsLoadErrorText", () => {
  test("keeps veridian-client's own wording verbatim so users recognise it across screens", () => {
    const text = documentsLoadErrorText(
      new Error("The construction data service did not respond in time, on two attempts. Please retry.")
    );
    expect(text).toBe(
      "Could not load documents: The construction data service did not respond in time, on two attempts. Please retry."
    );
  });

  test("adds the full stop only when the backend's message does not already end in one", () => {
    expect(documentsLoadErrorText(new Error("Internal Server Error"))).toBe(
      "Could not load documents: Internal Server Error."
    );
    expect(documentsLoadErrorText(new Error("Nope!"))).toBe("Could not load documents: Nope!");
  });
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
  test("THE ACCEPTANCE: over a 500 the screen shows the backend's words and a Retry, and never says 'No documents'", async () => {
    stubFailure(500, "Internal Server Error");
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(view.getAllByText(/Could not load documents/).length).toBeGreaterThan(0));
    expect(view.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
    // The empty-state wording must never appear over a failed GET.
    expect(view.queryByText(/No documents/)).toBeNull();
    // ...and the error is mirrored into the persistent band below the card,
    // counted, so the reason survives after the table scrolls out of view.
    expect(view.getByText("1 error")).toBeTruthy();
  });

  test("a successful read with no rows names the project and offers the create route", async () => {
    stubDocuments([]);
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(view.getByText(`No documents yet for ${PROJECT}.`, { exact: false })).toBeTruthy());
    const link = view.getByRole("link", { name: "+ New Document" });
    expect(link.getAttribute("href")).toBe("/documents/upload?projectId=p1");
    expect(view.queryByText(/Could not load documents/)).toBeNull();
  });

  test("the loading branch is a skeleton carrying the REAL column headers, marked aria-busy", () => {
    // Never resolves, so the component stays in the loading branch.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    expect(view.container.querySelector("[aria-busy='true']")).toBeTruthy();
    for (const header of ["Name", "Category", "Type", "Size", "Expiry", "Added", "Relates to"]) {
      expect(view.getAllByText(header).length).toBeGreaterThan(0);
    }
    // No claim about the data is made while the read is still running.
    expect(view.queryByText(/No documents/)).toBeNull();
  });

  test("rows are scoped to the project, and a real row renders instead of an empty state", async () => {
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());
    // R67 D-14: by project SCOPE, so a document filed against one of this
    // project's permits is still on this list.
    expect(requested.some((url) => url.includes("/api/documents?projectScopeId=p1"))).toBe(true);
  });

  test("a fallback project selection is announced rather than shown silently", async () => {
    const view = render(
      <DocumentsClient
        projectId="p1"
        projectName={PROJECT}
        fellBack
        projects={[{ id: "p1", name: PROJECT }, { id: "p2", name: "Marina Tower" }]}
      />
    );

    await waitFor(() =>
      expect(
        view.getByText(`Showing ${PROJECT} (first project). Choose a project in the top rail to switch.`)
      ).toBeTruthy()
    );
    expect(view.getByRole("button", { name: "Change project" })).toBeTruthy();
  });
});

describe("DocumentsClient -- R67 D-15 the word View", () => {
  test("every row's LAST cell is a View link to the object page", async () => {
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);
    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());

    const link = view.getByRole("link", { name: "View" });
    expect(link.getAttribute("href")).toBe("/documents/doc-1");
    // Last cell of the row, not somewhere in the middle of the data columns.
    const cells = [...view.container.querySelectorAll("tbody tr td")];
    expect(cells[cells.length - 1].contains(link)).toBe(true);
  });

  test("an empty value is an en dash on every column -- a null category never reads 'other'", async () => {
    stubDocuments([{ ...DOC, category: null, fileType: null, linkedEntityType: null, linkedEntityId: null }]);
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(view.getByText("DEWA permit 2026.pdf")).toBeTruthy());
    expect(view.queryByText("other")).toBeNull();
    expect(view.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});

describe("DocumentsClient -- R67 D-14 header trio", () => {
  test("the header controls are Filter | Export | + New Document, in that DOM order", async () => {
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);
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
    const view = render(<DocumentsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(view.getByText(`No documents yet for ${PROJECT}.`, { exact: false })).toBeTruthy());
    const exportButton = [...view.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("Export")
    ) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.textContent).toContain("Nothing to export");
  });
});
