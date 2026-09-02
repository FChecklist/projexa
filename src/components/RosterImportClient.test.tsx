/// <reference types="bun-types" />
// R67 D-34 (R-091). Adding 38 workers one form at a time is the reason real
// rosters never got entered, and every trade-wise figure downstream was then
// computed over a roster that did not exist.
//
// What is under test is the SCREEN, and specifically that it never parses the
// spreadsheet itself: every preview row and every row problem on it comes from
// the server's own ?dryRun=1 parse (PROJEXA must not gain an XLSX library, and
// a second parser would be a second set of rules that can disagree with the one
// that imports).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({ useRouter: () => ({ push: (href: string) => { pushed.push(href); }, prefetch: () => {} }) }));
mock.module("@/lib/currency", () => ({ currencyLabel: () => "AED ", useCurrencies: () => [] }));

const RosterImportClient = (await import("./RosterImportClient")).default;
const { EXPECTED_COLUMNS_SENTENCE } = await import("./RosterImportClient");

afterEach(() => {
  cleanup();
  pushed.length = 0;
  requestedUrls.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const requestedUrls: string[] = [];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CLEAN_DRY_RUN = {
  rows: [
    { employeeCode: "EMP-001", name: "Ali", trade: "Mason", company: "Skyline Labour", dailyRate: 120, sheetRow: 2, skipped: false },
    { employeeCode: null, name: "Bilal", trade: "Electrician", company: null, dailyRate: 150, sheetRow: 3, skipped: false },
  ],
  issues: [],
  summary: { importable: 2, skipped: 0, label: "Import 2 rows", totalRows: 2 },
};

const PARTLY_BAD_DRY_RUN = {
  rows: [
    { employeeCode: null, name: "Ali", trade: "Mason", company: null, dailyRate: 120, sheetRow: 2, skipped: false },
    { employeeCode: null, name: "Bilal", trade: "Mason", company: null, dailyRate: 0, sheetRow: 3, skipped: true },
  ],
  issues: [{ row: 3, message: "Row 3: Daily Rate is not a number", blocking: true }],
  summary: { importable: 1, skipped: 1, label: "Import 1 row (1 skipped)", totalRows: 2 },
};

const ALL_BAD_DRY_RUN = {
  rows: [{ employeeCode: null, name: "", trade: null, company: null, dailyRate: 0, sheetRow: 2, skipped: true }],
  issues: [{ row: 2, message: "Row 2: no worker name", blocking: true }],
  summary: { importable: 0, skipped: 1, label: "Import 0 rows (1 skipped)", totalRows: 1 },
};

function mount(dryRun: unknown, opts: { importResponse?: () => Response } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    requestedUrls.push(url);
    if (url.includes("dryRun=1")) return jsonRes(dryRun);
    if (url.includes("/api/labour-roster/import") && init?.method === "POST") {
      return (opts.importResponse ?? (() => jsonRes({ imported: 2, skipped: 0, failures: [], unmatchedCompanies: [], workers: [] }, 201)))();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const view = render(<RosterImportClient projectId="proj-1" />);
  const input = view.getByLabelText("Roster spreadsheet") as HTMLInputElement;
  const file = new File(["ID,Name\n"], "roster.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return { ...view, input, file };
}

describe("RosterImportClient before a file is chosen", () => {
  test("states the columns the importer actually recognises", () => {
    const { getByText } = mount(CLEAN_DRY_RUN);
    expect(getByText(EXPECTED_COLUMNS_SENTENCE)).toBeDefined();
    expect(EXPECTED_COLUMNS_SENTENCE).toContain("ID, Name, Trade, Company, Daily Rate");
  });

  test("the primary is disabled with a real reason, not silently inert", () => {
    const { getByRole } = mount(CLEAN_DRY_RUN);
    const save = getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("Choose a file");
  });
});

describe("RosterImportClient with a clean file", () => {
  test("renders the server's preview rows and enables the primary, labelled with the count", async () => {
    const { input, getByText, getByRole } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);

    await waitFor(() => expect(getByText("Import 2 rows")).toBeDefined());
    const save = getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(getByText("Ali")).toBeDefined();
    expect(getByText("Bilal")).toBeDefined();
  });

  test("a blank ID column shows as 'auto', because the server generates one", async () => {
    const { input, getByText } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await waitFor(() => expect(getByText("auto")).toBeDefined());
  });

  test("the screen never parses the file itself -- exactly one dry-run request and no other read", async () => {
    const { input } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));
    expect(requestedUrls.filter((u) => u.includes("dryRun=1"))).toHaveLength(1);
    expect(requestedUrls).toHaveLength(1);
  });

  test("a successful import lands back on the roster carrying a count, not a toast", async () => {
    const { input, getByRole } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await waitFor(() => expect((getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(pushed.length).toBe(1));
    expect(pushed[0]).toContain("/labour?projectId=proj-1&tab=roster&imported=");
    expect(decodeURIComponent(pushed[0])).toContain("Imported 2 workers");
  });
});

describe("RosterImportClient with problem rows", () => {
  test("a bad row is named by its sheet row and the OTHER rows still import", async () => {
    const { input, getByText, getByRole } = mount(PARTLY_BAD_DRY_RUN);
    fireEvent.change(input);

    await waitFor(() => expect(getByText("Row 3: Daily Rate is not a number")).toBeDefined());
    // The item's own label shape -- the skipped count is stated, not hidden,
    // and the button stays usable for the rows that are fine.
    expect(getByText("Import 1 row (1 skipped)")).toBeDefined();
    expect((getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a file where NOTHING can be imported disables the primary with that reason", async () => {
    const { input, getByRole } = mount(ALL_BAD_DRY_RUN);
    fireEvent.change(input);

    await waitFor(() => {
      const save = getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      expect(save.textContent).toContain("No usable rows in this file");
    });
  });

  test("a failed import KEEPS the preview and shows the server's own message", async () => {
    const { input, getByRole, findByText, getByText } = mount(CLEAN_DRY_RUN, {
      importResponse: () => jsonRes({ error: "The construction data service didn't answer" }, 502),
    });
    fireEvent.change(input);
    await waitFor(() => expect((getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("button", { name: /^Save/ }));

    expect(await findByText(/The construction data service didn't answer/)).toBeDefined();
    expect(getByText("Ali")).toBeDefined();
    expect(pushed).toHaveLength(0);
  });
});
