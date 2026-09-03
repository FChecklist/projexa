/// <reference types="bun-types" />
// R67 D-30 acceptance, asserted against the real component rather than a
// screenshot: the exact strings the item specifies ("Save sheet", "No rows
// marked", "Saving N rows…", "Attendance for 02 Sep 2026 saved — N rows,
// AED …"), the unmarked-is-not-absent rule, the trade subtotals, and the
// read-only-past-date rule.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see PayrollClient.test.tsx's own comment.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Dynamic import for the same reason PayrollClient.test.tsx uses one: the
// component's transitive Radix chain decides real-vs-noop useLayoutEffect at
// module-evaluation time, which must happen after register().
const AttendanceSheetClient = (await import("./AttendanceSheetClient")).default;

const TODAY = new Date().toISOString().slice(0, 10);

const ROSTER = [
  { id: "w1", name: "Ali Hassan", employeeCode: "W-0001", trade: "Civil", vendorId: "v1", dailyRate: "300", isActive: true },
  { id: "w2", name: "Bina Rao", employeeCode: "W-0002", trade: "Civil", vendorId: null, dailyRate: "250", isActive: true },
  { id: "w3", name: "Retired Ravi", employeeCode: "W-0003", trade: "Paint", vendorId: null, dailyRate: "200", isActive: false },
];

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

const DEFAULTS: Record<string, (init?: RequestInit) => Response> = {
  "/api/labour-roster": () => jsonRes({ roster: ROSTER }),
  "/api/attendance/bulk": () => jsonRes({ savedCount: 2, totalCost: 425, attendanceDate: "2026-09-02" }),
  "/api/attendance": () => jsonRes({ attendance: [] }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Falcon Contracting" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
};

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("AttendanceSheetClient -- the sheet itself", () => {
  test("shows one row per ACTIVE worker; a deactivated worker is not on the sheet", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );

    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    expect(getByText("Bina Rao")).toBeDefined();
    expect(queryByText("Retired Ravi")).toBeNull();
  });

  test("Save sheet is disabled with the reason 'No rows marked' until at least one row is set", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByTestId } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );

    await waitFor(() => expect(getByTestId("attendance-sheet-save")).toBeDefined());
    const save = getByTestId("attendance-sheet-save") as HTMLButtonElement;
    expect(save.textContent).toBe("Save sheet (No rows marked)");
    expect(save.disabled).toBe(true);
  });

  test("an UNMARKED row shows an en-dash for its cost -- not 0.00, which is what Absent shows", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, getAllByRole, getByTestId } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());

    const aliRow = getByText("Ali Hassan").closest("tr")!;
    expect(within(aliRow).getAllByText("—").length).toBeGreaterThan(0);

    // Marking Ali ABSENT gives a real, stated cost of zero.
    fireEvent.click(within(aliRow).getByRole("radio", { name: "Absent" }));
    await waitFor(() => expect(within(aliRow).queryByText("AED 0.00")).not.toBeNull());
    // ...and the still-unmarked worker keeps the en-dash.
    const binaRow = getByText("Bina Rao").closest("tr")!;
    expect(within(binaRow).queryByText("AED 0.00")).toBeNull();

    expect(getAllByRole("radiogroup").length).toBe(2);
    expect((getByTestId("attendance-sheet-save") as HTMLButtonElement).disabled).toBe(false);
  });

  test("marking a row prices it from the roster rate: present is the full rate, half day is half", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());

    const aliRow = getByText("Ali Hassan").closest("tr")!;
    fireEvent.click(within(aliRow).getByRole("radio", { name: "Present" }));
    await waitFor(() => expect(within(aliRow).queryByText("AED 300.00")).not.toBeNull());

    const binaRow = getByText("Bina Rao").closest("tr")!;
    fireEvent.click(within(binaRow).getByRole("radio", { name: "Half day" }));
    await waitFor(() => expect(within(binaRow).queryByText("AED 125.00")).not.toBeNull());
  });

  test("P / H / A mark the row the keyboard is in", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());

    const aliRow = getByText("Ali Hassan").closest("tr")!;
    fireEvent.keyDown(aliRow, { key: "h" });
    await waitFor(() => expect((within(aliRow).getByRole("radio", { name: "Half day" }) as HTMLInputElement).checked).toBe(true));

    fireEvent.keyDown(aliRow, { key: "A" });
    await waitFor(() => expect((within(aliRow).getByRole("radio", { name: "Absent" }) as HTMLInputElement).checked).toBe(true));
  });

  test("the foot carries a subtotal per trade and a day total equal to their sum", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, container } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());

    fireEvent.click(within(getByText("Ali Hassan").closest("tr")!).getByRole("radio", { name: "Present" }));
    fireEvent.click(within(getByText("Bina Rao").closest("tr")!).getByRole("radio", { name: "Half day" }));

    await waitFor(() => {
      const foot = container.querySelector("tfoot") as HTMLElement;
      // One subtotal row (both workers are Civil) plus the bold day total --
      // 300 + 125, so the same figure appears twice by construction.
      expect(within(foot).getByText("Civil")).toBeDefined();
      expect(within(foot).getByText("1 present · 1 half day · 0 absent")).toBeDefined();
      expect(within(foot).getByText("Day total")).toBeDefined();
      expect(within(foot).getAllByText("AED 425.00").length).toBe(2);
    });
  });
});

describe("AttendanceSheetClient -- saving", () => {
  test("the in-flight label counts the rows, and after the save the footer line is the receipt", async () => {
    let resolveSave: ((value: Response) => void) | null = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/attendance/bulk": () =>
        // A deliberately pending response so the in-flight label can be read.
        new Response(
          new ReadableStream({
            start(controller) {
              resolveSave = () => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ savedCount: 2, totalCost: 425, attendanceDate: "2026-09-02" })));
                controller.close();
              };
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    });

    const { getByText, getByTestId } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    fireEvent.click(within(getByText("Ali Hassan").closest("tr")!).getByRole("radio", { name: "Present" }));
    fireEvent.click(within(getByText("Bina Rao").closest("tr")!).getByRole("radio", { name: "Half day" }));

    fireEvent.click(getByTestId("attendance-sheet-save"));
    // The in-flight state is the LABEL, not a parenthesised refusal reason:
    // "Save sheet (Saving 2 rows…)" reads as an explanation of why the button
    // will not work. The button is disabled by the separate `disabled` flag.
    await waitFor(() => expect(getByTestId("attendance-sheet-save").textContent).toBe("Saving 2 rows…"));
    expect((getByTestId("attendance-sheet-save") as HTMLButtonElement).disabled).toBe(true);

    resolveSave?.(new Response());
    await waitFor(() =>
      expect(getByText("Attendance for 02 Sep 2026 saved — 2 rows, AED 425.00")).toBeDefined()
    );
    // ...and the sheet stays on screen, in display mode.
    expect(getByTestId("attendance-sheet-edit")).toBeDefined();
  });

  test("only MARKED rows are sent, each with its status", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/attendance/bulk": (init) => {
        sentBody = JSON.parse(String(init?.body));
        return jsonRes({ savedCount: 1, totalCost: 300, attendanceDate: TODAY });
      },
    });

    const { getByText, getByTestId } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    fireEvent.click(within(getByText("Ali Hassan").closest("tr")!).getByRole("radio", { name: "Present" }));
    fireEvent.click(getByTestId("attendance-sheet-save"));

    await waitFor(() => expect(sentBody).not.toBeNull());
    expect(sentBody).toEqual({ projectId: "p1", attendanceDate: TODAY, rows: [{ rosterId: "w1", status: "present" }] });
  });

  test("a failed save shows the closed sentence with a Retry -- never the backend's raw string", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/attendance/bulk": () => jsonRes({ error: "Roster entry not found on this project: roster-abc123" }, 404),
    });

    const { getByText, getByTestId, queryByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    fireEvent.click(within(getByText("Ali Hassan").closest("tr")!).getByRole("radio", { name: "Present" }));
    fireEvent.click(getByTestId("attendance-sheet-save"));

    await waitFor(() =>
      expect(getByText("One of these workers is no longer on this project's roster — reload the sheet. Nothing was saved.")).toBeDefined()
    );
    expect(queryByText(/roster-abc123/)).toBeNull();
    expect(getByText("Retry")).toBeDefined();
  });
});

describe("AttendanceSheetClient -- a past date is a record", () => {
  test("a past date opens read-only with an explicit Edit, and no radio inputs", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/attendance": () =>
        jsonRes({ attendance: [{ id: "a1", rosterId: "w1", attendanceDate: "2020-01-02", status: "present", hoursWorked: null, dailyCost: "300" }] }),
    });

    const { getByText, getByTestId, queryAllByRole } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate="2020-01-02" />
    );

    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    expect(queryAllByRole("radio").length).toBe(0);
    expect(getByText("This sheet is a past record — choose Edit to change it.")).toBeDefined();

    fireEvent.click(getByTestId("attendance-sheet-edit"));
    await waitFor(() => expect(queryAllByRole("radio").length).toBe(6));
  });

  // The discard confirm is INLINE, so both of its branches are reachable from
  // a test -- a window.confirm() would make this whole path untestable, which
  // is half the reason it is not one.
  test("Cancel asks before discarding, and 'Keep editing' leaves the sheet alone", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ attendance: [] }) });

    const { getByText, getByTestId, queryByText, queryAllByRole } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate="2020-01-02" />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    fireEvent.click(getByTestId("attendance-sheet-edit"));
    await waitFor(() => expect(queryAllByRole("radio").length).toBe(6));

    // Nothing is asked until Cancel is pressed.
    expect(queryByText("Discard the marks you have made on this sheet? They have not been saved.")).toBeNull();
    fireEvent.click(getByText("Cancel"));
    expect(getByText("Discard the marks you have made on this sheet? They have not been saved.")).toBeDefined();

    fireEvent.click(getByTestId("attendance-sheet-keep-editing"));
    expect(queryByText("Discard the marks you have made on this sheet? They have not been saved.")).toBeNull();
    // Still editing: the radios are still there.
    expect(queryAllByRole("radio").length).toBe(6);
  });

  test("'Discard' drops the marks, reloads and returns the past sheet to its read-only state", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/attendance": () => jsonRes({ attendance: [] }) });

    const { getByText, getByTestId, queryAllByRole } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate="2020-01-02" />
    );
    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    fireEvent.click(getByTestId("attendance-sheet-edit"));
    await waitFor(() => expect(queryAllByRole("radio").length).toBe(6));

    fireEvent.click(within(getByText("Ali Hassan").closest("tr")!).getByRole("radio", { name: "Present" }));
    fireEvent.click(getByText("Cancel"));
    fireEvent.click(getByTestId("attendance-sheet-discard"));

    await waitFor(() => expect(queryAllByRole("radio").length).toBe(0));
    expect(getByTestId("attendance-sheet-edit")).toBeDefined();
    expect(getByText("This sheet is a past record — choose Edit to change it.")).toBeDefined();
  });

  test("an existing row seeds the sheet, so re-opening a saved date shows what was recorded", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/attendance": () =>
        jsonRes({ attendance: [{ id: "a1", rosterId: "w2", attendanceDate: TODAY, status: "half_day", hoursWorked: "4", dailyCost: "125" }] }),
    });

    const { getByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );
    await waitFor(() => expect(getByText("Bina Rao")).toBeDefined());

    const binaRow = getByText("Bina Rao").closest("tr")!;
    await waitFor(() =>
      expect((within(binaRow).getByRole("radio", { name: "Half day" }) as HTMLInputElement).checked).toBe(true)
    );
    expect((within(binaRow).getByLabelText("Hours for Bina Rao") as HTMLInputElement).value).toBe("4");
  });
});

describe("AttendanceSheetClient -- failures and empty states", () => {
  test("a roster that fails to load says so in the closed vocabulary and offers Retry, instead of an empty sheet", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ error: "boom" }, 502) });

    const { getByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );

    // R67 D-65 merge: the sentence now comes from the product's ONE shared read
    // vocabulary (src/lib/task-errors.ts) rather than this module's own three
    // strings, so "supabaseKey is required" reads the same here as everywhere
    // else. D-03's requirement is what is asserted, and it is unchanged: the
    // subject the user asked for, never the raw backend text, and a Retry.
    await waitFor(() => expect(getByText(/Couldn't load the roster/)).toBeDefined());
    expect(getByText(/Couldn't load the roster/).textContent).not.toContain("boom");
    expect(getByText("Retry")).toBeDefined();
  });

  test("an empty roster offers the next step rather than a dead end", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ roster: [] }) });

    const { getByText } = render(
      <AttendanceSheetClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" attendanceDate={TODAY} />
    );

    await waitFor(() => expect(getByText("+ New Worker")).toBeDefined());
    fireEvent.click(getByText("+ New Worker"));
    expect(push).toHaveBeenCalledWith("/labour/new?projectId=p1");
  });
});
