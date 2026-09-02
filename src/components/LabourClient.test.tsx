/// <reference types="bun-types" />
// R67 D-32 acceptance (audit R-083/R-084/R-086/R-092) plus the D-30 change to
// the Attendance tab. The item's own acceptance is a Playwright walk; these
// assert the same strings against the real component, which is checkable in
// CI without a running server.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const LabourClientModule = await import("./LabourClient");
const LabourClient = LabourClientModule.default;
const { filterRoster, summariseSheets } = LabourClientModule;

const ROSTER = [
  { id: "w1", name: "Ali Hassan", employeeCode: "W-0001", trade: "Civil", skillLevel: null, vendorId: "v1", dailyRate: "300", isActive: true },
  { id: "w2", name: "Bina Rao", employeeCode: "W-0002", trade: "Paint", skillLevel: null, vendorId: null, dailyRate: "250", isActive: true },
  { id: "w3", name: "Retired Ravi", employeeCode: "W-0003", trade: "Civil", skillLevel: null, vendorId: null, dailyRate: "200", isActive: false },
];

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
  "/api/labour-roster": () => jsonRes({ roster: ROSTER }),
  "/api/attendance": () => jsonRes({ attendance: [] }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Falcon Contracting" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
};

const PROJECT = "Cedar Heights Villa - Phase 1";

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("the header band names the project (R-084)", () => {
  test("the heading carries both the module name and the project name", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByRole } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    const heading = getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Manpower & Attendance");
    expect(heading.textContent).toContain(PROJECT);
  });

  test("when the project was reached by falling back, the screen says so instead of implying it was chosen", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} resolvedByFallback />);
    expect(getByText(`Showing ${PROJECT} — pick a project in the top rail to change`)).toBeDefined();
  });

  test("a project the user actually picked gets no such line", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { queryByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    expect(queryByText(/pick a project in the top rail/)).toBeNull();
  });

  test("the three header actions are Filter | Export | + New Worker, in that DOM order, on every tab", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container } = render(<LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />);

    await waitFor(() => {
      const header = container.querySelector("h1")!.closest("div")!.parentElement!;
      const labels = [...header.querySelectorAll("button")].map((b) => (b.textContent ?? "").split(" (")[0]);
      expect(labels.slice(0, 3)).toEqual(["Filter", "Export", "+ New Worker"]);
    });
  });
});

describe("disabled controls carry their reason (R-092)", () => {
  test("during load, + New Worker reads '+ New Worker (Loading…)'", async () => {
    // A fetch that never settles keeps the screen in its loading state.
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const { getByTestId } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    const button = getByTestId("labour-new-worker") as HTMLButtonElement;
    expect(button.textContent).toBe("+ New Worker (Loading…)");
    expect(button.disabled).toBe(true);
  });

  test("with an empty roster the attendance action reads 'Mark Attendance (Add a worker first)'", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ roster: [] }) });
    const { getByTestId } = render(<LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />);

    await waitFor(() => expect(getByTestId("labour-mark-attendance").textContent).toBe("Mark Attendance (Add a worker first)"));
    expect((getByTestId("labour-mark-attendance") as HTMLButtonElement).disabled).toBe(true);
  });

  test("with a real roster the attendance action is enabled and opens today's sheet", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByTestId } = render(<LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />);

    await waitFor(() => expect((getByTestId("labour-mark-attendance") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("labour-mark-attendance"));
    const today = new Date().toISOString().slice(0, 10);
    expect(push).toHaveBeenCalledWith(`/labour/attendance/${today}?projectId=p1`);
  });

  test("Export is disabled with '(No rows)' when the filter leaves nothing to export", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ roster: [] }) });
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    await waitFor(() => expect(getByText("Export (No rows)")).toBeDefined());
  });
});

describe("loading shows a skeleton of the real columns, not a bare spinner (R-086)", () => {
  test("the skeleton names what is loading and keeps the real column headers", () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    expect(getByText(`Loading roster for ${PROJECT}…`)).toBeDefined();
    expect(getByText("Daily Rate")).toBeDefined();
  });
});

describe("money is formatted once, through the shared formatter", () => {
  test("a daily rate renders with the org currency and two decimals", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    await waitFor(() => expect(getByText("AED 300.00")).toBeDefined());
    expect(getByText("AED 250.00")).toBeDefined();
  });
});

describe("the roster filter", () => {
  test("defaults to Active, so a deactivated worker is not in the list until the filter asks for them", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    expect(queryByText("Retired Ravi")).toBeNull();
  });

  test("an initial filter from the URL is applied on arrival, so Back restores the list as it was", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(
      <LabourClient projectId="p1" projectName={PROJECT} initialFilter={{ trade: "Paint" }} />
    );

    await waitFor(() => expect(getByText("Bina Rao")).toBeDefined());
    expect(queryByText("Ali Hassan")).toBeNull();
  });
});

describe("filterRoster (pure)", () => {
  const vendorName = (id: string | null) => (id === "v1" ? "Falcon Contracting" : "—");

  test("matches a name or an ID, case-insensitively", () => {
    expect(filterRoster(ROSTER, { q: "ali", trade: "", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
    expect(filterRoster(ROSTER, { q: "W-0002", trade: "", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w2"]);
  });

  test("status 'all' includes deactivated workers; 'inactive' shows only them", () => {
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "", status: "all" }, vendorName)).toHaveLength(3);
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "", status: "inactive" }, vendorName).map((r) => r.id)).toEqual(["w3"]);
  });

  test("trade and company narrow independently", () => {
    expect(filterRoster(ROSTER, { q: "", trade: "Civil", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "Falcon Contracting", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
  });
});

describe("the Attendance tab is a list of daily sheets (D-30)", () => {
  const ATTENDANCE = [
    { id: "a1", rosterId: "w1", attendanceDate: "2026-09-01", status: "present", hoursWorked: null, dailyCost: "300" },
    { id: "a2", rosterId: "w2", attendanceDate: "2026-09-01", status: "half_day", hoursWorked: null, dailyCost: "125" },
    { id: "a3", rosterId: "w1", attendanceDate: "2026-09-02", status: "absent", hoursWorked: null, dailyCost: "0" },
  ];

  test("one row per date, newest first, opening that date's sheet", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ attendance: ATTENDANCE }) });
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />);

    await waitFor(() => expect(getByText("02 Sep 2026")).toBeDefined());
    const firstRow = getByText("02 Sep 2026").closest("tr")!;
    fireEvent.click(firstRow);
    expect(push).toHaveBeenCalledWith("/labour/attendance/2026-09-02?projectId=p1");

    // The 1 Sep sheet totals its two rows.
    const septFirst = getByText("01 Sep 2026").closest("tr")!;
    expect(within(septFirst).getByText("AED 425.00")).toBeDefined();
  });

  test("a sheet that covers every active worker reads Complete; a partial one reads Partial", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ attendance: ATTENDANCE }) });
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />);

    await waitFor(() => expect(getByText("01 Sep 2026")).toBeDefined());
    expect(within(getByText("01 Sep 2026").closest("tr")!).getByText("Complete")).toBeDefined();
    expect(within(getByText("02 Sep 2026").closest("tr")!).getByText("Partial")).toBeDefined();
  });
});

describe("summariseSheets (pure)", () => {
  test("groups by date, counts each status and sums the cost", () => {
    const sheets = summariseSheets([
      { id: "a1", rosterId: "w1", attendanceDate: "2026-09-01", status: "present", hoursWorked: null, dailyCost: "300" },
      { id: "a2", rosterId: "w2", attendanceDate: "2026-09-01", status: "absent", hoursWorked: null, dailyCost: "0" },
      { id: "a3", rosterId: "w1", attendanceDate: "2026-09-02", status: "half_day", hoursWorked: null, dailyCost: "125" },
    ]);
    expect(sheets.map((s) => s.date)).toEqual(["2026-09-02", "2026-09-01"]);
    expect(sheets[1]).toEqual({ date: "2026-09-01", marked: 2, present: 1, halfDay: 0, absent: 1, cost: 300 });
  });

  test("no attendance yields no sheets rather than a phantom row", () => {
    expect(summariseSheets([])).toEqual([]);
  });
});
