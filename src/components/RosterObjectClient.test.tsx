/// <reference types="bun-types" />
// R67 D-33 acceptance (audit R-093), asserted against the real component:
// the destructive action is "Deactivate" and the word "Delete" is nowhere on
// the page, deactivation is reversible, and display mode actually shows the
// worker's details and attendance instead of an empty body.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
// ObjectContext (shell-screen-context) reads the pathname, so a mock that
// only supplies useRouter makes the whole module fail to import.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/labour/r1",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

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

const DEFAULTS: Record<string, (init?: RequestInit) => Response> = {
  "/api/labour-roster/": () => jsonRes(ACTIVE_WORKER),
  "/api/attendance": () => jsonRes({ attendance: ATTENDANCE }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Falcon Contracting" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
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
    const { getByText, queryByText } = render(<RosterObjectClient rosterId="w1" />);

    await waitFor(() => expect(getByText("Reactivate")).toBeDefined());
    expect(queryByText("Edit")).toBeNull();
    expect(queryByText("Deactivate")).toBeNull();

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
