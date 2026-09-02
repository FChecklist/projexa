/// <reference types="bun-types" />
// R67 F-08 (R-112) acceptance test — the second half.
//
//   "on /budgets/new assert the fiscal-year select is disabled on its very
//    first rendered frame for a blocked org (no enabled-then-disabled
//    transition)"
//
// THE FAULT. The form fetched fiscal years, cost centres, accounts and
// companies from the browser after hydration, so it rendered four ENABLED
// selects and then flipped them to disabled once the lookups returned. A form
// that offers a control and then withdraws it is worse than one that never
// offered it: the user has already decided to click.
//
// The lookups now arrive as props, resolved server-side (D-04 -- the VERIDIAN
// key stays server-side, which is why the browser could not do this itself),
// so the assertion below is deliberately SYNCHRONOUS: no waitFor, no act. What
// it checks is the first painted frame.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const BudgetCreateClient = (await import("./BudgetCreateClient")).default;
const { EMPTY_BUDGET_LOOKUPS } = await import("@/lib/budget-lookups");

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const READY_LOOKUPS = {
  fiscalYears: [{ id: "fy1", yearName: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", isClosed: false }],
  costCenters: [{ id: "cc1", name: "Site", projectId: null }],
  accounts: [{ id: "a1", accountName: "Direct Costs", accountNumber: "5000" }],
  companies: [],
  errorMessage: null,
};

describe("BudgetCreateClient — no enabled-then-disabled flip", () => {
  test("for a blocked org the fiscal-year select is disabled on the very first rendered frame", () => {
    // No fetch stub at all: if this component still fetched its own lookups,
    // the test would fail on an undefined global rather than pass silently.
    const { getByText } = render(<BudgetCreateClient initialLookups={EMPTY_BUDGET_LOOKUPS} />);

    const trigger = getByText("No fiscal years found in VERIDIAN").closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.hasAttribute("disabled")).toBe(true);
  });

  test("for a set-up org the same select is enabled on the first frame, with the real year in it", () => {
    const { getByText } = render(<BudgetCreateClient initialLookups={READY_LOOKUPS} />);

    const trigger = getByText("Select a fiscal year").closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.hasAttribute("disabled")).toBe(false);
  });

  // The blocked reason appears twice by design -- once as the alert on the
  // form and once as the Save button's own disabled-with-reason text, which is
  // why these use getAllByText.
  test("an unconfigured org is told it is a SETUP task, and is offered no Reload", () => {
    const { getAllByText, queryByText } = render(<BudgetCreateClient initialLookups={EMPTY_BUDGET_LOOKUPS} />);

    expect(getAllByText(/must be set up in VERIDIAN before a budget can be created here/).length).toBeGreaterThan(0);
    expect(queryByText("Reload lists")).toBeNull();
  });

  test("a FAILED lookup is a different message and does offer Reload lists -- the two facts are not merged", () => {
    const { getAllByText, getByText } = render(
      <BudgetCreateClient
        initialLookups={{ ...EMPTY_BUDGET_LOOKUPS, errorMessage: "Couldn't load fiscal years (VERIDIAN did not respond in time)" }}
      />
    );

    expect(getAllByText(/VERIDIAN did not respond in time/).length).toBeGreaterThan(0);
    expect(getByText("Reload lists")).toBeDefined();
  });
});
