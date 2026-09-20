/// <reference types="bun-types" />
// R67 F-29 (audit recommendation R-273). The /scope list renders the compare
// summary that now arrives ON the list payload, and makes NO per-row request
// to do it -- the fan-out this item removes.
//
// R67 INTEGRATION TRAIN: lane D-23 wrote this file from scratch too (an
// add/add conflict, not a textual one). BOTH suites are kept in full -- F-29's
// payload-and-no-fan-out tests here, D-23's lineage-and-actions tests below.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EMPTY_VALUE } from "@/lib/format-money";

// This is a "use client" screen that calls useRouter() for its row navigation.
// Outside the App Router there is no router context, so it is stubbed here --
// the navigation targets are not what this suite is about.
const scopePush = mock((_href: string) => {});
await mock.module("next/navigation", () => ({
  useRouter: () => ({ push: scopePush, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/scope",
}));

const {
  default: ScopeClient,
  formatDeltaPct,
  applyScopeFilters,
  hasActiveScopeFilter,
  knownScopeStatuses,
  EMPTY_SCOPE_FILTERS,
} = await import("./ScopeClient");
type Boq = import("./ScopeClient").Boq;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const BASELINE: Boq = {
  id: "boq-1",
  version: 1,
  title: "Baseline",
  status: "superseded",
  parentBoqId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  compare: { lineCount: 2, total: 5020, deltaAmount: null, deltaPct: null },
};

const REVISION: Boq = {
  id: "boq-2",
  version: 2,
  title: "Rev 1",
  status: "draft",
  parentBoqId: "boq-1",
  createdAt: "2026-09-02T00:00:00.000Z",
  compare: { lineCount: 3, total: 6025, deltaAmount: 1005, deltaPct: 20.019920318725098 },
};

describe("formatDeltaPct", () => {
  test("signs the change in both directions and keeps one decimal", () => {
    expect(formatDeltaPct(20.0199)).toBe("+20.0%");
    expect(formatDeltaPct(-4.56)).toBe("-4.6%");
    expect(formatDeltaPct(0)).toBe("0.0%");
  });

  test("an unknowable percentage is absent, NEVER rendered as 0%", () => {
    // A parent that totalled nothing has no percentage change. Printing "0%"
    // would state that nothing changed, when in fact nothing is KNOWN to have
    // changed -- and the amount beside it may be a large real increase.
    expect(formatDeltaPct(null)).toBeNull();
    expect(formatDeltaPct(undefined)).toBeNull();
    expect(formatDeltaPct(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("ScopeClient rows", () => {
  test("renders line count, total and the signed variation with its percentage, all from the list payload", async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      // A real base-currency row: R67 G-05 formats money from the org's own
      // currency, and with `currencies: []` these rows would render through the
      // "no currency set" path (a warning glyph and no code) -- a degraded
      // state, not the one a user normally sees.
      return new Response(
        JSON.stringify({ boqs: [], currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const { getByText, getAllByText, container } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [REVISION, BASELINE], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Rev 1")).toBeDefined());

    // The compare summary is on screen...
    // Two decimals, because G-05 aligns a money column on the point; the code
    // is carried by the column header (unitSuffix), not repeated in the cell.
    expect(getByText("AED 6,025.00")).toBeDefined();
    expect(getByText("AED 5,020.00")).toBeDefined();
    // R67 INTEGRATION: getAllByText, not getByText. D-23 added a second
    // variation column ("vs original"), and for the FIRST revision of a
    // lineage the prior IS the original -- so the same figure legitimately
    // appears in both cells. Two columns, one true number; asserting a single
    // match here would have been asserting that the second column does not
    // exist.
    expect(getAllByText(/\+1,005\.00/)).toHaveLength(2);
    expect(getByText("(+20.0%)")).toBeDefined();

    // ...and NOT ONE request was made to get it. The server passed the rows
    // down (D-04/F-18) and the compare figures rode with them (F-29), so the
    // per-row /api/scope/{id}/compare loop is gone in the strongest sense:
    // no /compare URL is fetched at all, for either row.
    expect(fetched.filter((url) => url.includes("/compare"))).toEqual([]);
    // And the list itself is not re-read either -- the props already answer it.
    expect(fetched.filter((url) => url.includes("/api/scope"))).toEqual([]);
    // The only call this screen still makes is the org currency lookup, which
    // is a session-scoped label, not per-row data.
    expect(fetched.every((url) => url.includes("/api/currencies"))).toBe(true);
    expect(container.innerHTML).not.toContain("/compare");
  });

  test("the baseline shows its own size but no variation -- 'Baseline (Rev0)', never a zero", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ boqs: [], currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
        { status: 200 }
      )) as typeof fetch;

    const { getByText, queryByText } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [BASELINE], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Baseline")).toBeDefined());
    expect(getByText("Baseline (Rev0)")).toBeDefined();
    expect(getByText("AED 5,020.00")).toBeDefined();
    expect(queryByText("(0.0%)")).toBeNull();
  });

  test("a row from an older backend with no compare object renders en-dashes, not zeroes", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ boqs: [] }), { status: 200 })) as typeof fetch;

    const older: Boq = { ...REVISION, compare: undefined, variationVsPrior: 1005 };
    const { getByText, queryByText } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [older], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Rev 1")).toBeDefined());
    // The variation still renders from the older flat field...
    expect(getByText(/\+1,005/)).toBeDefined();
    // ...but "we were not told the line count" is an en-dash, never "0".
    expect(queryByText("(+20.0%)")).toBeNull();
  });

  test("the list region reports its state, so a latency measurement can see when it is usable (F-31)", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ boqs: [] }), { status: 200 })) as typeof fetch;

    const { container } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [REVISION], errorMessage: null }} />
    );

    await waitFor(() => expect(container.querySelector("[data-state='ready']")).not.toBeNull());
  });
});

// ---------------------------------------------------------------------------
// R67 D-23 -- MERGED IN BY THE INTEGRATION TRAIN.
//
// THE FAULT D-23 PINS: /scope rendered every BOQ of a project as a flat,
// version-DESC list, so three revision chains read as nine unrelated rows; the
// only variation column was labelled "vs. prior" and there was no way to see
// how far a chain had drifted from its ORIGINAL; and "superseded" was painted
// in the DESTRUCTIVE (rose) variant this product reserves for late and error.
//
// The item's own acceptance is a Playwright run against a local dev server,
// which no lane in this programme is allowed to start. These render tests
// assert the same visible outcomes against the real component.
//
// THREE ASSERTIONS ARE CORRECTED TO THE MERGED REALITY rather than dropped,
// and each correction is named where it is made:
//   * the date form is D-74's ONE org form (dd-mm-yyyy), not D-23's "28 Aug 2026";
//   * the action cell's minimum width is G-04's 300px, not D-23's 260px;
//   * "Baseline (Rev0)" STAYS in the variation cells of a root row -- F-29's
//     own test requires it and it answers a different question from the
//     version cell (see that test's own note).
// ---------------------------------------------------------------------------

/** One three-revision lineage, fed in the backend's own version-DESC order. */
const LINEAGE: Boq[] = [
  { id: "a2", version: 3, title: "Villa 21 Fit-out", status: "approved", parentBoqId: "a1", createdAt: "2026-08-28T00:00:00.000Z", totalVariation: 2025, totalVariationVsOriginal: 1175 },
  { id: "a1", version: 2, title: "Villa 21 Fit-out", status: "superseded", parentBoqId: "a0", createdAt: "2026-08-10T00:00:00.000Z", totalVariation: -850, totalVariationVsOriginal: -850 },
  { id: "a0", version: 1, title: "Villa 21 Fit-out", status: "superseded", parentBoqId: null, createdAt: "2026-08-01T00:00:00.000Z" },
];

const AED = { id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true };

function mountLineage(boqs: Boq[] = LINEAGE) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ currencies: [AED] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  // Seeded from the server exactly as scope/page.tsx does (F-18), so nothing
  // here depends on a list fetch the merged screen no longer makes.
  return render(<ScopeClient projectId="proj-1" initial={{ rows: boqs, errorMessage: null }} />);
}

describe("ScopeClient lineage grouping (D-23)", () => {
  test("renders one lineage as Rev0, Rev1, Rev2 in that order under one title", async () => {
    const { findAllByText, getAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    const versionCells = [...document.querySelectorAll("tbody tr td:nth-child(2)")].map((c) => c.textContent?.trim());
    expect(versionCells).toEqual(["Rev0", "Rev1", "Rev2"]);
    // All three rows carry the SAME title -- they are one BOQ's history, not
    // three unrelated BOQs.
    expect(getAllByText("Villa 21 Fit-out")).toHaveLength(3);
  });

  test("the original's own version cell reads Rev0, and its variation cells say why there is no figure", async () => {
    const { findAllByText, getAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    // D-23's win: the version column names the revision, so a reader no longer
    // has to infer "this is the original" from a variation cell.
    const firstVersionCell = document.querySelector("tbody tr td:nth-child(2)") as HTMLElement;
    expect(firstVersionCell.textContent?.trim()).toBe("Rev0");

    // CORRECTED: D-23 asserted "Baseline (Rev0)" had LEFT the variation column.
    // It has not, and deliberately: F-29's test above requires it, and it
    // answers a different question -- "there is no prior to vary from" rather
    // than "which revision is this". It is said ONCE per baseline row, in the
    // vs-prior column; the vs-original cell carries its own reason in a title,
    // because saying the same thing twice across one row reads as two facts.
    expect(getAllByText("Baseline (Rev0)")).toHaveLength(1);
    expect(document.querySelector("[title='This revision is the original']")).not.toBeNull();
  });

  test("shows BOTH signed variation columns, with the payload's own figures", async () => {
    const { findAllByText, getByText, getAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    // WS-G's formatSignedMoney is the one formatter now: direction glyph,
    // explicit sign, and always two decimals.
    expect(getByText(/\+2,025\.00/)).toBeDefined(); // Rev2 vs prior
    expect(getAllByText(/-850\.00/).length).toBeGreaterThan(0); // Rev1, both columns
    expect(getByText(/\+1,175\.00/)).toBeDefined(); // Rev2 vs original

    // R67 G-05: the currency lives in the column HEADER, once, rather than
    // being repeated down every row.
    const headers = [...document.querySelectorAll("thead th")].map((h) => h.textContent?.trim());
    expect(headers).toContain("Variation vs original (AED)");
    expect(headers).toContain("Variation vs. prior (AED)");
  });

  test("a revision with no figure gets the empty-value dash titled 'Variation unavailable', never a fabricated AED 0", async () => {
    // A revision the backend answered without any variation figure at all --
    // an older payload, or a comparison it could not compute. It is NOT a
    // baseline, so "Baseline (Rev0)" would be a lie and "0" would be worse.
    const unknown: Boq[] = [
      { id: "b0", version: 1, title: "Tower B", status: "approved", parentBoqId: null, createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "b1", version: 2, title: "Tower B", status: "draft", parentBoqId: "b0", createdAt: "2026-08-09T00:00:00.000Z" },
    ];
    const { findAllByText } = mountLineage(unknown);
    await findAllByText("Tower B");

    const unavailable = [...document.querySelectorAll("[title='Variation unavailable']")];
    expect(unavailable.length).toBeGreaterThanOrEqual(1);
    expect(unavailable[0].textContent).toBe(EMPTY_VALUE);
    // Never a zero: "no figure" and "this revision changed nothing" are
    // different answers and must not render the same.
    expect(unavailable[0].textContent).not.toContain("0");
  });

  test("status is a glyph plus a WORD from WS-G's one status map, and superseded is not painted destructive", async () => {
    const { findAllByText, getAllByText, getByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    // The pill renders the backend's own word; the glyph beside it is the
    // non-colour carrier. Rose is reserved for late and error, so a superseded
    // revision -- which is history, not a fault -- must not be painted with it.
    expect(getAllByText("superseded")).toHaveLength(2);
    expect(getByText("approved")).toBeDefined();
    const pill = getAllByText("superseded")[0].parentElement as HTMLElement;
    expect(pill.getAttribute("style")).toContain("--status-neutral-text");
    expect(pill.getAttribute("style")).not.toContain("--status-late-text");
  });

  test("tags the latest approved revision 'Current'", async () => {
    const { findAllByText, getAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");
    expect(getAllByText("Current")).toHaveLength(1);
  });

  test("dates read in the org's ONE form, dd-mm-yyyy", async () => {
    // CORRECTED: D-23 asserted "28 Aug 2026". D-74 is the item that
    // consolidates the whole product onto one date form and names this screen
    // in its acceptance, so the merged screen renders formatDate()'s
    // dd-mm-yyyy. Two forms on seven screens was the finding; keeping a nicer
    // one here would have left it standing.
    const { findAllByText, getByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");
    expect(getByText("28-08-2026")).toBeDefined();
  });
});

describe("ScopeClient row actions and header (D-23)", () => {
  test("'New Revision' renders as a visible word on every row and cannot wrap", async () => {
    const { findAllByText, getAllByRole } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    const newRevision = getAllByRole("button", { name: /New Revision/ });
    expect(newRevision).toHaveLength(3);

    const actionCell = document.querySelector("tbody tr td:last-child") as HTMLElement;
    expect(actionCell.className).toContain("whitespace-nowrap");
    // CORRECTED: G-04 widened this to 300px so all three labels fit; D-23's
    // own number was 260. The assertion is the rule, not the pixel count that
    // happened to satisfy it first.
    expect(actionCell.className).toContain("min-w-[300px]");
  });

  test("the wide table scrolls inside its own container, so the page never does", async () => {
    const { findAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");
    const table = document.querySelector("table") as HTMLElement;
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  test("each row is a keyboard-reachable link that opens the BOQ on Enter", async () => {
    scopePush.mockClear();
    const { findAllByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    const row = document.querySelector("tbody tr") as HTMLElement;
    expect(row.getAttribute("role")).toBe("link");
    expect(row.getAttribute("tabindex")).toBe("0");
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => expect(scopePush).toHaveBeenCalledWith("/scope/a0"));
  });

  test("the header row is Filter | Export | Import | + New BOQ, Filter and Export both REAL (PROJEXA-E2E-001 item 4)", async () => {
    const { findAllByText, getByRole } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    const filter = getByRole("button", { name: /^Filter/ }) as HTMLButtonElement;
    const exportBtn = getByRole("button", { name: /^Export/ }) as HTMLButtonElement;
    // Filter is never disabled -- toggling the bar costs nothing even on an
    // empty list. Export is enabled here because LINEAGE has real rows.
    expect(filter.disabled).toBe(false);
    expect(exportBtn.disabled).toBe(false);
    expect(filter.textContent).not.toContain("Not yet available");
    expect(exportBtn.textContent).not.toContain("Not yet available");
    expect(getByRole("button", { name: "Import" })).toBeDefined();
    expect(getByRole("button", { name: /New BOQ/ })).toBeDefined();
  });

  test("Export refuses to produce an empty file, and says why", async () => {
    const { findByText, getByRole } = mountLineage([]);
    await findByText(/No BOQs yet for this project\./);

    const exportBtn = getByRole("button", { name: /^Export/ }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.textContent).toContain("Nothing to export");
  });

  test("the empty state offers Import as well as create", async () => {
    const { findByText, getAllByRole } = mountLineage([]);
    await findByText(/No BOQs yet for this project\. Import an Excel or create one\./);
    // One in the header row, one in the empty state itself -- both real.
    expect(getAllByRole("button", { name: "Import" })).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PROJEXA-E2E-001 item 4: "/scope -- Filter and Export marked 'Not yet
// available'." Confirmed by reading the component that both were genuinely
// UNBUILT stubs (disabled, no handler, no data wired) -- not a bug masking a
// silent failure, unlike this same work order's /change-orders and
// /site-diary findings. Real filter (Status + Title, applied client-side over
// the rows already on screen) and real Export (a CSV of exactly what the
// filter leaves visible, via this repo's one shared csv-export.ts builder)
// built below, same pattern already shipped for DocumentsClient.tsx (R67 D-14).
// ---------------------------------------------------------------------------

describe("applyScopeFilters / hasActiveScopeFilter / knownScopeStatuses (pure, PROJEXA-E2E-001 item 4)", () => {
  const APPROVED: Boq = { id: "s1", version: 1, title: "Villa 21 Fit-out", status: "approved", parentBoqId: null, createdAt: "2026-08-01T00:00:00.000Z" };
  const DRAFT: Boq = { id: "s2", version: 1, title: "Villa 21 MEP", status: "draft", parentBoqId: null, createdAt: "2026-08-02T00:00:00.000Z" };
  const SUPERSEDED: Boq = { id: "s3", version: 1, title: "Business Bay Shell", status: "superseded", parentBoqId: null, createdAt: "2026-08-03T00:00:00.000Z" };
  const ALL = [APPROVED, DRAFT, SUPERSEDED];

  test("status 'all' keeps every row; a real status keeps only matching rows", () => {
    expect(applyScopeFilters(ALL, EMPTY_SCOPE_FILTERS)).toEqual(ALL);
    expect(applyScopeFilters(ALL, { status: "draft", title: "" })).toEqual([DRAFT]);
    expect(applyScopeFilters(ALL, { status: "approved", title: "" })).toEqual([APPROVED]);
  });

  test("title matches case-insensitively as a substring, trimmed", () => {
    expect(applyScopeFilters(ALL, { status: "all", title: "villa 21" })).toEqual([APPROVED, DRAFT]);
    expect(applyScopeFilters(ALL, { status: "all", title: "  MEP  " })).toEqual([DRAFT]);
    expect(applyScopeFilters(ALL, { status: "all", title: "nonexistent" })).toEqual([]);
  });

  test("status and title compose (AND, not OR)", () => {
    expect(applyScopeFilters(ALL, { status: "draft", title: "villa" })).toEqual([DRAFT]);
    expect(applyScopeFilters(ALL, { status: "approved", title: "mep" })).toEqual([]);
  });

  test("hasActiveScopeFilter is false only for the untouched default", () => {
    expect(hasActiveScopeFilter(EMPTY_SCOPE_FILTERS)).toBe(false);
    expect(hasActiveScopeFilter({ status: "all", title: "  " })).toBe(false);
    expect(hasActiveScopeFilter({ status: "draft", title: "" })).toBe(true);
    expect(hasActiveScopeFilter({ status: "all", title: "villa" })).toBe(true);
  });

  test("knownScopeStatuses lists only statuses actually present, in BOQ_STATUS's own order", () => {
    // ALL has approved + draft + superseded but no "submitted" -- the option
    // list must not offer a status nothing on this project actually has.
    expect(knownScopeStatuses(ALL)).toEqual(["draft", "approved", "superseded"]);
    expect(knownScopeStatuses([DRAFT])).toEqual(["draft"]);
    expect(knownScopeStatuses([])).toEqual([]);
  });

  test("an unknown status value (future backend vocabulary) is still offered, sorted after the known ones", () => {
    const weird: Boq = { ...APPROVED, id: "s4", status: "rejected" };
    expect(knownScopeStatuses([...ALL, weird])).toEqual(["draft", "approved", "superseded", "rejected"]);
  });
});

describe("ScopeClient Filter bar (PROJEXA-E2E-001 item 4)", () => {
  test("Filter is closed by default; clicking it opens Status and Title controls", async () => {
    const { findAllByText, getByRole, queryByLabelText, getByLabelText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    expect(queryByLabelText("Status")).toBeNull();
    fireEvent.click(getByRole("button", { name: /^Filter/ }));
    expect(getByLabelText("Status")).toBeDefined();
    expect(getByLabelText("Title")).toBeDefined();
  });

  test("choosing a Status narrows the table to matching rows and shows 'Showing n of m'", async () => {
    // LINEAGE: a0 (superseded), a1 (superseded), a2 (approved) -- all one
    // lineage, same title.
    const { findAllByText, getByRole, getByLabelText, getAllByText, getByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    fireEvent.click(getByRole("button", { name: /^Filter/ }));
    fireEvent.change(getByLabelText("Status") as HTMLSelectElement, { target: { value: "approved" } });

    await waitFor(() => {
      const rowCells = [...document.querySelectorAll("tbody tr")];
      expect(rowCells).toHaveLength(1);
    });
    expect(getAllByText("Villa 21 Fit-out")).toHaveLength(1);
    expect(getByText("Showing 1 of 3")).toBeDefined();
    // The two superseded revisions of the SAME lineage are gone from the
    // TABLE -- scoped to tbody, because the Status <select> itself still
    // legitimately carries a "superseded" <option> to choose it again.
    const tbody = document.querySelector("tbody") as HTMLElement;
    expect(tbody.textContent).not.toContain("superseded");
  });

  // Title is a plain controlled text <input>. In this repo's test environment
  // (React 19 + happy-dom under bun test) fireEvent.change/.input updates the
  // DOM node's own .value but never reaches React's onChange -- measured
  // directly here, and already recorded by PermitCreateClient.test.tsx,
  // DrawingCreateClient.test.tsx, DocumentObjectClient.test.tsx and
  // BudgetAnalyticalClient.test.tsx's own "two editable fields" comment in
  // this same lane. So what Title typing decides is asserted against the
  // exact function the screen filters through (applyScopeFilters, proved
  // exhaustively above, including the "matches nothing" -> [] case), and the
  // interactive, end-to-end narrowing/"Showing n of m"/Clear-all proof below
  // is driven through the control that DOES fire a real onChange in this
  // environment -- the Status <select>.
  test("Title renders as a real, labelled, typeable text input (existence + wiring proof; behaviour proved via applyScopeFilters above)", async () => {
    const { findAllByText, getByRole, getByLabelText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    fireEvent.click(getByRole("button", { name: /^Filter/ }));
    const title = getByLabelText("Title") as HTMLInputElement;
    expect(title.tagName).toBe("INPUT");
    expect(title.type).toBe("text");
    expect(title.placeholder).toBe("Search title…");
    // It is wired to filters.title, not a decorative dead control: onChange
    // reads e.target.value, the same source fireEvent uses.
    expect(title.value).toBe("");
  });

  test("choosing a Status narrows the table, shows 'Showing n of m', and Clear all restores the full list", async () => {
    // LINEAGE: a0 (superseded), a1 (superseded), a2 (approved) -- all one
    // lineage, same title.
    const { findAllByText, getByRole, getByLabelText, getByText } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    fireEvent.click(getByRole("button", { name: /^Filter/ }));
    fireEvent.change(getByLabelText("Status") as HTMLSelectElement, { target: { value: "approved" } });

    await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(1));
    expect(getByText("Showing 1 of 3")).toBeDefined();

    fireEvent.click(getByText("Clear all"));
    await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(3));
    expect((getByLabelText("Status") as HTMLSelectElement).value).toBe("all");
  });

  // The zero-match empty state (filterActive && rows.length === 0) is not
  // reachable through the Status <select> alone in a render test: its own
  // option list (knownScopeStatuses) only ever offers statuses genuinely
  // present, so choosing a real option always leaves at least the row it
  // came from. Reaching it for real needs the Title text filter, which this
  // environment cannot drive (see the comment above). What IS proved here:
  // applyScopeFilters(ALL, { status: "all", title: "nonexistent" }) => []
  // (the pure-function suite above) feeds PaneState's mayShowEmptyState via
  // rowCount={rows.length}, and the two-branch emptyMessage/emptyAction JSX
  // in the component itself is the same shape DocumentsClient.tsx's
  // emptyStateText()/hasActiveFilter() already ships and is reviewed against.
});

describe("ScopeClient Export (PROJEXA-E2E-001 item 4)", () => {
  test("Export writes exactly the filtered/visible rows, not the full unfiltered list", async () => {
    // happy-dom does not implement URL.createObjectURL -- downloadCsv() is a
    // thin DOM-touching wrapper around it (see csv-export.ts), and no other
    // suite in this repo asserts through that call either (csv-export.test.ts
    // itself only unit-tests toCsv/csvEscape/csvFilename). Polyfilled here,
    // scoped to this one test, so the real exportVisible() -> toCsv() ->
    // downloadCsv() call path runs end to end and the actual Blob content
    // built from the real rendered rows can be inspected.
    const originalCreate = (globalThis.URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const originalRevoke = (globalThis.URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    let capturedBlob: Blob | null = null;
    (globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock";
    };
    (globalThis.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};

    try {
      const { findAllByText, getByRole, getByLabelText } = mountLineage();
      await findAllByText("Villa 21 Fit-out");
      // The org currency loads via its own async /api/currencies read; wait
      // for it so the header (and this test's header-row assertion below)
      // reflect the real "(AED)" suffix rather than a pre-load "".
      await waitFor(() => expect(document.querySelector("thead")?.textContent).toContain("(AED)"));

      fireEvent.click(getByRole("button", { name: /^Filter/ }));
      fireEvent.change(getByLabelText("Status") as HTMLSelectElement, { target: { value: "approved" } });
      await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(1));

      fireEvent.click(getByRole("button", { name: /^Export/ }));

      expect(capturedBlob).not.toBeNull();
      const text = await (capturedBlob as unknown as Blob).text();
      // Header row + exactly the ONE approved revision -- not all three.
      const lines = text.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toBe("Title,Revision,Status,Lines,Total (AED),Variation vs original (AED),Variation vs. prior (AED),Created");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("Villa 21 Fit-out");
      expect(lines[1]).toContain("approved");
      expect(lines[1]).toContain("Rev2");
    } finally {
      (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = originalCreate;
      (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = originalRevoke;
    }
  });
});
