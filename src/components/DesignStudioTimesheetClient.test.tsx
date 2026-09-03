/// <reference types="bun-types" />
// R67 D-07 -- the Design Studio timesheet's four honest states.
//
// src/lib/design-studio-timesheet.test.ts asserts the row shape, the day
// grouping and the week filter as pure functions. What only a render can show
// is the property the decision's "four honest states" clause exists for: an
// empty grid must be reachable ONLY from a successful read. This screen is a
// timesheet -- "no time logged" over a failed GET is a statement a designer
// would act on, by re-entering hours they have already entered.
//
// The second thing asserted here is the decision's other half: "the week view
// is a FILTER over the same rows, not a second grid". One table, one column
// set, one row shape -- switching views must not change any of them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/design-studio",
}));

const DesignStudioTimesheetClient = (await import("./DesignStudioTimesheetClient")).default;

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof globalThis.fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

// 2026-09-02 is a Wednesday; its week begins Monday 2026-08-31.
const PROPS = { projectId: "p-cedar", projectName: "Cedar Heights Villa", today: "2026-09-02" };

const ENTRY = {
  id: "te-1",
  issueId: "iss-1",
  hours: "7.5",
  spentOn: "2026-09-01",
  activityType: "Detailing",
  approvalStatus: "approved",
  issue: { id: "iss-1", number: 412, title: "Facade shop drawings" },
};

describe("DesignStudioTimesheetClient", () => {
  test("a failed read shows the failure and NEVER 'no time logged'", async () => {
    stubFetch(500, { error: "Something went wrong upstream." });
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Something went wrong upstream.");
    });
    // Telling a designer they logged no hours, when the read failed, invites
    // them to enter the same hours twice.
    expect(container.textContent).not.toContain("No time logged");
    expect(container.textContent).toContain("Retry");
  });

  test("only a successful, genuinely empty read says no time was logged", async () => {
    stubFetch(200, { entries: [] });
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No time logged");
    });
    // It names the week it is talking about, and what to press.
    expect(container.textContent).toContain("Cedar Heights Villa");
    expect(container.textContent).toContain("Press Log time to add some.");
  });

  test("the grid is Sumeet's exact columns, with status at row level", async () => {
    stubFetch(200, { entries: [ENTRY] });
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Facade shop drawings");
    });

    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Date", "Project", "Category", "Task", "Hours", "Status"]);
    // Category is the entry's OWN activity type -- nothing is invented.
    expect(container.textContent).toContain("Detailing");
    expect(container.textContent).toContain("Approved");
    expect(container.textContent).toContain("7.50");
    expect(container.textContent).toContain("Total: 7.50 hrs");
  });

  test("'rejected' reads as 'Sent back', in the words the user was given", async () => {
    stubFetch(200, { entries: [{ ...ENTRY, approvalStatus: "rejected" }] });
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Sent back");
    });
    expect(container.textContent).not.toContain("rejected");
  });

  test("an entry whose task did not join reads 'Untitled task', never a raw id", async () => {
    stubFetch(200, { entries: [{ ...ENTRY, issue: null }] });
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Untitled task");
    });
    expect(container.textContent).not.toContain("iss-1");
  });

  test("the week view is a FILTER over the same rows -- same table, same columns", async () => {
    // One entry inside the week of 2026-08-31, one well outside it.
    stubFetch(200, {
      entries: [ENTRY, { ...ENTRY, id: "te-2", spentOn: "2026-06-04", issue: { id: "iss-2", number: 88, title: "Concept massing" } }],
    });
    const { container, getByText } = render(<DesignStudioTimesheetClient {...PROPS} />);

    // "This week" is the landing view: the older entry is filtered out.
    await waitFor(() => {
      expect(container.textContent).toContain("Facade shop drawings");
    });
    expect(container.textContent).not.toContain("Concept massing");
    expect(container.textContent).toContain("Total: 7.50 hrs");

    fireEvent.click(getByText("All entries"));

    await waitFor(() => {
      expect(container.textContent).toContain("Concept massing");
    });
    // The same one table with the same six columns -- not a second grid.
    expect(container.querySelectorAll("table")).toHaveLength(1);
    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Date", "Project", "Category", "Task", "Hours", "Status"]);
    expect(container.textContent).toContain("Total: 15.00 hrs");
  });

  test("the loading state is the shared skeleton, not a wordless spinner", () => {
    // Never resolves, so the pane stays in its loading branch.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof globalThis.fetch;
    const { container } = render(<DesignStudioTimesheetClient {...PROPS} />);

    expect(container.querySelector('[data-testid="screen-loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No time logged");
  });
});
