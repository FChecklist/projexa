/// <reference types="bun-types" />
// R67 D-79 -- the header trio, rendered.
//
// module-create-routes.test.ts proves the TABLE (every route ships, every tab
// knows its object). This proves the CONTROL: that all three are present in
// the fixed order on every tab, that "+ New" opens the module's whole create
// list with the active tab's own object first, and that choosing one goes to
// the real route carrying the project.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
    replace: () => {},
    refresh: () => {},
    back: () => {},
  }),
  usePathname: () => "/labour",
}));

const { ListHeaderActions } = await import("./ListHeaderActions");

afterEach(() => {
  cleanup();
  pushed.length = 0;
});

function headerButtons(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()
  );
}

describe("the fixed order", () => {
  test("Filter, Export, + New -- in that order, on a Manpower tab", () => {
    const { container } = render(<ListHeaderActions module="labour" tab="roster" projectId="p-cedar" />);
    expect(headerButtons(container)).toEqual(["Filter", "Export", "+ New"]);
  });

  test("the same three, in the same order, on every tab of all three modules", () => {
    // R-229's finding was that the trio appeared in a different order, or not
    // at all, from list to list. Asserted across the nine tabs rather than on
    // one, because "one screen is right" is what the audit already found.
    const tabs: [Parameters<typeof ListHeaderActions>[0]["module"], string][] = [
      ["labour", "roster"],
      ["labour", "attendance"],
      ["materials", "master"],
      ["materials", "receipts"],
      ["materials", "cost-report"],
      ["schedule", "timeline"],
      ["schedule", "board"],
      ["schedule", "sprints"],
      ["schedule", "timesheet"],
    ];
    for (const [module, tab] of tabs) {
      const { container, unmount } = render(<ListHeaderActions module={module} tab={tab} />);
      expect(headerButtons(container)).toEqual(["Filter", "Export", "+ New"]);
      unmount();
    }
  });
});

describe("Filter and Export are disabled with a reason, never hidden", () => {
  test("with no handler, both are present, disabled and carry a real reason", () => {
    const { container } = render(<ListHeaderActions module="materials" tab="master" />);
    const [filter, exportBtn] = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
    expect(filter.disabled).toBe(true);
    expect(filter.getAttribute("title")).toBe("Filtering this list is not built yet");
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.getAttribute("title")).toBe("Exporting this list is not built yet");
  });

  test("a caller's own reason wins over the generic one", () => {
    const { container } = render(
      <ListHeaderActions module="materials" tab="master" exportDisabledReason="No rows to export" />
    );
    const exportBtn = Array.from(container.querySelectorAll("button"))[1] as HTMLButtonElement;
    expect(exportBtn.getAttribute("title")).toBe("No rows to export");
  });

  test("with a handler, the control is live and carries no reason", () => {
    let filtered = 0;
    const { container } = render(
      <ListHeaderActions module="labour" tab="roster" onFilter={() => { filtered += 1; }} />
    );
    const filter = Array.from(container.querySelectorAll("button"))[0] as HTMLButtonElement;
    expect(filter.disabled).toBe(false);
    expect(filter.getAttribute("title")).toBeNull();
    fireEvent.click(filter);
    expect(filtered).toBe(1);
  });
});

describe("+ New opens the module's whole create list", () => {
  test("from the Roster tab it offers Worker and Attendance, Worker first", () => {
    // D-79's acceptance, verbatim: "from /labour (Roster tab) click '+ New'
    // -> menu shows 'Worker' and 'Attendance'".
    const { container, getByLabelText } = render(
      <ListHeaderActions module="labour" tab="roster" projectId="p-cedar" />
    );
    fireEvent.click(getByLabelText("+ New"));

    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent);
    expect(items).toEqual(["Worker", "Attendance"]);
    expect(container).toBeDefined();
  });

  test("from the Attendance tab the SAME two are offered, with Attendance first", () => {
    const { getByLabelText } = render(<ListHeaderActions module="labour" tab="attendance" />);
    fireEvent.click(getByLabelText("+ New"));
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent);
    expect(items).toEqual(["Attendance", "Worker"]);
  });

  test("the Gantt offers Log time without leaving the module -- R-301's own example", () => {
    const { getByLabelText } = render(<ListHeaderActions module="schedule" tab="timeline" />);
    fireEvent.click(getByLabelText("+ New"));
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent);
    expect(items).toEqual(["Task", "Sprint", "Log time"]);
  });

  test("choosing one goes to the real route, carrying the project", () => {
    const { getByLabelText } = render(
      <ListHeaderActions module="labour" tab="roster" projectId="p-cedar" />
    );
    fireEvent.click(getByLabelText("+ New"));
    const attendance = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (n) => n.textContent === "Attendance"
    ) as HTMLElement;
    fireEvent.click(attendance);
    expect(pushed).toEqual(["/labour/attendance/new?projectId=p-cedar"]);
  });

  test("an action with a precondition stays in the menu, states it, and does not navigate", () => {
    const { getByLabelText } = render(
      <ListHeaderActions
        module="labour"
        tab="roster"
        projectId="p-cedar"
        createDisabledReasons={{ Attendance: "Add a worker to the roster first" }}
      />
    );
    fireEvent.click(getByLabelText("+ New"));
    const attendance = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) =>
      (n.textContent ?? "").startsWith("Attendance")
    ) as HTMLElement;
    // The reason is READABLE, not only a hover title -- a disabled control a
    // user cannot get an explanation from is the fault, not the fix.
    expect(attendance.textContent).toContain("Add a worker to the roster first");
    fireEvent.click(attendance);
    expect(pushed).toEqual([]);
  });
});
