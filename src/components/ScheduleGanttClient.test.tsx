/// <reference types="bun-types" />
// R67 D-44 acceptance for the Timeline's authoritative table, asserted against
// the real component (this session may not start a dev server).
//
// The acceptance reads: "click the first row of the 'All tasks' table and
// expect the URL to match /schedule/tasks/[^/]+ ; press Back and expect the URL
// to still carry the same ?projectId and ?tab values." A synthetic environment
// has no URL bar, so what is asserted here is the thing that DECIDES the URL:
// the row is a real <a> whose href is that route and whose ?backTo= carries the
// list's own projectId and tab back to the Object Page.
//
// The two @svar-ui mocks exist because bun cannot import a CSS file and the
// chart is behind next/dynamic(ssr:false) -- see ScheduleTabsClient.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("@svar-ui/react-gantt/all.css", () => ({}));
mock.module("@svar-ui/react-gantt", () => ({
  Gantt: () => null,
  Willow: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {}, back: () => {} }) }));

const ganttModule = await import("./ScheduleGanttClient");
const ScheduleGanttClient = ganttModule.default;
const { BASELINE_NAME_REQUIRED, NEEDS_PM_ROLE, baselineSaveLabel } = ganttModule;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TASKS = [
  {
    id: "t1", title: "Joinery shop drawings", startDate: "2026-08-01", dueDate: "2026-09-05",
    completionPercentage: 40, milestoneId: null, parentIssueId: null, isCritical: false, floatDays: 2,
  },
  {
    id: "t2", title: "Slab pour", startDate: null, dueDate: null,
    completionPercentage: 0, milestoneId: null, parentIssueId: null, isCritical: false, floatDays: null,
  },
];

const BASELINES = [
  { id: "b2", name: "Baseline test", createdAt: "2026-09-01T08:00:00.000Z", capturedById: "u1" },
  { id: "b1", name: "Original plan", createdAt: "2026-08-01T08:00:00.000Z", capturedById: "u1" },
];

// t1's planned finish is 2026-09-02 and its real due date is 2026-09-05 -- the
// exact "+3 d late" case D-45's acceptance names.
const VARIANCES = [
  { issueId: "t1", baselineStartDate: "2026-08-01", baselineDueDate: "2026-09-02" },
];

type Handler = () => Response | Promise<Response>;

function renderGantt(
  over: Partial<{ gantt: unknown; titleFilter: string; handlers: Record<string, Handler>; onMessage: (m: unknown) => void }> = {}
) {
  const handlers: Record<string, Handler> = {
    "/api/schedule/gantt": () => jsonRes(over.gantt ?? { tasks: TASKS, dependencies: [], milestones: [] }),
    "/api/schedule/baselines/b1": () => jsonRes({ baseline: BASELINES[1], variances: [] }),
    "/api/schedule/baselines/b2": () => jsonRes({ baseline: BASELINES[0], variances: VARIANCES }),
    "/api/schedule/baselines": () => jsonRes({ baselines: BASELINES }),
    "/api/organization": () => jsonRes({ organization: { id: "o1", name: "Skyline" }, role: "pm" }),
    ...(over.handlers ?? {}),
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(
    <ScheduleGanttClient
      projectId="proj-cedar"
      registryColumns={null}
      titleFilter={over.titleFilter ?? ""}
      onMessage={over.onMessage as never}
      today="2026-09-02"
    />
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("D-44 the table is the primary list", () => {
  test("'All tasks' is rendered before the Timeline chart card", async () => {
    const { container, findByText } = renderGantt();
    await findByText(/All tasks/);
    const titles = [...container.querySelectorAll("[data-slot='card-title'], .font-heading")]
      .map((el) => el.textContent ?? "")
      .filter((t) => t.startsWith("All tasks") || t === "Timeline");
    expect(titles[0]).toContain("All tasks");
    expect(titles).toContain("Timeline");
    expect(titles.indexOf("Timeline")).toBeGreaterThan(0);
  });

  test("every row is a real link to that activity, carrying the list's return address", async () => {
    const { container, findByText } = renderGantt();
    await findByText("Joinery shop drawings");
    const link = container.querySelector('a[href^="/schedule/tasks/t1"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toMatch(/^\/schedule\/tasks\/[^/?]+\?backTo=/);
    const backTo = decodeURIComponent(link.getAttribute("href")!.split("backTo=")[1]);
    expect(backTo).toBe("/schedule?projectId=proj-cedar&tab=timeline");
  });

  test("the return address carries the active filter too", async () => {
    const { container, findByText } = renderGantt({ titleFilter: "Joinery" });
    await findByText("Joinery shop drawings");
    const link = container.querySelector('a[href^="/schedule/tasks/t1"]') as HTMLAnchorElement;
    const backTo = decodeURIComponent(link.getAttribute("href")!.split("backTo=")[1]);
    expect(backTo).toBe("/schedule?projectId=proj-cedar&tab=timeline&q=Joinery");
  });
});

describe("D-44 Duration and % Complete", () => {
  test("Duration is due minus start, and the en-dash when either is unset", async () => {
    const { container, findByText } = renderGantt();
    await findByText("Joinery shop drawings");
    const rows = [...container.querySelectorAll("tbody tr")];
    const joinery = rows.find((r) => r.textContent?.includes("Joinery shop drawings"))!;
    // 2026-08-01 -> 2026-09-05 is 35 days.
    expect(joinery.textContent).toContain("35 d");
    const slab = rows.find((r) => r.textContent?.includes("Slab pour"))!;
    expect(slab.textContent).toContain("—");
  });

  test("0 % renders as '0 %' rather than as an empty or absent figure", async () => {
    const { container, findByText } = renderGantt();
    await findByText("Slab pour");
    const slab = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent?.includes("Slab pour"))!;
    expect(slab.textContent).toContain("0 %");
  });
});

describe("D-44 the header filter narrows the table", () => {
  test("only matching activities are listed, and the count says so", async () => {
    const { container, findByText } = renderGantt({ titleFilter: "slab" });
    await findByText(/All tasks/);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(1));
    expect(container.querySelector("tbody tr")!.textContent).toContain("Slab pour");
    expect(container.textContent).toContain("All tasks (1 of 2)");
  });

  test("a filter that matches nothing says so instead of showing an empty table", async () => {
    const { findByText } = renderGantt({ titleFilter: "zzz" });
    await findByText('No activity matches "zzz".');
  });
});

describe("D-45 baseline capture", () => {
  test("window.prompt is gone -- the name is asked for in a real inline form, prefilled with today", async () => {
    const promptSpy = mock(() => null);
    (globalThis as unknown as { prompt: unknown }).prompt = promptSpy;

    const { container, findByTestId } = renderGantt();
    const trigger = (await findByTestId("capture-baseline")) as HTMLButtonElement;
    // The role lookup gates the action, so wait for it before clicking.
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector("#baseline-name")).not.toBeNull());

    expect(promptSpy).not.toHaveBeenCalled();
    expect((container.querySelector("#baseline-name") as HTMLInputElement).value).toBe("Baseline 02-09-2026");
    expect((await findByTestId("baseline-save")).textContent).toBe("Save");
  });

  test("the Save label carries the reason when the name is empty", () => {
    // Asserted through the exported rule: this environment does not deliver
    // input/change events to React, so the field cannot be emptied from a test.
    expect(baselineSaveLabel("", false)).toBe(`Save (${BASELINE_NAME_REQUIRED})`);
    expect(baselineSaveLabel("   ", false)).toBe(`Save (${BASELINE_NAME_REQUIRED})`);
    expect(baselineSaveLabel("Baseline test", false)).toBe("Save");
    expect(baselineSaveLabel("Baseline test", true)).toBe("Capturing…");
  });

  test("below PM the action is disabled with its reason, instead of failing after the click", async () => {
    const { findByTestId } = renderGantt({
      handlers: {
        "/api/organization": () => jsonRes({ organization: { id: "o1" }, role: "site_engineer" }),
      },
    });
    const button = (await findByTestId("capture-baseline")) as HTMLButtonElement;
    await waitFor(() => expect(button.textContent).toBe(`Capture Baseline (${NEEDS_PM_ROLE})`));
    expect(button.disabled).toBe(true);
  });

  test("a role lookup that FAILED does not pre-refuse a PM -- the route still enforces it", async () => {
    const { findByTestId } = renderGantt({
      handlers: { "/api/organization": () => jsonRes({ error: "org lookup failed" }, 502) },
    });
    const button = (await findByTestId("capture-baseline")) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe("Capture Baseline");
  });

  test("a refused capture shows the backend's own sentence in the footer message area", async () => {
    const messages: unknown[] = [];
    const { findByTestId, container } = renderGantt({
      onMessage: (m) => messages.push(m),
      handlers: {
        "/api/schedule/baselines": () => {
          // The POST is the second call to this path; the GET must still work.
          return jsonRes({ baselines: BASELINES });
        },
      },
    });
    const trigger = (await findByTestId("capture-baseline")) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector("#baseline-name")).not.toBeNull());

    globalThis.fetch = (async () =>
      jsonRes({ error: "No issues to baseline for this project" }, 400)) as typeof fetch;
    fireEvent.click(await findByTestId("baseline-save"));

    await waitFor(() =>
      expect(
        messages.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            String((m as { text?: string }).text).includes("No issues to baseline for this project")
        )
      ).toBe(true)
    );
  });
});

describe("D-45 slip and the progress tile", () => {
  test("a due date three days after the planned one reads exactly '+3 d late'", async () => {
    const { container, findByText } = renderGantt();
    await findByText("Joinery shop drawings");
    await waitFor(() => expect(container.textContent).toContain("+3 d late"));
    const joinery = [...container.querySelectorAll("tbody tr")].find((r) =>
      r.textContent?.includes("Joinery shop drawings")
    )!;
    const slipCell = [...joinery.querySelectorAll("td")].find((td) => td.textContent?.includes("d late"))!;
    expect(slipCell.textContent).toBe("▲ +3 d late");
  });

  test("an activity with no baseline snapshot shows the en-dash, never a fabricated 0", async () => {
    const { container, findByText } = renderGantt();
    await findByText("Slab pour");
    await waitFor(() => expect(container.textContent).toContain("+3 d late"));
    const slab = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent?.includes("Slab pour"))!;
    expect(slab.textContent).not.toContain("0 d on time");
    expect(slab.textContent).toContain("—");
  });

  test("the Schedule progress tile carries the words 'days behind' and names its baseline", async () => {
    const { findByTestId } = renderGantt();
    const tile = await findByTestId("schedule-progress-tile");
    await waitFor(() => expect(tile.textContent).toContain("days behind"));
    expect(tile.textContent).toContain("Baseline test");
    expect(tile.textContent).toContain("captured 01 Sep 2026");
  });

  test("with no baseline at all the tile says so and offers the next step", async () => {
    const { findByTestId } = renderGantt({ handlers: { "/api/schedule/baselines": () => jsonRes({ baselines: [] }) } });
    const tile = await findByTestId("schedule-progress-tile");
    await waitFor(() =>
      expect(tile.textContent).toContain("No baseline recorded yet — record one to track slip")
    );
    // The actual figure is still real -- only planned and slip are unknown.
    expect(tile.textContent).toContain("20 % complete");
  });
});

describe("D-45 baselines disclosure", () => {
  test("lists each baseline's name, captured date and snapshot count", async () => {
    const { findByTestId, findByText } = renderGantt();
    fireEvent.click(await findByTestId("baselines-disclosure"));
    await findByText("Original plan");
    await findByText("Baseline test");
    await findByText("01 Sep 2026");
    // b2 carries one snapshot, b1 none -- both counts are read from the real
    // comparison endpoint, not guessed.
    await waitFor(async () => expect((await findByTestId("baselines-disclosure")).getAttribute("aria-expanded")).toBe("true"));
    await findByText("1 activities");
    await findByText("0 activities");
  });

  test("the disclosure header counts the baselines", async () => {
    const { findByTestId } = renderGantt();
    const disclosure = await findByTestId("baselines-disclosure");
    await waitFor(() => expect(disclosure.textContent).toContain("Baselines (2)"));
  });
});

describe("the footer callback must not drive a fetch loop", () => {
  // REGRESSION. The first version of this component put `onMessage` in the
  // dependency array of the baseline loader's useCallback. A parent writing the
  // natural `onMessage={(m) => push(m, "baseline")}` hands a NEW function on
  // every render, so every message changed the callback, which re-ran the
  // loader effect, which fetched again and set another message -- unbounded.
  test("an inline arrow parent does not cause repeated fetches", async () => {
    let ganttCalls = 0;
    let baselineCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/schedule/gantt")) {
        ganttCalls += 1;
        return jsonRes({ tasks: TASKS, dependencies: [], milestones: [] });
      }
      if (url.includes("/api/schedule/baselines/")) return jsonRes({ variances: VARIANCES });
      if (url.includes("/api/schedule/baselines")) {
        baselineCalls += 1;
        // Always failing, so the component emits a message every single time --
        // which is precisely the input that used to feed the loop.
        return jsonRes({ error: "baselines unavailable" }, 502);
      }
      if (url.includes("/api/organization")) return jsonRes({ organization: { id: "o1" }, role: "pm" });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const { findByText } = render(
      <ScheduleGanttClient
        projectId="proj-cedar"
        registryColumns={null}
        titleFilter=""
        today="2026-09-02"
        onMessage={(m) => { void m; }}
      />
    );
    await findByText("Joinery shop drawings");
    const settled = ganttCalls;
    await new Promise((r) => setTimeout(r, 150));
    expect(ganttCalls).toBe(settled);
    expect(baselineCalls).toBeLessThanOrEqual(2);
  });
});
