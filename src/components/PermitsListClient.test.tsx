/// <reference types="bun-types" />
// R67 D-05 + D-07. The lane's own acceptance for these two items is a
// Playwright run against a local dev server, which this session is not
// permitted to start (no dev server may be launched in these worktrees), so
// the same assertions are made here against the rendered component with the
// /api/permits response stubbed: the column vocabulary, the Document/Open
// affordances, and the screen naming the project it actually queried.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./PermitsListClient");
const PermitsListClient = mod.default;
const { rowHasDocument } = mod;

const PERMIT = {
  id: "permit-1",
  name: "Building Permit - Villa 21",
  permitNumber: "BP-2026-0142",
  permitAuthority: "Dubai Municipality",
  issueDate: "2026-05-01",
  endDate: "2026-11-01",
  daysToExpiry: 60,
};

function stubPermits(permits: unknown[]) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ permits }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
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

describe("PermitsListClient columns (D-05: one word set)", () => {
  test("the end-date column is called 'End date', never 'Expiry date'", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText("End date")).toBeTruthy());
    expect(view.queryByText("Expiry date")).toBeNull();
  });

  test("uses the module's one word set for every other column too", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText("Permit number")).toBeTruthy());
    expect(view.getByText("Permit name")).toBeTruthy();
    expect(view.getByText("Issuing authority")).toBeTruthy();
    expect(view.getByText("Issue date")).toBeTruthy();
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
    await waitFor(() => expect(view.getByText("Status")).toBeTruthy());
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
  test("names the project it fell back to, instead of leaving the rail to claim 'All projects'", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" projectName="Cedar Heights Villa - Phase 1" fellBack />);
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toBe(
        "Showing Cedar Heights Villa - Phase 1 (first project). Choose a project in the top rail to switch."
      )
    );
  });

  test("says nothing when the project was actually asked for", async () => {
    stubPermits([PERMIT]);
    const view = render(<PermitsListClient projectId="proj-1" projectName="Cedar Heights Villa - Phase 1" />);
    await waitFor(() => expect(view.getByText("End date")).toBeTruthy());
    expect(view.queryByRole("status")).toBeNull();
  });

  test("the empty state names the project it queried", async () => {
    stubPermits([]);
    const view = render(<PermitsListClient projectId="proj-1" projectName="Cedar Heights Villa - Phase 1" />);
    await waitFor(() => expect(view.getByText("No permits yet for Cedar Heights Villa - Phase 1.")).toBeTruthy());
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
