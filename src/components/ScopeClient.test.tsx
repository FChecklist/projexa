/// <reference types="bun-types" />
// R67 D-23. THE FAULT: /scope rendered every BOQ of a project as a flat,
// version-DESC list, so three revision chains read as nine unrelated rows; the
// only variation column was labelled "vs. prior" but showed "Baseline (Rev0)"
// on originals; and "superseded" was painted in the DESTRUCTIVE (rose) variant
// this product reserves for late and error.
//
// The item's own acceptance is a Playwright run against a local dev server,
// which this lane is forbidden to start. These render tests assert the same
// three visible outcomes it asserts -- the Rev0/Rev1/Rev2 order under one
// title, a visible "New Revision" word-button, and the action cell being
// non-wrapping inside its own scroll container so the PAGE never scrolls
// sideways -- against the real component.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { EMPTY_VALUE } from "@/lib/format-money";

const push = mock(() => {});
const prefetch = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeClient = (await import("./ScopeClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** One three-revision lineage plus one independent BOQ, fed in the backend's own version-DESC order. */
const LINEAGE = [
  { id: "a2", version: 3, title: "Villa 21 Fit-out", status: "approved", parentBoqId: "a1", createdAt: "2026-08-28T00:00:00.000Z", totalVariation: 2025, totalVariationVsOriginal: 1175 },
  { id: "a1", version: 2, title: "Villa 21 Fit-out", status: "superseded", parentBoqId: "a0", createdAt: "2026-08-10T00:00:00.000Z", totalVariation: -850, totalVariationVsOriginal: -850 },
  { id: "a0", version: 1, title: "Villa 21 Fit-out", status: "superseded", parentBoqId: null, createdAt: "2026-08-01T00:00:00.000Z" },
];

function mount(boqs: unknown[] = LINEAGE) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/scope?")) return jsonRes({ boqs });
    if (url.includes("/compare")) return jsonRes({ totalVariation: 0 });
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ code: "AED", isBaseCurrency: true }] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScopeClient projectId="proj-1" />);
}

describe("ScopeClient lineage grouping (D-23)", () => {
  test("renders one lineage as Rev0, Rev1, Rev2 in that order under one title", async () => {
    const { findAllByText, getAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");

    const versionCells = [...document.querySelectorAll("tbody tr td:nth-child(2)")].map((c) => c.textContent?.trim());
    expect(versionCells).toEqual(["Rev0", "Rev1", "Rev2"]);
    // All three rows carry the SAME title -- they are one BOQ's history, not
    // three unrelated BOQs.
    expect(getAllByText("Villa 21 Fit-out")).toHaveLength(3);
  });

  test("'Baseline (Rev0)' has left the variation column -- the original's own version cell says Rev0", async () => {
    const { findAllByText, queryByText } = mount();
    await findAllByText("Villa 21 Fit-out");
    expect(queryByText(/Baseline \(Rev0\)/)).toBeNull();
  });

  test("shows BOTH signed variation columns, with the payload's own figures", async () => {
    const { findAllByText, getByText, getAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");

    // WS-G's formatSignedMoney is the one formatter now: direction glyph,
    // explicit sign, currency code, and always two decimals.
    expect(getByText("▲ AED +2,025.00")).toBeDefined(); // Rev2 vs prior
    expect(getAllByText("▼ AED -850.00").length).toBeGreaterThan(0); // Rev1, both columns
    expect(getByText("▲ AED +1,175.00")).toBeDefined(); // Rev2 vs original

    const headers = [...document.querySelectorAll("thead th")].map((h) => h.textContent?.trim());
    expect(headers).toContain("Variation vs original");
    expect(headers).toContain("Variation vs prior");
  });

  test("a row with no figure gets the empty-value dash titled 'Variation unavailable', never a fabricated AED 0", async () => {
    const { findAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");
    const unavailable = [...document.querySelectorAll("[title='Variation unavailable']")];
    // The original (Rev0) has no prior and no original to vary from -- two cells.
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
    expect(unavailable[0].textContent).toBe(EMPTY_VALUE);
    // Never a zero: "no figure" and "this revision changed nothing" are
    // different answers and must not render the same.
    expect(unavailable[0].textContent).not.toContain("0");
  });

  test("status is a glyph plus a WORD from WS-G's one status map, and superseded is not painted destructive", async () => {
    const { findAllByText, getAllByText, getByText } = mount();
    await findAllByText("Villa 21 Fit-out");

    // The pill renders the backend's own word; the glyph beside it is the
    // non-colour carrier. Rose is reserved for late and error, so a superseded
    // revision -- which is history, not a fault -- must not be painted with it.
    expect(getAllByText("superseded")).toHaveLength(2);
    expect(getByText("approved")).toBeDefined();
    // StatusPill paints the word with a token from its own map. superseded ->
    // the NEUTRAL token, never the late/rose one.
    const pill = getAllByText("superseded")[0].parentElement as HTMLElement;
    expect(pill.getAttribute("style")).toContain("--status-neutral-text");
    expect(pill.getAttribute("style")).not.toContain("--status-late-text");
  });

  test("tags the latest approved revision 'Current'", async () => {
    const { findAllByText, getAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");
    expect(getAllByText("Current")).toHaveLength(1);
  });

  test("dates read as '28 Aug 2026', not '8/28/2026'", async () => {
    const { findAllByText, getByText } = mount();
    await findAllByText("Villa 21 Fit-out");
    expect(getByText("28 Aug 2026")).toBeDefined();
  });
});

describe("ScopeClient row actions and header (D-23)", () => {
  test("'New Revision' renders as a visible word on every row and cannot wrap", async () => {
    const { findAllByText, getAllByRole } = mount();
    await findAllByText("Villa 21 Fit-out");

    const newRevision = getAllByRole("button", { name: "New Revision" });
    expect(newRevision).toHaveLength(3);

    const actionCell = document.querySelector("tbody tr td:last-child") as HTMLElement;
    expect(actionCell.className).toContain("whitespace-nowrap");
    expect(actionCell.className).toContain("min-w-[260px]");
  });

  test("the wide table scrolls inside its own container, so the page never does", async () => {
    const { findAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");
    const table = document.querySelector("table") as HTMLElement;
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  test("each row is a keyboard-reachable link that opens the BOQ on Enter", async () => {
    push.mockClear();
    const { findAllByText } = mount();
    await findAllByText("Villa 21 Fit-out");

    const row = document.querySelector("tbody tr") as HTMLElement;
    expect(row.getAttribute("role")).toBe("link");
    expect(row.getAttribute("tabindex")).toBe("0");
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/scope/a0"));
  });

  test("the header row is Filter | Export | Import | + New BOQ, the first two disabled WITH the reason", async () => {
    const { findAllByText, getByRole } = mount();
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
    const { findByText, getAllByRole } = mount([]);
    await findByText("No BOQs yet for this project. Import an Excel or create one.");
    // One in the header row, one in the empty state itself -- both real.
    expect(getAllByRole("button", { name: "Import" })).toHaveLength(2);
  });
});
