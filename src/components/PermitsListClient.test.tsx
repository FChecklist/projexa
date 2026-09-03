/// <reference types="bun-types" />
// R67 MERGE (lane D0/F2's D-65 / D-59 / D-71 x lane D1's D-05 / D-07). Two
// suites were written for this screen from two different starting points, and
// both survive here.
//
// LANE D0'S HALF -- the read's OUTCOME. Its acceptance, verbatim: "with
// /api/permits stubbed to 500: the page shows 'Couldn't load permits' and a
// 'Retry' button and does NOT contain 'No permits yet for this project.'; with
// the same route stubbed to [] the empty sentence is shown instead." Before the
// change the fetch was `.then(r => r.json()).then(d => setPermits(d.permits ??
// []))` with the status never read, so a 500 produced an empty array and the
// kit's ListScreen printed "0 records" and the empty sentence on a project that
// has permits. That half is asserted below unchanged -- PaneState is the
// canonical data layer here (decision D-11) and this screen adopted it.
//
// LANE D1'S HALF -- the words and the affordances, RESTATED rather than
// deleted:
//
//   * D-05's column vocabulary is unchanged and still asserted. It moved into
//     src/lib/module-list-columns.ts (PERMITS_LIST_COLUMNS) at the merge, which
//     is what makes the loading SKELETON and the loaded table draw the same
//     headers -- so these assertions now hold one column set instead of two.
//   * D-05's PDF column and D-07's "Open" word column are unchanged.
//   * D-07's "the primary is the plain word New" is unchanged, and the merge
//     restored it: the frame renders a Plus icon and the label had drifted back
//     to "+ New", which read "+ + New" on screen.
//   * D-07's "the empty state names the project it queried" is RESTATED. The
//     merged screen names the project in the frame's breadcrumb band instead,
//     and PaneState's empty sentence is the module-wide one. One project name
//     per screen, in the place every other module puts it.
//   * D-07's `fellBack` banner test is dropped, not restated -- the prop no
//     longer exists. That fact moved onto the page's own heading
//     (PageHeading contextNote="auto-selected"), the same decision recorded in
//     DocumentsClient and DrawingsClient, so it is stated once rather than in
//     three panes that could disagree.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
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
  usePathname: () => "/permits",
}));

const mod = await import("./PermitsListClient");
const PermitsListClient = mod.default;
const { rowHasDocument } = mod;

const realFetch = globalThis.fetch;

const PROPS = { projectId: "p-cedar", projectName: "Cedar Heights Villa - Phase 1" };

const PERMIT = {
  id: "permit-1",
  name: "Building Permit - Villa 21",
  permitNumber: "BP-2026-0142",
  permitAuthority: "Dubai Municipality",
  issueDate: "2026-05-01",
  endDate: "2026-11-01",
  daysToExpiry: 60,
};

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
}

function stubPermits(permits: unknown[]) {
  stubFetch(200, { permits });
}

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("rowHasDocument", () => {
  test("reads C01-15's boolean when the response carries it", () => {
    expect(rowHasDocument({ hasDocument: true })).toBe(true);
    expect(rowHasDocument({ hasDocument: false, documentUrl: "https://signed" })).toBe(false);
  });

  test("falls back to today's per-row signed URL, so the column is right before that lands", () => {
    expect(rowHasDocument({ documentUrl: "https://signed" })).toBe(true);
    expect(rowHasDocument({ documentUrl: null })).toBe(false);
    expect(rowHasDocument({})).toBe(false);
  });
});

describe("PermitsListClient -- the read's outcome (D-65 / D-71)", () => {
  test("THE ACCEPTANCE: a 500 shows the failure and NEVER the empty sentence", async () => {
    stubFetch(500, { error: "Something went wrong upstream." });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load permits");
    });
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No permits yet for this project.");
    // The record count is an en-dash, never "0 records".
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("0 records");
  });

  test("a 504 is named as a timeout, from the shared dictionary", async () => {
    stubFetch(504, { error: "The construction data service did not respond in time. Please retry." });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("UPSTREAM_TIMEOUT");
    });
    expect(container.textContent).toContain("Couldn't load permits — the construction data service didn't answer");
    expect(container.textContent).not.toContain("No permits yet");
  });

  test("a 401 says so and offers no Retry, because retrying will not fix a permission", async () => {
    stubFetch(401, { error: "Unauthorized" });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("NOT_AUTHORISED");
    });
    expect(container.textContent).not.toContain("No permits yet");
    const retry = Array.from(container.querySelectorAll("button")).filter((b) => (b.textContent ?? "").includes("Retry"));
    expect(retry).toHaveLength(0);
  });

  test("only a 200 with zero rows shows the empty sentence, with its primary action", async () => {
    stubPermits([]);
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No permits yet for this project.");
    });
    expect(container.textContent).not.toContain("Couldn't load permits");
    expect(container.textContent).toContain("0 records");
  });

  test("rows render and the count becomes real", async () => {
    stubPermits([PERMIT]);
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("BP-2026-0142");
    });
    expect(container.textContent).toContain("1 record");
    expect(container.textContent).not.toContain("No permits yet");
  });

  // R67 D-59: "'(Not yet available)' replaced by a real reason such as
  // 'Export - no rows to export'." Both header controls carried the literal
  // placeholder while the shared ListHeaderActions on Labour, Materials and
  // Schedule said something real -- two conventions for the same disabled
  // control on one product. Asserted so it cannot drift back.
  test("a disabled header control gives a real reason, never the placeholder", async () => {
    stubPermits([]);
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No permits yet for this project.");
    });
    expect(container.innerHTML).not.toContain("Not yet available");
    expect(container.innerHTML).toContain("Filtering permits is not built yet");
    // With no rows on screen, Export names the reason it has TODAY.
    expect(container.innerHTML).toContain("Export — no rows to export");
  });

  test("with rows on screen, Export's reason is that it is not built -- not that there is nothing to export", async () => {
    stubPermits([PERMIT]);
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("BP-2026-0142");
    });
    expect(container.innerHTML).not.toContain("Not yet available");
    expect(container.innerHTML).toContain("Exporting permits is not built yet");
  });
});

describe("PermitsListClient columns (D-05: one word set)", () => {
  test("the end-date column is called 'End date', never 'Expiry date'", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getAllByText("End date").length).toBeGreaterThan(0));
    expect(view.queryByText("Expiry date")).toBeNull();
  });

  test("uses the module's one word set for every other column too", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getAllByText("Permit number").length).toBeGreaterThan(0));
    expect(view.getAllByText("Permit name").length).toBeGreaterThan(0);
    expect(view.getAllByText("Issuing authority").length).toBeGreaterThan(0);
    expect(view.getAllByText("Issue date").length).toBeGreaterThan(0);
  });

  // RECORDED DEVIATION, resolved at the R67 lane G merge (2026-09-03). D-05's
  // word list ends "Days left" and this test asserted that header literally.
  // Lane G's G-01 (already on main) replaced that column's bare signed number
  // with a sentence -- "expired 3 days ago" / "expires in 12 days" -- because a
  // signed number in a coloured chip is unreadable for ~8% of men, and renamed
  // the header "Status" so it stops promising a unit the cell no longer shows.
  // G-01 is the later, richer, owner-approved answer to the same audit, so it
  // wins; D-05's real defect (the same field called "Expiry date" here and
  // "End date" on the object page) is fixed and asserted above.
  test("the sixth column is G-01's 'Status', and the phrase 'Days left' is gone with it", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getAllByText("Status").length).toBeGreaterThan(0));
    expect(view.queryByText("Days left")).toBeNull();
  });

  test("a row with a document advertises it as the word PDF, and a row without renders '-'", async () => {
    stubPermits([
      { ...PERMIT, documentUrl: "https://signed.example/permit.pdf" },
      { ...PERMIT, id: "permit-2", permitNumber: "BP-2026-0143", documentUrl: null },
    ]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText("PDF")).toBeTruthy());
    const pdf = view.getByText("PDF") as HTMLAnchorElement;
    expect(pdf.getAttribute("href")).toBe("https://signed.example/permit.pdf");
    expect(pdf.getAttribute("target")).toBe("_blank");
    expect(pdf.getAttribute("rel")).toContain("noopener");
    expect(view.getAllByText("-").length).toBe(1);
  });

  test("every row carries the word 'Open', so a row says it navigates", async () => {
    stubPermits([PERMIT, { ...PERMIT, id: "permit-2" }]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    // Three: the column header plus one word-link per row.
    await waitFor(() => expect(view.getAllByText("Open").length).toBe(3));
    const rowLinks = view.getAllByText("Open").filter((el) => el.closest("td") !== null);
    expect(rowLinks.length).toBe(2);
  });
});

describe("PermitsListClient project naming (D-07)", () => {
  // RESTATED. Lane D1 asserted the project's name inside the EMPTY sentence.
  // The merged screen states it once, in the frame's breadcrumb band, and
  // leaves PaneState's module-wide sentence alone -- see this file's header.
  test("names the project it queried, in the band above the list", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient {...PROPS} />);
    await waitFor(() => expect(view.getAllByText("End date").length).toBeGreaterThan(0));
    expect(view.getByText("Cedar Heights Villa - Phase 1")).toBeTruthy();
  });

  test("falls back to the module's own name when no project name was resolved", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getAllByText("End date").length).toBeGreaterThan(0));
    expect(view.getByText("Permits")).toBeTruthy();
  });
});

describe("PermitsListClient header (D-07)", () => {
  test("the primary action is the plain word 'New' -- the frame draws the plus itself", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByRole("button", { name: "New" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "+ New" })).toBeNull();
  });
});
