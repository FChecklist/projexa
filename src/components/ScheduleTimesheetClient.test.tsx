/// <reference types="bun-types" />
// R67 D-50 / D-51 for the timesheet list, asserted against the real component
// (this session may not start a dev server).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {}, back: () => {} }) }));

const ScheduleTimesheetClient = (await import("./ScheduleTimesheetClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ENTRY = {
  id: "e1",
  issueId: "t1",
  hours: "3",
  spentOn: "2026-09-02",
  activityType: "Joinery",
  comments: null,
  issue: { id: "t1", number: 12, title: "Joinery shop drawings" },
};

type FetchImpl = () => Response | Promise<Response>;

function renderClient(
  opts: { fetchImpl?: FetchImpl; highlightEntryId?: string; onMessage?: (m: unknown) => void } = {}
) {
  globalThis.fetch = (async () => (opts.fetchImpl ?? (() => jsonRes({ entries: [ENTRY] })))()) as typeof fetch;
  return render(
    <ScheduleTimesheetClient
      projectId="proj-cedar"
      projectName="Cedar Heights Villa - Phase 1"
      highlightEntryId={opts.highlightEntryId}
      onMessage={opts.onMessage as never}
    />
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("D-50 the screen is usable while it loads and after it fails", () => {
  test("'Log Time' and the skeleton are on screen together during the load", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { container, findByText } = renderClient({
      fetchImpl: async () => { await gate; return jsonRes({ entries: [] }); },
    });
    await findByText("Loading time entries…");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Log Time"))).toBe(true);
    release!();
  });

  test("a failed load keeps the button and hands the backend's sentence to the message area", async () => {
    const messages: unknown[] = [];
    const { container, findByText } = renderClient({
      fetchImpl: () => jsonRes({ error: "Timesheet service did not answer" }, 502),
      onMessage: (m) => messages.push(m),
    });
    await findByText("Retry");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Log Time"))).toBe(true);
    await waitFor(() =>
      expect(
        messages.some((m) =>
          String((m as { text?: string } | null)?.text ?? "").includes("Timesheet service did not answer")
        )
      ).toBe(true)
    );
  });

  test("'Log Time' pushes the create route", async () => {
    const { findByText } = renderClient();
    fireEvent.click((await findByText(/Log Time/)).closest("button")!);
    expect(push).toHaveBeenCalledWith("/schedule/log-time?projectId=proj-cedar");
  });
});

describe("D-50 the save receipt", () => {
  test("quotes the row the server stored and marks it in the list", async () => {
    const messages: unknown[] = [];
    const { findByTestId } = renderClient({ highlightEntryId: "e1", onMessage: (m) => messages.push(m) });
    await findByTestId("timesheet-highlighted-row");
    await waitFor(() =>
      expect(
        messages.some(
          (m) =>
            (m as { text?: string } | null)?.text ===
            "Time logged: 3.00 h on #12 Joinery shop drawings, 02 Sep 2026"
        )
      ).toBe(true)
    );
  });

  test("no receipt is claimed when the highlighted entry is not in the list", async () => {
    const messages: unknown[] = [];
    renderClient({ highlightEntryId: "nope", onMessage: (m) => messages.push(m) });
    await waitFor(() => expect(messages.length).toBeGreaterThan(0));
    expect(messages.every((m) => !String((m as { text?: string } | null)?.text ?? "").startsWith("Time logged:"))).toBe(true);
  });
});

describe("D-51 the timesheet's own columns", () => {
  test("Sumeet's order, the org date format, and hours to two decimals", async () => {
    const { container, findByText } = renderClient();
    await findByText("02 Sep 2026");
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Date", "Project", "Category", "Task", "Hours", "Comments"]);
    const row = container.querySelector("tbody tr")!;
    const cells = [...row.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[0]).toBe("02 Sep 2026");
    expect(cells[1]).toBe("Cedar Heights Villa - Phase 1");
    expect(cells[2]).toBe("Joinery");
    expect(cells[4]).toBe("3.00");
    // An empty cell is the en-dash, never blank.
    expect(cells[5]).toBe("—");
  });
});
