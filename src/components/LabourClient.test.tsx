/// <reference types="bun-types" />
// R67 F-06 (R-088/R-094) acceptance test — the runnable half.
//
// The item's own acceptance is a Playwright timing run against a live pair of
// servers, which this lane may not start. Its two NON-timing assertions are
// the ones that would actually catch the regression, and they are asserted
// here against the real component:
//
//   * "the network log contains no /api/attendance request until the
//      Attendance tab is clicked"
//   * "its URL carries from= and to="
//
// Both describe the fault this item removes: /labour used to fetch the
// project's ENTIRE attendance history — workers x days, unbounded — on every
// page load, in the same Promise.allSettled that gated the roster table the
// user actually came for.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const LabourClient = (await import("./LabourClient")).default;
const { invalidateVendors } = await import("@/lib/reference-lookups");
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

afterEach(() => {
  cleanup();
  invalidateVendors();
  __resetCurrenciesCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

// Radix's TabsTrigger switches on mousedown, not on the click event that
// follows it, so a bare fireEvent.click() leaves the tab exactly where it was.
// This is the real first half of a user's click.
function activateTab(trigger: HTMLElement) {
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ROSTER = [
  { id: "r1", name: "Ravi Kumar", employeeCode: "EMP-001", trade: "Mason", skillLevel: null, vendorId: "v1", dailyRate: "180", isActive: true },
];

function stubFetch(options: { vendorsFail?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/labour-roster")) return jsonRes({ roster: ROSTER });
    if (url.includes("/api/attendance")) return jsonRes({ attendance: [] });
    if (url.includes("/api/vendors")) {
      return options.vendorsFail
        ? jsonRes({ error: "VERIDIAN did not respond in time" }, 504)
        : jsonRes({ vendors: [{ id: "v1", vendorName: "Al Noor Contracting" }] });
    }
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

describe("LabourClient — the attendance log is windowed and deferred", () => {
  test("no /api/attendance request is made while the Roster tab is the active one", async () => {
    const calls = stubFetch();

    const { getByText } = render(<LabourClient projectId="p1" />);

    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined());

    expect(calls.filter((u) => u.includes("/api/attendance"))).toHaveLength(0);
    // The roster call itself is the one the screen exists for.
    expect(calls.filter((u) => u.includes("/api/labour-roster"))).toHaveLength(1);
  });

  test("activating the Attendance tab issues exactly one request, carrying from= and to=", async () => {
    const calls = stubFetch();

    const { getByText, getByRole } = render(<LabourClient projectId="p1" />);
    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined());

    activateTab(getByRole("tab", { name: /Attendance/ }));

    await waitFor(() => expect(calls.filter((u) => u.includes("/api/attendance"))).toHaveLength(1));

    const attendanceUrl = calls.find((u) => u.includes("/api/attendance"))!;
    const params = new URLSearchParams(attendanceUrl.split("?")[1]);
    expect(params.get("projectId")).toBe("p1");
    expect(params.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A 30-day window, not the whole history.
    const spanDays = (Date.parse(params.get("to")!) - Date.parse(params.get("from")!)) / 86_400_000;
    expect(spanDays).toBe(30);
  });

  test("'Load older' widens the window by another 30 days and re-requests", async () => {
    const calls = stubFetch();

    const { getByText, getByRole } = render(<LabourClient projectId="p1" />);
    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined());

    activateTab(getByRole("tab", { name: /Attendance/ }));
    await waitFor(() => expect(calls.filter((u) => u.includes("/api/attendance"))).toHaveLength(1));

    fireEvent.click(getByText("Load older"));
    await waitFor(() => expect(calls.filter((u) => u.includes("/api/attendance"))).toHaveLength(2));

    const second = new URLSearchParams(calls.filter((u) => u.includes("/api/attendance"))[1].split("?")[1]);
    const spanDays = (Date.parse(second.get("to")!) - Date.parse(second.get("from")!)) / 86_400_000;
    expect(spanDays).toBe(60);
  });

  test("a failing vendors lookup degrades the Company cell to an em-dash and never blocks the roster", async () => {
    stubFetch({ vendorsFail: true });

    const { getByText, getAllByText } = render(<LabourClient projectId="p1" />);

    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined());
    // The Company cell for a worker whose vendor could not be resolved.
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
});
