/// <reference types="bun-types" />
// R67 D-34 (R-085). The object page's edit fields used to be an independent
// SECOND copy of the create form's -- refusing an empty name with a toast where
// the create screen refused it silently, with free-text Trade and an unmarked,
// uncurrencied Daily Rate. They are the same component now, reading the same
// validation model, on the D-09 ObjectScreen fork so Deactivate is
// rendered-with-a-reason rather than silently absent on a worker who is already
// inactive.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// usePathname: lane A's <ObjectContext> reads it to register this screen.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/labour/roster-1",
}));
mock.module("@/lib/currency", () => ({ currencyLabel: () => "AED ", useCurrencies: () => [] }));

const RosterObjectClient = (await import("./RosterObjectClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const WORKER = {
  id: "roster-1", projectId: "proj-1", name: "Ali", employeeCode: "W-0042",
  trade: "Tiler", skillLevel: null, vendorId: "v1", dailyRate: "120", isActive: true,
};

function mount(overrides: Partial<typeof WORKER> = {}) {
  const worker = { ...WORKER, ...overrides };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/labour-roster/trades")) return jsonRes({ trades: ["Mason", "Carpenter"] });
    if (url.includes("/api/labour-roster/roster-1")) return jsonRes(worker);
    if (url.includes("/api/vendors")) return jsonRes({ vendors: [{ id: "v1", vendorName: "Skyline Labour" }] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<RosterObjectClient rosterId="roster-1" />);
}

describe("RosterObjectClient (R67 D-34)", () => {
  test("shows the generated worker ID and the rate with its currency and /day", async () => {
    const { findByText, container } = mount();
    await findByText("Ali");
    const text = container.textContent ?? "";
    expect(text).toContain("W-0042");
    expect(text).toContain("AED 120 / day");
  });

  test("a worker with no subcontractor reads as a Direct hire, not as a blank cell", async () => {
    const { findByText } = mount({ vendorId: null });
    expect(await findByText("Direct hire")).toBeDefined();
  });

  test("Edit and Delete are BOTH rendered on an active worker (the D-09 fork)", async () => {
    const { findByRole, getByRole } = mount();
    expect(await findByRole("button", { name: /^Edit/ })).toBeDefined();
    expect(getByRole("button", { name: /^Delete/ })).toBeDefined();
  });

  test("an already-inactive worker keeps both controls, disabled WITH the reason as visible text", async () => {
    const { findByRole, getByText } = mount({ isActive: false });
    const edit = await findByRole("button", { name: /^Edit/ }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(getByText(/This worker is inactive/)).toBeDefined();
    expect(getByText(/Already inactive/)).toBeDefined();
  });

  test("Edit opens the SAME fields the create screen uses, with Trade as a picklist", async () => {
    const { findByRole, findByText, getByLabelText } = mount();
    // R67 INTEGRATION: wait for the RECORD, not just for a button called Edit.
    // F-34 gave this screen a loading frame whose action bar is present and
    // DISABLED, so an Edit button exists before the worker does -- clicking
    // that one is a no-op, which is exactly what it is there to be.
    await findByText("Ali");
    fireEvent.click(await findByRole("button", { name: /^Edit/ }));
    await waitFor(() => expect(getByLabelText(/^Name/)).toBeDefined());
    expect(getByLabelText(/^Name/).getAttribute("aria-required")).toBe("true");
    expect(getByLabelText(/^Daily Rate/).getAttribute("aria-required")).toBe("true");
    expect(getByLabelText(/^Trade/).getAttribute("role")).toBe("combobox");
  });

  test("a trade this worker already carries survives becoming a Select -- opening Edit never silently clears it", async () => {
    // "Tiler" is NOT in the seeded list this test serves, which is exactly the
    // case a naive Select would blank.
    const { findByRole, findByText, getByLabelText } = mount();
    await findByText("Ali");
    fireEvent.click(await findByRole("button", { name: /^Edit/ }));
    await waitFor(() => expect(getByLabelText(/^Trade/).textContent).toContain("Tiler"));
  });

  test("a failed load shows the backend's own words with a Retry, not a permanent 'Loading…'", async () => {
    globalThis.fetch = (async () => jsonRes({ error: "Couldn't reach the roster" }, 502)) as typeof fetch;
    const { findByText, findByRole } = render(<RosterObjectClient rosterId="roster-1" />);
    expect(await findByText(/Couldn't reach the roster/)).toBeDefined();
    expect(await findByRole("button", { name: "Retry" })).toBeDefined();
  });
});
