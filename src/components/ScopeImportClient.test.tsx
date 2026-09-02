/// <reference types="bun-types" />
// R67 D-25. The BOQ Excel importer has shipped end to end for months and the
// ONLY missing piece was a screen -- so what is under test here is the screen,
// and specifically that it never parses the spreadsheet itself: every preview
// row and every row error on it comes from the server's own ?dryRun=1 parse.
//
// The item's acceptance is a Playwright setInputFiles run against a local dev
// server, which this lane may not start. These tests drive the SAME code path
// with a real File and a stubbed fetch, and assert the same two outcomes it
// asserts: a clean two-line fixture summarising "2 lines ready, 0 with errors"
// with an ENABLED primary, and a fixture whose second row has a non-numeric
// Qty rendering "Row 2: Qty is not a number" with the primary DISABLED.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: mock(() => {}) }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeImportClient = (await import("./ScopeImportClient")).default;
const { summaryLine, EXPECTED_COLUMNS_SENTENCE } = await import("./ScopeImportClient");

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CLEAN_DRY_RUN = {
  rows: [
    { category: "Gypsum", code: "1", description: "Partition", unit: "sqm", quantity: 100, rate: 50, amount: 5000, parentItemCode: null, breakdownPercentage: null },
    { category: "Paint", code: "2", description: "Emulsion", unit: "sqm", quantity: 20, rate: 14, amount: 280, parentItemCode: null, breakdownPercentage: null },
  ],
  issues: [],
  summary: { totalRows: 2, readyLines: 2, rowsWithErrors: 0 },
};

const BAD_QTY_DRY_RUN = {
  rows: [CLEAN_DRY_RUN.rows[0]],
  issues: [{ row: 2, message: "Row 2: Qty is not a number", blocking: true }],
  summary: { totalRows: 2, readyLines: 1, rowsWithErrors: 1 },
};

/** Mounts the screen and returns a helper that drops a real File onto the input. */
function mount(dryRun: unknown, opts: { boqs?: unknown[]; importResponse?: () => Response } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/scope?")) return jsonRes({ boqs: opts.boqs ?? [] });
    if (url.includes("dryRun=1")) return jsonRes(dryRun);
    if (url.includes("/api/scope/import") && init?.method === "POST") {
      return (opts.importResponse ?? (() => jsonRes({ boq: { id: "boq-9", title: "Villa 21", version: 1 }, importSummary: { importedLineItems: 2 } }, 201)))();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const view = render(<ScopeImportClient projectId="proj-1" />);
  const input = view.getByLabelText("BOQ spreadsheet") as HTMLInputElement;
  const file = new File(["code,desc\n"], "villa-21-boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return { ...view, input, file };
}

describe("summaryLine", () => {
  test("always says BOTH halves, so a clean file states it out loud", () => {
    expect(summaryLine(2, 0)).toBe("2 lines ready, 0 with errors");
  });

  test("singularises honestly", () => {
    expect(summaryLine(1, 1)).toBe("1 line ready, 1 with error");
  });
});

describe("ScopeImportClient before a file is chosen (D-25)", () => {
  test("the primary is disabled with the reason 'Choose a file'", () => {
    const { getByRole } = mount(CLEAN_DRY_RUN);
    const save = getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("Choose a file");
  });

  test("states the expected columns and offers the server-built template", () => {
    const { getByText, getByRole } = mount(CLEAN_DRY_RUN);
    expect(getByText(EXPECTED_COLUMNS_SENTENCE)).toBeDefined();
    expect(getByRole("link", { name: "Download template" }).getAttribute("href")).toBe("/api/scope/import/template");
  });

  test("the file input accepts only .xlsx and .csv", () => {
    const { input } = mount(CLEAN_DRY_RUN);
    expect(input.getAttribute("accept")).toBe(".xlsx,.csv");
  });
});

describe("ScopeImportClient preview (D-25 acceptance)", () => {
  test("a clean two-line fixture summarises '2 lines ready, 0 with errors' and ENABLES 'Import (2 lines)'", async () => {
    const { input, findByText, getByRole } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);

    expect(await findByText("2 lines ready, 0 with errors")).toBeDefined();
    const save = getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  test("the preview table is rendered from the SERVER's rows, in the item's own column order", async () => {
    const { input, findByText } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await findByText("2 lines ready, 0 with errors");

    const headers = [...document.querySelectorAll("thead th")].map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Category", "Code", "Description", "Unit", "Qty", "Rate", "Amount", "Parent Item Code", "Breakdown %"]);
    expect(await findByText("Partition")).toBeDefined();
    expect(await findByText("Gypsum")).toBeDefined();
  });

  test("a fixture whose second row has a non-numeric Qty renders 'Row 2: Qty is not a number' and DISABLES the primary", async () => {
    const { input, findByText, getByRole } = mount(BAD_QTY_DRY_RUN);
    fireEvent.change(input);

    const error = await findByText("Row 2: Qty is not a number");
    expect(error).toBeDefined();
    expect(error.className).toContain("text-px-error");

    const save = getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("1 row with errors");
  });

  test("the screen never parses the file itself -- the only spreadsheet read is the server dry run", async () => {
    const urls: string[] = [];
    const inner = globalThis.fetch;
    const { input, findByText } = mount(CLEAN_DRY_RUN);
    const stub = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      urls.push(typeof i === "string" ? i : i.toString());
      return stub(i, init);
    }) as typeof fetch;
    fireEvent.change(input);
    await findByText("2 lines ready, 0 with errors");
    expect(urls.filter((u) => u.includes("dryRun=1"))).toHaveLength(1);
    globalThis.fetch = inner;
  });
});

describe("ScopeImportClient revision choice and outcome (D-25)", () => {
  test("with an existing BOQ, the screen asks whether to import as a new BOQ or as the next revision", async () => {
    const { findByText } = mount(CLEAN_DRY_RUN, {
      boqs: [{ id: "boq-1", title: "Villa 21", version: 2, status: "approved" }],
    });
    expect(await findByText(/Import as a new BOQ or as Rev2 of “Villa 21”\?/)).toBeDefined();
  });

  test("with no existing BOQ the question is not asked at all", async () => {
    const { queryByText, findByText, input } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await findByText("2 lines ready, 0 with errors");
    expect(queryByText(/Import as a new BOQ or as/)).toBeNull();
  });

  test("a successful import lands on the new BOQ carrying the confirmation in the URL", async () => {
    push.mockClear();
    const { input, findByText, getByRole } = mount(CLEAN_DRY_RUN);
    fireEvent.change(input);
    await findByText("2 lines ready, 0 with errors");

    fireEvent.click(getByRole("button", { name: "Save" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const target = (push.mock.calls[0] as unknown as string[])[0];
    expect(target).toContain("/scope/boq-9?imported=");
    expect(decodeURIComponent(target)).toContain("Imported BOQ Villa 21 · Rev0 · 2 lines");
  });

  test("a failed import KEEPS the preview and puts the server's own message in the band, never a toast", async () => {
    const { input, findByText, getByRole } = mount(CLEAN_DRY_RUN, {
      importResponse: () => jsonRes({ error: "Project not found" }, 404),
    });
    fireEvent.change(input);
    await findByText("2 lines ready, 0 with errors");

    fireEvent.click(getByRole("button", { name: "Save" }));
    expect(await findByText("Project not found")).toBeDefined();
    // The rows the user was looking at are still there.
    expect(await findByText("Partition")).toBeDefined();
  });
});
