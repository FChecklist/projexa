/// <reference types="bun-types" />
// R67 D-33 acceptance (audit R-093), asserted against the real component:
// the destructive action is "Deactivate" and the word "Delete" is nowhere on
// the page, deactivation is reversible, and display mode actually shows the
// worker's details and attendance instead of an empty body.
//
// R67 D-34 (R-085). The object page's edit fields used to be an independent
// SECOND copy of the create form's -- refusing an empty name with a toast where
// the create screen refused it silently, with free-text Trade and an unmarked,
// uncurrencied Daily Rate. They are the same component now, reading the same
// validation model, on the D-09 ObjectScreen fork so Deactivate is
// rendered-with-a-reason rather than silently absent on a worker who is already
// inactive.
//
// ---------------------------------------------------------------------------
// D3 x D21 MERGE (decision D-11). This file was an add/add: two independent
// suites for one component, with two different harnesses. BOTH SUITES SURVIVE.
// The harness below is the union, and it MOCKS LESS than either lane did --
// D21 mocked @/lib/currency wholesale, which cannot work now that the merged
// screen also uses useOrgMoney(), because that reads useCurrenciesState from
// the same module and a whole-module mock deletes it. Serving /api/currencies
// instead drives BOTH through their real code path, and the real
// currencyLabel() returns exactly the "AED " D21's mock hard-coded.
//
// Three assertions are RESTATED against the merged mechanism, not deleted:
//   - D21's "Edit and Delete are BOTH rendered" now matches /^Deactivate/,
//     because D-33/R-093 won the word (the action keeps every attendance row).
//     What that test was actually pinning -- the D-09 fork renders both
//     controls rather than hiding one -- is unchanged.
//   - D3's "an inactive worker offers Reactivate INSTEAD OF Edit" now expects
//     Edit and Deactivate to be PRESENT AND DISABLED WITH THEIR REASON, beside
//     an enabled Reactivate. Decision D-22 (a control that vanishes cannot be
//     told apart from a broken feature) is the canonical posture; D-33's real
//     requirement -- an inactive worker can be neither edited nor deactivated,
//     and can be reactivated -- is still pinned, and more precisely than before.
// ---------------------------------------------------------------------------
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
// ObjectContext (shell-screen-context) reads the pathname, so a mock that
// only supplies useRouter makes the whole module fail to import. `refresh` is
// lane D21's addition to the same stub.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/labour/r1",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));
// NOTE: @/lib/currency is deliberately NOT mocked -- see the merge note above.
// /api/currencies below drives both useCurrencies() and useOrgMoney().

const RosterObjectClient = (await import("./RosterObjectClient")).default;

const ACTIVE_WORKER = {
  id: "w1", projectId: "p1", name: "Ali Hassan", employeeCode: "W-0001",
  trade: "Civil", skillLevel: null, vendorId: "v1", dailyRate: "300", isActive: true,
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function router(handlers: Record<string, (init?: RequestInit) => Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler(init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const ATTENDANCE = [
  { id: "a1", attendanceDate: "2026-09-01", status: "present", hoursWorked: "8", dailyCost: "300" },
  { id: "a2", attendanceDate: "2026-09-02", status: "half_day", hoursWorked: null, dailyCost: "150" },
];

const CURRENCIES = { currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] };

// Order matters: router() matches by substring in INSERTION order, and
// "/api/labour-roster/" is a prefix of "/api/labour-roster/trades", so the
// trades lookup useTrades() makes (lane D21's picklist) has to be listed first
// or it would be answered with a worker record.
const DEFAULTS: Record<string, (init?: RequestInit) => Response> = {
  "/api/labour-roster/trades": () => jsonRes({ trades: ["Mason", "Carpenter"] }),
  "/api/labour-roster/": () => jsonRes(ACTIVE_WORKER),
  "/api/attendance": () => jsonRes({ attendance: ATTENDANCE }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Falcon Contracting" }] }),
  "/api/currencies": () => jsonRes(CURRENCIES),
};

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("the destructive word (R-093)", () => {
  test("an active worker's destructive action reads 'Deactivate', and no element on the page says 'Delete'", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Deactivate")).toBeDefined());
    expect(queryByText("Delete")).toBeNull();
  });

  test("the confirm states the blast radius -- what stops happening, and what is KEPT -- before any PATCH is sent", async () => {
    let patched = false;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster/": (init) => {
        if (init?.method === "PATCH") patched = true;
        return jsonRes(ACTIVE_WORKER);
      },
    });
    const { getByText, getByRole } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Deactivate")).toBeDefined());
    fireEvent.click(getByText("Deactivate"));

    const confirm = await waitFor(() => getByRole("alertdialog"));
    expect(confirm.textContent).toContain("Deactivate Ali Hassan?");
    expect(confirm.textContent).toContain("They will no longer appear in Mark Attendance.");
    expect(confirm.textContent).toContain("Their 2 attendance rows and costs are kept.");
    expect(within(confirm).getByText("Cancel")).toBeDefined();
    // Nothing has been written yet -- the confirm is a real gate.
    expect(patched).toBe(false);
  });

  test("Cancel on the confirm writes nothing and leaves the worker active", async () => {
    let patched = false;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster/": (init) => {
        if (init?.method === "PATCH") patched = true;
        return jsonRes(ACTIVE_WORKER);
      },
    });
    const { getByText, getByRole, queryByRole } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Deactivate")).toBeDefined());
    fireEvent.click(getByText("Deactivate"));
    const confirm = await waitFor(() => getByRole("alertdialog"));
    fireEvent.click(within(confirm).getByText("Cancel"));

    await waitFor(() => expect(queryByRole("alertdialog")).toBeNull());
    expect(patched).toBe(false);
  });

  test("confirming sends isActive:false -- a soft deactivate, never a delete", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster/": (init) => {
        if (init?.method === "PATCH") {
          sentBody = JSON.parse(String(init.body));
          return jsonRes({ ...ACTIVE_WORKER, isActive: false });
        }
        return jsonRes(ACTIVE_WORKER);
      },
    });
    const { getByText, getByRole } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Deactivate")).toBeDefined());
    fireEvent.click(getByText("Deactivate"));
    const confirm = await waitFor(() => getByRole("alertdialog"));
    fireEvent.click(within(confirm).getByText("Deactivate"));

    await waitFor(() => expect(sentBody).toEqual({ isActive: false }));
  });
});

describe("deactivation is no longer one-way", () => {
  test("an inactive worker offers Reactivate instead of Edit, and it PATCHes isActive:true", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster/": (init) => {
        if (init?.method === "PATCH") {
          sentBody = JSON.parse(String(init.body));
          return jsonRes({ ...ACTIVE_WORKER, isActive: true });
        }
        return jsonRes({ ...ACTIVE_WORKER, isActive: false });
      },
    });
    const { getByText, getByRole } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Reactivate")).toBeDefined());

    // RESTATED for the D3 x D21 merge. D3 originally asserted Edit and
    // Deactivate were ABSENT here. Under decision D-22 they are instead
    // RENDERED AND DISABLED, each saying why -- a control that vanishes cannot
    // be told apart from a broken feature. What D-33 requires is unchanged and
    // is what is asserted: an inactive worker can be neither edited nor
    // deactivated, and the screen says so in words rather than by omission.
    const edit = getByRole("button", { name: /^Edit/ }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(getByText(/This worker is inactive/)).toBeDefined();

    const deactivate = getByRole("button", { name: /^Deactivate/ }) as HTMLButtonElement;
    expect(deactivate.disabled).toBe(true);
    expect(getByText(/Already inactive/)).toBeDefined();

    // The word is still never "Delete", active or inactive (R-093).
    expect(document.body.textContent).not.toContain("Delete");

    fireEvent.click(getByText("Reactivate"));
    await waitFor(() => expect(sentBody).toEqual({ isActive: true }));
  });
});

describe("display mode actually shows something", () => {
  test("a read-only Details block names ID, Trade, Company, Daily Rate and Status", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Details")).toBeDefined());
    const details = getByText("Details").closest("section")!;
    expect(details.textContent).toContain("ID: W-0001");
    expect(details.textContent).toContain("Trade: Civil");
    expect(details.textContent).toContain("Company: Falcon Contracting");
    expect(details.textContent).toContain("Daily Rate: AED 300.00");
    expect(details.textContent).toContain("Status: Active");
  });

  test("the Attendance table lists the worker's rows and totals their cost", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("01 Sep 2026")).toBeDefined());
    expect(getByText("02 Sep 2026")).toBeDefined();
    expect(getByText("Half day")).toBeDefined();
    const attendanceSection = getByText("Attendance").closest("section")!;
    const foot = attendanceSection.querySelector("tfoot") as HTMLElement;
    expect(within(foot).getByText("Total cost")).toBeDefined();
    expect(within(foot).getByText("AED 450.00")).toBeDefined();
  });

  test("the history is fetched for the selected month window, not for the whole ledger", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      urls.push(url);
      for (const [path, handler] of Object.entries(DEFAULTS)) {
        if (url.includes(path)) return handler();
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    render(<RosterObjectClient rosterId="w1" />);
    await waitFor(() => expect(urls.some((u) => u.includes("rosterId=w1&from="))).toBe(true));
    expect(urls.some((u) => /rosterId=w1&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/.test(u))).toBe(true);
  });

  test("a worker with no attendance gets the stated empty line, not an empty table", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ attendance: [] }) });
    const { getByText } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("No attendance recorded for this worker yet")).toBeDefined());
  });

  test("a failed attendance load says so in the closed vocabulary with a Retry, instead of showing zero rows", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ error: "upstream boom" }, 502) });
    const { getByText, queryByText } = render(<RosterObjectClient rosterId="w1" />);

    // R67 D-65 merge: the sentence comes from the product's ONE shared read
    // vocabulary now (src/lib/task-errors.ts) rather than this module's own
    // strings. What D-33 requires is unchanged and is what is asserted: the
    // subject the user asked for, never the raw upstream text, and a Retry --
    // and above all NOT an empty table, which would read as "this worker has
    // never been marked".
    await waitFor(() => expect(getByText(/attendance for this worker/)).toBeDefined());
    expect(getByText(/attendance for this worker/).textContent).not.toContain("upstream boom");
    expect(queryByText("No attendance recorded for this worker yet")).toBeNull();
    expect(getByText("Retry")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Lane D21's suite (R67 D-34). Kept whole; jsonRes() above is now shared rather
// than redeclared, and mount() gained the attendance/currencies stubs the
// merged screen needs (D3's display half always loads them).
// ---------------------------------------------------------------------------

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
    // Added by the D3 x D21 merge: the merged screen carries D3's display half,
    // which always loads the attendance history and the org currency.
    if (url.includes("/api/attendance")) return jsonRes({ attendance: [] });
    if (url.includes("/api/currencies")) return jsonRes(CURRENCIES);
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
    // RESTATED for the D3 x D21 merge: the merged screen names the company in
    // BOTH the facet strip (D21) and the Details section (D3), so this is
    // findAllByText now. The assertion itself is unchanged -- a null vendor is
    // rendered as words, never as a blank or an em-dash.
    const { findAllByText, queryByText } = mount({ vendorId: null });
    const shown = await findAllByText("Direct hire");
    expect(shown.length).toBeGreaterThan(0);
    expect(queryByText("Company: —")).toBeNull();
  });

  // RESTATED for the D3 x D21 merge: the destructive control is named
  // "Deactivate", not "Delete" (D-33 / audit R-093 -- the action sets
  // isActive=false and keeps every attendance row). What this test pins is
  // unchanged: the D-09 fork renders BOTH controls on an active worker.
  test("Edit and the destructive action are BOTH rendered on an active worker (the D-09 fork)", async () => {
    const { findByRole, getByRole } = mount();
    expect(await findByRole("button", { name: /^Edit/ })).toBeDefined();
    expect(getByRole("button", { name: /^Deactivate/ })).toBeDefined();
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
