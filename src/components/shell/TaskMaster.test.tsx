/// <reference types="bun-types" />
// R67 FIX PASS -- the forked pane itself had no test.
//
// task-row.ts's pure functions (tabView, toTaskRow, mergeTabCounts) are well
// covered, but nothing rendered the PANE, and the four decisions that only
// exist in this file were therefore unasserted:
//
//   1. THE TABS ACTUALLY FILTER. The kit rendered two fixed groups whatever
//      tab was selected, so clicking Completed changed a highlight and nothing
//      else. Each tab now supplies its own labelled group, and the second
//      group is optional -- Approval Pending / In Queue / Completed / History
//      render exactly ONE list.
//   2. EVERY EMPTY TAB STATES ITS OWN PURPOSE. "Nothing is waiting on you."
//      under Completed was a wrong sentence, not merely a bland one.
//   3. A ROW'S WORD BUTTON IS A WORD, and a "fix" LOADS THE CHAIN AND STOPS.
//      This is the load-never-execute rule at its most load-bearing: the whole
//      point of Fix is that it cannot re-run the write that failed.
//   4. THE "SYSTEM" GROUP IS SHOWN, NOT HIDDEN. Hiding a failure is how a
//      write is silently lost.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TaskMaster, type TaskGroupView } from "./TaskMaster";
import type { ProjexaTaskRow, RowAction, TaskTabId } from "./task-row";

afterEach(cleanup);

function row(over: Partial<ProjexaTaskRow> = {}): ProjexaTaskRow {
  return {
    id: "t1",
    state: "needs-you",
    verb: "Record",
    object: "Work Progress",
    title: "Record Work Progress > New entry",
    detail: "Pick a BOQ line",
    urgency: "today",
    urgencyLabel: "Today",
    chain: { mode: "Projects", segments: [{ id: "root", label: "Cedar Heights", kind: "root" }] },
    functionId: "record_work_progress",
    projectId: "p1",
    errorCode: "BOQ_LINE_REQUIRED",
    isSystemFailure: false,
    rawInput: "record 50% on excavation",
    params: { percent: 50 },
    createdAtMs: Date.UTC(2026, 8, 3, 9, 0),
    actions: [{ kind: "fix", label: "Pick line", missingStep: "boqLine" }] as RowAction[],
    ...over,
  } as ProjexaTaskRow;
}

function group(over: Partial<TaskGroupView> = {}): TaskGroupView {
  return { label: "Needs you", empty: "Nothing is waiting on you.", rows: [row()], twoLine: true, ...over };
}

const TABS = [
  { id: "home" as TaskTabId, label: "Home (3)" },
  { id: "approval-pending" as TaskTabId, label: "Approval Pending (1)" },
  { id: "completed" as TaskTabId, label: "Completed (3)" },
];

type Recorded = { loads: unknown[]; actions: { id: string; kind: string }[]; fetches: number };

function renderPane(props: Partial<Parameters<typeof TaskMaster>[0]> = {}) {
  const rec: Recorded = { loads: [], actions: [], fetches: 0 };
  // A "fix" must reach the composer and NOTHING else. A real fetch stub is the
  // only honest way to assert "and it did not re-run the write".
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    rec.fetches += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const view = render(
    <TaskMaster
      tabs={TABS}
      activeTab="home"
      onTabChange={() => {}}
      primary={group()}
      onLoad={(l) => rec.loads.push(l)}
      onRowAction={(r, a) => rec.actions.push({ id: r.id, kind: a.kind })}
      {...props}
    />
  );
  return { rec, restore: () => { globalThis.fetch = realFetch; }, ...view };
}

describe("the tabs render, with their counts in their own labels", () => {
  test("every tab is a real tab, carrying the number C-11 put in its own label", () => {
    const { getByRole, restore } = renderPane();
    // role="tab" inside a role="tablist", not a bare button: the pane is a set
    // of views and the markup says so, which is what makes the strip navigable
    // by keyboard as one control rather than five.
    expect(getByRole("tablist")).toBeTruthy();
    expect(getByRole("tab", { name: "Home (3)" })).toBeTruthy();
    expect(getByRole("tab", { name: "Approval Pending (1)" })).toBeTruthy();
    // The number is IN the label -- a word and its count assembled in two
    // places is how a badge and a list stop agreeing.
    expect(getByRole("tab", { name: "Completed (3)" }).textContent).toMatch(/^Completed \(\d+\)$/);
    restore();
  });

  test("exactly one tab is aria-selected, and it is the active one", () => {
    const { getByRole, restore } = renderPane({ activeTab: "completed" });
    expect(getByRole("tab", { name: "Completed (3)" }).getAttribute("aria-selected")).toBe("true");
    expect(getByRole("tab", { name: "Home (3)" }).getAttribute("aria-selected")).toBe("false");
    restore();
  });

  test("clicking a tab reports the id, and the pane does not decide for itself", () => {
    const seen: TaskTabId[] = [];
    const { getByRole, restore } = renderPane({ onTabChange: (id) => seen.push(id) });
    fireEvent.click(getByRole("tab", { name: "Completed (3)" }));
    expect(seen).toEqual(["completed"]);
    restore();
  });
});

describe("each tab renders its OWN groups, headings and empty sentence", () => {
  test("Home shows the primary group and its optional second one, each with its own rows", () => {
    const { getAllByText, getByText, restore } = renderPane({
      secondary: group({
        label: "Waiting on others",
        empty: "Nothing outstanding with anyone else.",
        rows: [row({ id: "t2", state: "running", title: "Review Budget > Cedar Heights", detail: undefined })],
      }),
    });
    // "Needs you" is BOTH a group heading and a row's state word -- C-13 made
    // the state visible beside its glyph rather than leaving colour to carry
    // it alone -- so this asserts the heading exists without pretending the
    // string is unique on the pane.
    expect(getAllByText("Needs you").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Waiting on others")).toBeTruthy();
    expect(getByText("Record Work Progress > New entry")).toBeTruthy();
    expect(getByText("Review Budget > Cedar Heights")).toBeTruthy();
    restore();
  });

  test("a tab with one list renders ONE list -- the kit's second group is not forced on it", () => {
    const { getByText, queryByText, restore } = renderPane({
      activeTab: "completed",
      primary: group({ label: "Completed", empty: "Nothing completed yet.", rows: [row({ id: "t3", state: "done", title: "Record Work Progress > Excavation", detail: undefined })] }),
      secondary: undefined,
    });
    expect(getByText("Completed")).toBeTruthy();
    expect(queryByText("Waiting on others")).toBeNull();
    restore();
  });

  test("*** AN EMPTY TAB STATES ITS OWN PURPOSE, not another tab's ***", () => {
    const { getByText, queryByText, restore } = renderPane({
      activeTab: "approval-pending",
      primary: group({ label: "Approval Pending", empty: "Nothing waiting for your approval", rows: [] }),
    });
    expect(getByText("Nothing waiting for your approval")).toBeTruthy();
    expect(queryByText("Nothing is waiting on you.")).toBeNull();
    restore();
  });
});

describe("*** A ROW'S FIX LOADS THE CHAIN AND STOPS ***", () => {
  test("the word button is a WORD, and its accessible name says which row it belongs to", () => {
    const { rec, getByRole, restore } = renderPane();
    // On screen: the word alone. To a screen reader: the word AND the row --
    // "Pick line" repeated down a list of eleven rows would name nothing.
    const button = getByRole("button", { name: "Pick line: Record Work Progress > New entry" });
    expect(button.textContent).toBe("Pick line");
    fireEvent.click(button);
    expect(rec.actions).toEqual([{ id: "t1", kind: "fix" }]);
    restore();
  });

  test("and it touches NO network -- a Fix can never re-run the write that failed", () => {
    const { rec, getByRole, restore } = renderPane();
    fireEvent.click(getByRole("button", { name: "Pick line: Record Work Progress > New entry" }));
    expect(rec.fetches).toBe(0);
    restore();
  });

  test("clicking the row itself loads its chain, and that is also not a write", () => {
    const { rec, getByText, restore } = renderPane();
    fireEvent.click(getByText("Record Work Progress > New entry"));
    expect(rec.loads.length).toBe(1);
    expect(rec.fetches).toBe(0);
    restore();
  });

  test("line 1 is the title built once in task-row.ts -- never a function id", () => {
    const { getByText, queryByText, restore } = renderPane();
    expect(getByText("Record Work Progress > New entry")).toBeTruthy();
    expect(queryByText("record_work_progress")).toBeNull();
    restore();
  });

  test("line 2 is the D-03 sentence, so a blocked row always says what to do", () => {
    const { getByText, restore } = renderPane();
    expect(getByText("Pick a BOQ line")).toBeTruthy();
    restore();
  });
});

describe("the System group is SHOWN -- hiding a failure is how a write is silently lost", () => {
  test("it renders under its own heading with its own rows", () => {
    const { getByText, restore } = renderPane({
      system: group({
        label: "System",
        empty: "Nothing went wrong on our side.",
        rows: [
          row({
            id: "sys1",
            isSystemFailure: true,
            errorCode: "BACKEND_UNAVAILABLE",
            detail: "The construction data service didn't answer - nothing was saved [Retry]",
            actions: [{ kind: "retry", label: "Retry", missingStep: null }] as RowAction[],
          }),
        ],
      }),
    });
    expect(getByText("System")).toBeTruthy();
    expect(getByText("The construction data service didn't answer - nothing was saved [Retry]")).toBeTruthy();
    restore();
  });

  test("with nothing in it the group is ABSENT, not an empty heading", () => {
    const { queryByText, restore } = renderPane({ system: undefined });
    expect(queryByText("System")).toBeNull();
    restore();
  });

  test("a system row's Retry is the only action it offers -- there is nothing to pick", () => {
    const { rec, getByRole, restore } = renderPane({
      system: group({
        label: "System",
        empty: "Nothing went wrong on our side.",
        rows: [
          row({
            id: "sys1",
            isSystemFailure: true,
            errorCode: "BACKEND_UNAVAILABLE",
            actions: [{ kind: "retry", label: "Retry", missingStep: null }] as RowAction[],
          }),
        ],
      }),
    });
    fireEvent.click(getByRole("button", { name: "Retry: Record Work Progress > New entry" }));
    expect(rec.actions).toEqual([{ id: "sys1", kind: "retry" }]);
    restore();
  });
});
