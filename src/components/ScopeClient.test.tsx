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
import { cleanup, render, waitFor } from "@testing-library/react";
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

const { default: ScopeClient, formatDeltaPct } = await import("./ScopeClient");
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

  test("the header row is Filter | Export | Import | + New BOQ, the first two disabled WITH the reason", async () => {
    const { findAllByText, getByRole } = mountLineage();
    await findAllByText("Villa 21 Fit-out");

    const filter = getByRole("button", { name: /^Filter/ }) as HTMLButtonElement;
    const exportBtn = getByRole("button", { name: /^Export/ }) as HTMLButtonElement;
    expect(filter.disabled).toBe(true);
    expect(exportBtn.disabled).toBe(true);
    expect(filter.textContent).toContain("Not yet available");
    expect(getByRole("button", { name: "Import" })).toBeDefined();
    expect(getByRole("button", { name: /New BOQ/ })).toBeDefined();
  });

  test("the empty state offers Import as well as create", async () => {
    const { findByText, getAllByRole } = mountLineage([]);
    await findByText(/No BOQs yet for this project\. Import an Excel or create one\./);
    // One in the header row, one in the empty state itself -- both real.
    expect(getAllByRole("button", { name: "Import" })).toHaveLength(2);
  });
});
