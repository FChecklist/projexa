/// <reference types="bun-types" />
// R67 E-31 (R-264). The item's own acceptance, as a render test.
//
// Its Playwright clause is: expand Full Catalog -> click "Run this report" on
// Attendance Report -> within 3 s either a table row or the text "No attendance
// between 01-09-2026 and 02-09-2026" appears WITHOUT ANY SECOND CLICK, and the
// From input value equals the first of the month. This lane may not start a
// server, so it is asserted here against the real component: the card mounts
// when "Run this report" is pressed, so mounting IS that click, and everything
// after it must happen on its own.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ReportCatalogRunner, emptyResultSentence } from "./ReportCatalogRunner";
import { monthToDateRange } from "@/lib/report-registry";

const RANGE = monthToDateRange();

const WITH_ROWS = {
  columns: ["Worker", "Days"],
  rows: [{ Worker: "Ravi", Days: 20 }],
};
const EMPTY = { columns: ["Worker", "Days"], rows: [] };

let runCalls: { params: Record<string, unknown> }[] = [];

function stubFetch(body: unknown, { status = 200, hold = false }: { status?: number; hold?: boolean } = {}) {
  runCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/reports/definitions/")) {
      runCalls.push(JSON.parse(String(init?.body ?? "{}")));
      if (hold) return new Promise<Response>(() => {});
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function renderRunner(props: Partial<Parameters<typeof ReportCatalogRunner>[0]> = {}) {
  return render(
    <ReportCatalogRunner
      definitionId="rptdef_attendance"
      supportsCompanyScope={false}
      companies={[]}
      projectId="prj-cedar"
      subject="attendance"
      {...props}
    />
  );
}

describe("R67 E-31: the card runs on arrival, with real defaults", () => {
  test("a result appears with NO second click", async () => {
    stubFetch(WITH_ROWS);
    const { container } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Ravi"));
    expect(runCalls).toHaveLength(1);
  });

  test("the run carries month-to-date and the shell's project, without the reader typing either", async () => {
    stubFetch(WITH_ROWS);
    const { container } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Ravi"));
    expect(runCalls[0].params).toEqual({
      startDate: RANGE.from,
      endDate: RANGE.to,
      projectId: "prj-cedar",
    });
    // The first of the month, specifically -- the acceptance's own check.
    expect(String(runCalls[0].params.startDate).endsWith("-01")).toBe(true);
  });

  test("with no project resolved, the report still runs -- org-wide, not blocked", async () => {
    stubFetch(WITH_ROWS);
    const { container } = renderRunner({ projectId: null });
    await waitFor(() => expect(container.textContent).toContain("Ravi"));
    expect(runCalls[0].params.projectId).toBeUndefined();
  });

  test("an empty result names the subject and the window, not 'No rows returned.'", async () => {
    stubFetch(EMPTY);
    const { findByTestId, container } = renderRunner();
    const line = await findByTestId("catalog-empty-result");
    expect(line.textContent).toBe(emptyResultSentence("attendance", RANGE.from, RANGE.to));
    expect(line.textContent).toMatch(/^No attendance between \d{2}-\d{2}-\d{4} and \d{2}-\d{2}-\d{4}$/);
    expect(container.textContent).not.toContain("No rows returned.");
  });

  test("the parameters are COLLAPSED behind 'Edit parameters', with the range said in words", async () => {
    stubFetch(WITH_ROWS);
    const { container, findByRole } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Ravi"));
    expect(await findByRole("button", { name: "Edit parameters" })).toBeTruthy();
    // The range is visible without opening anything.
    expect(container.textContent).toContain("to");
    // ...and the From field is not on screen until the reader asks for it.
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  test("opening the parameters shows From pre-filled to the first of the month", async () => {
    stubFetch(WITH_ROWS);
    const { container, findByRole } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Ravi"));

    fireEvent.click(await findByRole("button", { name: "Edit parameters" }));

    const dates = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    expect(dates).toHaveLength(2);
    expect(dates[0].value).toBe(RANGE.from);
    expect(dates[1].value).toBe(RANGE.to);
  });

  test("while it runs the panel says how long, and offers Cancel", async () => {
    stubFetch(WITH_ROWS, { hold: true });
    const { container, findByRole } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Running…"));
    expect(container.textContent).toContain("0 s");
    expect(await findByRole("button", { name: "Cancel" })).toBeTruthy();
    // The idle affordance is unreachable while a run is in flight.
    expect(container.textContent).not.toContain("Edit parameters");
  });

  test("a failure says the server's own words and offers Run again", async () => {
    stubFetch({ message: "this definition needs a companyId" }, { status: 400 });
    const { container, findByRole } = renderRunner();
    await waitFor(() => expect(container.textContent).toContain("Could not run this report"));
    expect(container.textContent).toContain("this definition needs a companyId");
    const again = await findByRole("button", { name: "Run again" });
    fireEvent.click(again);
    await waitFor(() => expect(runCalls.length).toBeGreaterThan(1));
  });
});

describe("emptyResultSentence", () => {
  test("is the item's exact sentence, in day-first dates", () => {
    expect(emptyResultSentence("attendance", "2026-09-01", "2026-09-02")).toBe(
      "No attendance between 01-09-2026 and 02-09-2026"
    );
  });
});
