/// <reference types="bun-types" />
// R48_REPORTS_BUDGETS_NO_CURRENCY_01 (gap 2): BudgetsClient.tsx's "Annual
// Amount" input had zero currency labeling anywhere in the file -- grepped
// for currencyLabel/useCurrencies/toLocaleString/formatCurrency/the rupee
// symbol, zero matches (verified 2026-08-28). The list view's own COLUMNS
// don't render annualAmount at all, so this was an entry-only gap -- fixed
// the same way ChangeOrdersClient.tsx's "Cost Impact" field already does
// (FormField label={`... (${currencyLabel(...).trim()})`}), not a new
// pattern; matches compliance-tracker's own PMS budgets page, which already
// labels this identical underlying data.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file
// in one process -- see ProcurementClient.test.tsx's identical guard.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// Dynamically imported so this module (and its transitive Radix chain) is
// only evaluated after GlobalRegistrator.register() has run -- same reason
// ProcurementClient.test.tsx imports its subject dynamically.
const BudgetsClient = (await import("./BudgetsClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, () => Response> = {
  "/api/project-budgets": () => jsonRes({ projectBudgets: [] }),
  "/api/companies": () => jsonRes({ companies: [] }),
  "/api/fiscal-years": () => jsonRes({ fiscalYears: [{ id: "fy1", yearName: "FY26", startDate: "2026-01-01", endDate: "2026-12-31", isClosed: false }] }),
  "/api/cost-centers": () => jsonRes({ costCenters: [] }),
  "/api/accounts": () => jsonRes({ accounts: [{ id: "a1", accountName: "Materials", accountNumber: "5000" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: "AED", isBaseCurrency: true }] }),
};

describe("BudgetsClient New Budget dialog (R48_REPORTS_BUDGETS_NO_CURRENCY_01)", () => {
  test("the Annual Amount field names the org's real base currency, not a bare label", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByRole, getByLabelText } = render(<BudgetsClient />);

    fireEvent.click(getByRole("button", { name: /New Budget/i }));

    // getByLabelText resolves through FormField's htmlFor/id association --
    // same query style form-field.test.tsx already uses for a label with a
    // required-asterisk suffix.
    await waitFor(() => expect(getByLabelText(/Annual Amount \(AED\)/)).toBeDefined());
  });

  test("with no base currency configured for this org, the field degrades honestly -- never a wrong hardcoded symbol", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/currencies": () => jsonRes({ currencies: [] }) });
    const { getByRole, getByLabelText, queryByText } = render(<BudgetsClient />);

    fireEvent.click(getByRole("button", { name: /New Budget/i }));

    // No base-currency row and no NEXT_PUBLIC_DEFAULT_CURRENCY_CODE in this
    // test env -> currencyLabel() returns "" (CURRENCY_FALLBACK_LABEL), so
    // the label reads "Annual Amount ()" -- unlabelled is recoverable, a
    // confidently wrong symbol is not (lib/currency.ts's own stated rule).
    await waitFor(() => expect(getByLabelText(/Annual Amount \(\)/)).toBeDefined());
    expect(queryByText(/₹|\$/)).toBeNull();
  });

  test("the input still round-trips a real value once labeled (labeling didn't break the field)", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByRole, getByLabelText } = render(<BudgetsClient />);

    fireEvent.click(getByRole("button", { name: /New Budget/i }));
    const input = await waitFor(() => getByLabelText(/Annual Amount \(AED\)/) as HTMLInputElement);
    fireEvent.change(input, { target: { value: "125000" } });
    expect(input.value).toBe("125000");
  });
});
