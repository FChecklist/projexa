import { describe, expect, test } from "bun:test";
import {
  FUNCTION_DISPLAY_NAMES,
  TAB_STATUS_QUERY,
  TASK_TAB_IDS,
  assertNoUnderscore,
  countedTabLabel,
  humaniseFunctionId,
  homeServerCount,
  mergeTabCounts,
  objectFor,
  objectIdLabel,
  objectRouteFor,
  pageNote,
  startOfDay,
  tabView,
  toTaskRow,
  verbFor,
  type ApiTask,
  type GroupedRows,
  type ProjexaTaskRow,
  type TaskTabId,
} from "./task-row";

const NOW = Date.parse("2026-09-02T14:00:00.000Z");
const line1 = (r: ProjexaTaskRow) => `${r.verb} ${r.object}`;

function task(overrides: Partial<ApiTask> = {}): ApiTask {
  return { id: "t1", ...overrides };
}

describe("line 1 is a verb plus a human object, never a function id", () => {
  test("the registry names the object", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", errorCode: "BOQ_LINE_REQUIRED" }), "blocked", {
      now: NOW,
    });
    expect(line1(row)).toBe("Record Work Progress > New entry");
    expect(row.detail).toBe("Pick a BOQ line");
    expect(row.object).not.toContain("_");
  });

  test("the two rows the R66 walkthrough captured stop reading as ids", () => {
    const progress = toTaskRow(task({ functionId: "record_work_progress" }), "needsYou", { now: NOW });
    const dashboard = toTaskRow(task({ functionId: "get_construction_project_dashboard" }), "needsYou", { now: NOW });
    expect(line1(progress)).not.toBe("Record record_work_progress");
    expect(line1(dashboard)).not.toBe("Review get_construction_project_dashboard");
    expect(line1(dashboard)).toBe("Review Dashboard");
  });

  test("an unregistered function id becomes words, never the id", () => {
    const row = toTaskRow(task({ functionId: "create_site_instruction" }), "needsYou", { now: NOW });
    expect(row.object).toBe("Site Instruction");
    expect(row.object).not.toContain("_");
    expect(humaniseFunctionId("record_work_progress")).toBe("Work Progress");
    expect(humaniseFunctionId("get_construction_budget_status")).toBe("Budget Status");
  });

  test("no function id at all still yields a readable object", () => {
    expect(objectFor({ functionId: null, derivedChain: null })).toBe("Task");
    expect(objectFor({ functionId: null, derivedChain: { steps: ["Scope", "Import BOQ"] } })).toBe(
      "Scope > Import BOQ"
    );
  });

  test("the verb stays inside M24's closed set", () => {
    expect(verbFor("record_work_progress")).toBe("Record");
    expect(verbFor("import_boq")).toBe("Import");
    expect(verbFor("approve_variation")).toBe("Approve");
    expect(verbFor("sign_off_rfi")).toBe("Sign off");
    expect(verbFor("confirm_delivery")).toBe("Confirm");
    expect(verbFor(null)).toBe("Review");
  });
});

describe("line 2 is a D-03 sentence, never the backend's own words", () => {
  test("the CONNECT_TIMEOUT row loses its IP and its port", () => {
    const row = toTaskRow(
      task({ functionId: "list_leads", legacyError: "write CONNECT_TIMEOUT 3.109.171.244:6543" }),
      "blocked",
      { now: NOW }
    );
    expect(row.detail).toBe("The construction data service didn't answer — nothing was saved");
    expect(row.detail).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
    expect(row.errorCode).toBe("BACKEND_UNAVAILABLE");
    expect(row.actions[0]).toEqual({ kind: "retry", label: "Retry", missingStep: null });
  });

  test("a camelCase parameter name never reaches the row", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", legacyError: "itemCode is required" }), "blocked", {
      now: NOW,
    });
    expect(row.detail).toBe("Pick a BOQ line");
    expect(row.detail).not.toContain("itemCode");
    expect(row.actions[0].label).toBe("Pick line");
    expect(row.actions[0].missingStep).toBe("boqLine");
  });

  test("the server's own code and the row's item code build the full sentence", () => {
    const row = toTaskRow(
      task({
        functionId: "record_work_progress",
        errorCode: "BOQ_LINE_NOT_FOUND",
        params: { itemCode: "1.02" },
      }),
      "blocked",
      { now: NOW, projectName: "Cedar Heights Villa - Phase 1" }
    );
    expect(row.detail).toBe("There is no line 1.02 on Cedar Heights Villa - Phase 1 — pick a line");
  });

  test("a healthy row shows the user's own words, masked", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", rawInput: "PP1 is 50% done" }), "done", {
      now: NOW,
    });
    expect(row.detail).toBe("PP1 is 50% done");
    expect(row.errorCode).toBeNull();
    // R67 C-11: a done row carries exactly ONE action, and it is a read --
    // "View", opening the object it produced. No fix, no retry: there is
    // nothing wrong with it.
    expect(row.actions.map((a) => a.kind)).toEqual(["open"]);
  });

  test("a pasted stack trace in the user's own words is masked too", () => {
    const row = toTaskRow(task({ rawInput: "it said ECONNREFUSED 10.0.0.1:5432" }), "needsYou", { now: NOW });
    expect(row.detail).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
    expect(row.detail).not.toContain("ECONNREFUSED");
  });

  // R67 FIX PASS (governance decision #1a/#1b/#1d) -- the real GET route
  // sends the composed `failure` object (never `error`), plus safe legacy
  // prose as `legacyError` for a row that predates it. These assert against
  // that real shape, not the pre-fix-pass flat `errorCode`/`error` reading.
  test("the server's composed `failure` object is read, not a flat errorCode alone", () => {
    const row = toTaskRow(
      task({
        functionId: "record_work_progress",
        errorCode: "BOQ_LINE_NOT_FOUND", // the raw column, sent alongside `failure`
        failure: { code: "BOQ_LINE_NOT_FOUND", missing: ["itemCode"], context: { itemCode: "1.02", project: "Cedar Heights Villa - Phase 1" } },
      }),
      "blocked",
      { now: NOW }
    );
    // The `failure.context` values fill the sentence even with no `params`
    // and no `ctx.projectName` at all -- proving `failure` is read directly,
    // not merely tolerated alongside the flat fields the old shape had.
    expect(row.detail).toBe("There is no line 1.02 on Cedar Heights Villa - Phase 1 — pick a line");
    expect(row.errorCode).toBe("BOQ_LINE_NOT_FOUND");
  });

  test("a legacy row whose stored English matches a known pattern still reads as English", () => {
    const row = toTaskRow(task({ legacyError: "no project resolved for this task" }), "blocked", { now: NOW });
    expect(row.detail).toBe("Pick a project");
    expect(row.actions[0].label).toBe("Choose project");
  });

  test("a legacy row nothing recognises falls back to LEGACY_FALLBACK_MESSAGE, not resolveTaskError's generic UNKNOWN text", () => {
    const row = toTaskRow(task({ legacyError: "the printer is out of toner" }), "blocked", { now: NOW });
    expect(row.detail).toBe("This task needs your input - [Fix]");
    expect(row.detail).not.toBe("Something went wrong");
    // UNKNOWN's own action still stands: retrying an old, unclassified row
    // remains a real and safe next step.
    expect(row.actions[0]).toEqual({ kind: "retry", label: "Retry", missingStep: null });
  });

  test("a row with neither failure nor legacyError is not treated as failed", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", rawInput: "excavation 50%" }), "needsYou", {
      now: NOW,
    });
    expect(row.detail).toBe("excavation 50%");
    expect(row.errorCode).toBeNull();
  });
});

describe("R67 FIX PASS -- the object falls back to the server's own label", () => {
  test("an unregistered function id prefers the server's label over local guesswork", () => {
    expect(objectFor({ functionId: "some_future_function", derivedChain: null, label: "Reconcile Advances" })).toBe(
      "Reconcile Advances"
    );
  });

  test("a registered function id still wins over the server's label", () => {
    expect(
      objectFor({ functionId: "record_work_progress", derivedChain: null, label: "Progress" })
    ).toBe("Work Progress > New entry");
  });

  test("no label at all still falls back to humanised words, never the id", () => {
    expect(objectFor({ functionId: "list_future_widgets", derivedChain: null, label: null })).toBe("Future Widgets");
    expect(humaniseFunctionId("list_future_widgets")).toBe("Future Widgets");
  });
});

describe("Dismiss appears only on a blocked row older than 24 h", () => {
  const blocked = (createdAt: string) =>
    toTaskRow(task({ functionId: "record_work_progress", legacyError: "itemCode is required", createdAt }), "blocked", {
      now: NOW,
    });

  test("a fresh blocked row has no Dismiss", () => {
    const row = blocked("2026-09-02T10:00:00.000Z");
    expect(row.actions.map((a) => a.kind)).toEqual(["fix"]);
  });

  test("a blocked row from two days ago offers Dismiss beside its Fix", () => {
    const row = blocked("2026-08-31T10:00:00.000Z");
    expect(row.actions.map((a) => a.kind)).toEqual(["fix", "dismiss"]);
    expect(row.actions[1].label).toBe("Dismiss");
  });

  test("a row with no timestamp is never dismissed by guesswork", () => {
    const row = toTaskRow(task({ legacyError: "itemCode is required" }), "blocked", { now: NOW });
    expect(row.actions.map((a) => a.kind)).toEqual(["fix"]);
    expect(row.createdAtMs).toBeNull();
  });
});

describe("the tabs actually filter, and each count comes from its own array", () => {
  const rows = (ids: string[], group: Parameters<typeof toTaskRow>[1], createdAt?: string): ProjexaTaskRow[] =>
    ids.map((id) => toTaskRow(task({ id, functionId: "record_work_progress", createdAt }), group, { now: NOW }));

  const groups: GroupedRows = {
    blocked: rows(["b1"], "blocked", "2026-09-02T09:00:00.000Z"),
    needsYou: rows(["n1", "n2"], "needsYou"),
    running: rows(["r1"], "running"),
    done: [
      ...rows(["d-today"], "done", "2026-09-02T08:00:00.000Z"),
      ...rows(["d-old"], "done", "2026-08-20T08:00:00.000Z"),
    ],
  };

  test("Approval Pending is the blocked and needs-you rows only", () => {
    const view = tabView(groups, "approval-pending", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["b1", "n1", "n2"]);
    expect(view.count).toBe(view.primary.length);
    expect(view.secondary).toBeUndefined();
  });

  test("In Queue is the running rows only -- a blocked row is hidden", () => {
    const view = tabView(groups, "in-queue", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["r1"]);
    expect(view.primary.some((r) => r.id === "b1")).toBe(false);
    expect(view.count).toBe(1);
  });

  test("Completed is the done rows, and hides the blocked row", () => {
    const view = tabView(groups, "completed", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["d-today", "d-old"]);
    expect(view.primary.some((r) => r.id === "b1")).toBe(false);
    expect(view.count).toBe(2);
  });

  // R67 C-13 narrowed this from C-01's "before today" to "older than 7 days":
  // with the earlier rule History and Completed showed nearly the same rows
  // the day after any work happened. d-today (2 Sep) and d-old (20 Aug) sit
  // either side of the new boundary.
  test("History is what finished more than a week ago", () => {
    const view = tabView(groups, "history", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["d-old"]);
    expect(view.count).toBe(1);
  });

  test("History is grouped by day, newest day first", () => {
    const view = tabView(groups, "history", NOW);
    expect(view.dayGroups).toHaveLength(1);
    expect(view.dayGroups?.[0].label).toBe("20 Aug 2026");
    expect(view.dayGroups?.[0].rows.map((r) => r.id)).toEqual(["d-old"]);
    // Every row in the flat list is in exactly one day group -- a grouping
    // that quietly drops a row is worse than no grouping.
    const grouped = (view.dayGroups ?? []).flatMap((d) => d.rows.map((r) => r.id));
    expect(grouped.sort()).toEqual(view.primary.map((r) => r.id).sort());
  });

  test("only History is grouped by day", () => {
    for (const tab of ["home", "approval-pending", "in-queue", "completed"] as const) {
      expect(tabView(groups, tab, NOW).dayGroups).toBeUndefined();
    }
  });

  test("Home keeps M24's two groups and counts both", () => {
    const view = tabView(groups, "home", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["b1", "n1", "n2"]);
    expect(view.secondary?.map((r) => r.id)).toEqual(["r1", "d-today", "d-old"]);
    expect(view.count).toBe(6);
  });

  test("every tab states its own purpose when it is empty", () => {
    const empty: GroupedRows = { blocked: [], needsYou: [], running: [], done: [] };
    expect(tabView(empty, "approval-pending", NOW).primaryEmpty).toBe("Nothing waiting for your approval");
    expect(tabView(empty, "in-queue", NOW).primaryEmpty).toBe("Nothing is running right now");
    expect(tabView(empty, "completed", NOW).primaryEmpty).toBe("Nothing has finished yet");
    expect(tabView(empty, "history", NOW).primaryEmpty).toBe("Nothing finished more than a week ago");
    expect(tabView(empty, "home", NOW).primaryEmpty).toBe("Nothing is waiting on you.");
    const messages = new Set(
      (["approval-pending", "in-queue", "completed", "history", "home"] as const).map(
        (t) => tabView(empty, t, NOW).primaryEmpty
      )
    );
    expect(messages.size).toBe(5);
  });

  test("startOfDay is local midnight, not now minus 24 h", () => {
    const midnight = startOfDay(NOW);
    expect(midnight).toBeLessThanOrEqual(NOW);
    expect(new Date(midnight).getHours()).toBe(0);
    expect(new Date(midnight).getMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R67 C-10 -- THE TITLE, AND THE SYSTEM GROUP
// ---------------------------------------------------------------------------

describe("C-10's acceptance, verbatim", () => {
  test("toTaskRow builds line 1 as one title, with the D-03 sentence beneath it", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", errorCode: "BOQ_LINE_REQUIRED" }), "blocked", {
      now: NOW,
    });
    expect(row.title).toBe("Record Work Progress > New entry");
    expect(row.detail).toBe("Pick a BOQ line");
    // The defect this replaces rendered "Record record_work_progress".
    expect(row.title).not.toContain("_");
  });

  test("every title in the display registry survives the no-underscore guard", () => {
    for (const functionId of Object.keys(FUNCTION_DISPLAY_NAMES)) {
      const row = toTaskRow(task({ functionId }), "needsYou", { now: NOW });
      expect(row.title).not.toContain("_");
      expect(row.title.startsWith(row.verb)).toBe(true);
    }
  });

  test("a function id nobody registered still reaches a title with no underscore", () => {
    const row = toTaskRow(task({ functionId: "record_some_brand_new_thing" }), "needsYou", { now: NOW });
    expect(row.title).toBe("Record Some Brand New Thing");
    expect(row.title).not.toContain("_");
  });

  test("a derived chain carrying an underscore is repaired, not rendered raw", () => {
    // assertNoUnderscore is the last line of defence: the object can come from
    // a chain step the backend wrote, and that is not a string this repo
    // controls.
    const row = toTaskRow(
      task({ functionId: "nothing_registered", derivedChain: { steps: ["work_progress", "new_entry"] } }),
      "needsYou",
      { now: NOW }
    );
    expect(row.title).not.toContain("_");
  });
});

describe("assertNoUnderscore", () => {
  test("repairs rather than throws -- a list renderer must not die over a title", () => {
    expect(assertNoUnderscore("record_work_progress")).toBe("record work progress");
    expect(assertNoUnderscore("Work Progress > New entry")).toBe("Work Progress > New entry");
    expect(assertNoUnderscore("a__b")).toBe("a b");
  });
});

describe("a failure nobody on site can fix leaves the needs-you list", () => {
  const infra = (id: string, code: string) =>
    toTaskRow(task({ id, functionId: "list_leads", errorCode: code }), "blocked", { now: NOW });

  test("every one of the server's own infra code names is a system failure, off the needs-you list", () => {
    // R67 MERGE (D-11): UPSTREAM_TIMEOUT is now a first-class code with its
    // own, more precise sentence ("took too long", not "didn't answer") --
    // see task-errors.ts's own merge note. POOL_TIMEOUT and INFRA_UNAVAILABLE
    // have no code of their own and still alias to BACKEND_UNAVAILABLE. The
    // guarantee this describe block is named for -- none of the four is ever
    // something a site engineer can act on -- holds for all four either way.
    for (const code of ["BACKEND_UNAVAILABLE", "UPSTREAM_TIMEOUT", "POOL_TIMEOUT", "INFRA_UNAVAILABLE"]) {
      const row = infra("t-" + code, code);
      expect(["BACKEND_UNAVAILABLE", "UPSTREAM_TIMEOUT"]).toContain(row.errorCode);
      expect(row.isSystemFailure).toBe(true);
      expect(row.detail).toMatch(/^The construction data service (didn't answer|took too long) — nothing was saved$/);
      expect(row.actions[0].label).toBe("Retry");
    }
  });

  test("a slot the user CAN fill is not a system failure", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", errorCode: "BOQ_LINE_REQUIRED" }), "blocked", {
      now: NOW,
    });
    expect(row.isSystemFailure).toBe(false);
  });

  test("the Home badge counts only what a person can act on, and still SHOWS the rest", () => {
    const groups: GroupedRows = {
      blocked: [
        infra("t-infra", "UPSTREAM_TIMEOUT"),
        toTaskRow(task({ id: "t-fix", functionId: "record_work_progress", errorCode: "BOQ_LINE_REQUIRED" }), "blocked", {
          now: NOW,
        }),
      ],
      needsYou: [],
      running: [],
      done: [],
    };
    const home = tabView(groups, "home", NOW);
    expect(home.primary.map((r) => r.id)).toEqual(["t-fix"]);
    expect(home.count).toBe(1);
    // SHOWN, never hidden: a failure nobody sees is a write silently lost.
    expect(home.system?.map((r) => r.id)).toEqual(["t-infra"]);
    expect(home.systemLabel).toBe("System");
  });

  test("Approval Pending applies the same split, so the two tabs cannot disagree", () => {
    const groups: GroupedRows = {
      blocked: [infra("t-infra", "BACKEND_UNAVAILABLE")],
      needsYou: [toTaskRow(task({ id: "t-fix", functionId: "record_work_progress" }), "needsYou", { now: NOW })],
      running: [],
      done: [],
    };
    const approval = tabView(groups, "approval-pending", NOW);
    expect(approval.count).toBe(1);
    expect(approval.primary.map((r) => r.id)).toEqual(["t-fix"]);
    expect(approval.system?.map((r) => r.id)).toEqual(["t-infra"]);
  });

  test("with no system failures the group is absent entirely, not an empty heading", () => {
    const groups: GroupedRows = { blocked: [], needsYou: [], running: [], done: [] };
    expect(tabView(groups, "home", NOW).system).toBeUndefined();
    expect(tabView(groups, "home", NOW).systemLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R67 C-11 -- the tabs ask the server for their own rows, and the number on a
// tab says where it came from.
// ---------------------------------------------------------------------------

describe("TAB_STATUS_QUERY -- what each tab asks for", () => {
  test("Home asks for everything; every other tab names a filter", () => {
    expect(TAB_STATUS_QUERY.home).toBeNull();
    expect(TAB_STATUS_QUERY["approval-pending"]).toBe("approval");
    expect(TAB_STATUS_QUERY["in-queue"]).toBe("queued");
    expect(TAB_STATUS_QUERY.completed).toBe("done");
  });

  test("History asks for the same rows as Completed -- its 7-day rule is local", () => {
    expect(TAB_STATUS_QUERY.history).toBe(TAB_STATUS_QUERY.completed);
  });

  test("every tab id has an entry, so a new tab cannot silently fetch nothing", () => {
    for (const id of TASK_TAB_IDS) expect(id in TAB_STATUS_QUERY).toBe(true);
  });
});

describe("countedTabLabel -- the count is IN the label", () => {
  test("prints the number the acceptance looks for", () => {
    expect(countedTabLabel("Completed", 3)).toBe("Completed (3)");
    expect(countedTabLabel("Completed", 3)).toMatch(/^Completed \(\d+\)$/);
  });

  test("zero is a real answer and is printed", () => {
    expect(countedTabLabel("In Queue", 0)).toBe("In Queue (0)");
  });

  test("an unknown count prints no number rather than a wrong one", () => {
    expect(countedTabLabel("History", undefined)).toBe("History");
    expect(countedTabLabel("History", Number.NaN)).toBe("History");
  });
});

describe("mergeTabCounts -- which source each tab's number comes from", () => {
  const views = {
    home: { count: 6 },
    "approval-pending": { count: 2 },
    "in-queue": { count: 1 },
    completed: { count: 3 },
    history: { count: 1 },
  } as Record<TaskTabId, { count: number }>;
  const serverTabs = { needs_you: 40, waiting: 0, approval: 40, queued: 9, done: 120 };

  test("the tab you are looking at counts the rows in front of you", () => {
    const counts = mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "completed", truncated: false });
    expect(counts.completed).toBe(3);
  });

  test("a tab whose rows are not loaded takes the server's number", () => {
    const counts = mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "completed", truncated: false });
    expect(counts["approval-pending"]).toBe(40);
    expect(counts["in-queue"]).toBe(9);
    // Home is NOT serverTotal -- see the describe below for why.
    expect(counts.home).toBe(homeServerCount(serverTabs));
  });

  test("a truncated page hands the active tab back to the server's total", () => {
    const counts = mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "completed", truncated: true });
    expect(counts.completed).toBe(120);
  });

  test("History prints a number only while the done rows it is derived from are loaded", () => {
    expect(
      mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "completed", truncated: false }).history
    ).toBe(1);
    expect(
      mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "home", truncated: false }).history
    ).toBe(1);
    expect(
      mergeTabCounts({ views, serverTabs, serverTotal: 169, activeTab: "in-queue", truncated: false }).history
    ).toBeUndefined();
  });

  test("with no server payload at all the active tab still has its own number", () => {
    const counts = mergeTabCounts({ views, serverTabs: null, serverTotal: null, activeTab: "in-queue", truncated: false });
    expect(counts["in-queue"]).toBe(1);
    expect(counts.completed).toBeUndefined();
    expect(counts.home).toBeUndefined();
  });
});

// *** FIX PASS -- HOME'S NUMBER MEANT TWO DIFFERENT THINGS. ***
//
// Untruncated, Home printed views.home.count -- needsYou with SYSTEM FAILURES
// EXCLUDED, plus running, plus done. Truncated, it fell back to the server's
// grand total over the whole scope, which INCLUDES them. So the badge jumped by
// exactly the number of system failures the moment an org crossed the 50-row
// page limit: the same silent change of meaning C-11 was raised to remove.
describe("homeServerCount -- Home's server number is defined like its rendered one", () => {
  test("it is needs-you minus the outages, plus the queue and the completed", () => {
    // 40 needs-you of which 4 are infrastructure, 9 queued, 120 done.
    expect(homeServerCount({ needs_you: 40, queued: 9, done: 120, systemBlocked: 4 })).toBe(165);
  });

  test("*** IT IS NEVER THE GRAND TOTAL ***", () => {
    const homeViews = {
      home: { count: 6 },
      "approval-pending": { count: 2 },
      "in-queue": { count: 1 },
      completed: { count: 3 },
      history: { count: 1 },
    } as Record<TaskTabId, { count: number }>;
    const serverTabs = { needs_you: 40, waiting: 0, approval: 40, queued: 9, done: 120, systemBlocked: 4 };
    const truncatedHome = mergeTabCounts({
      views: homeViews,
      serverTabs,
      serverTotal: 169,
      activeTab: "home",
      truncated: true,
    });
    // 169 is the grand total and would have been printed here before the fix.
    expect(truncatedHome.home).toBe(165);
    expect(truncatedHome.home).not.toBe(169);
  });

  test("with no system failures the two definitions agree exactly", () => {
    expect(homeServerCount({ needs_you: 40, queued: 9, done: 120, systemBlocked: 0 })).toBe(169);
    // An absent systemBlocked is zero, not a reason to bail out.
    expect(homeServerCount({ needs_you: 40, queued: 9, done: 120 })).toBe(169);
  });

  test("a missing piece yields NO number rather than a guessed one", () => {
    expect(homeServerCount(null)).toBeUndefined();
    expect(homeServerCount({ needs_you: 40, queued: 9 })).toBeUndefined();
    expect(homeServerCount({ queued: 9, done: 120 })).toBeUndefined();
  });

  test("it never goes negative, whatever the two grouped reads disagree about", () => {
    expect(homeServerCount({ needs_you: 2, queued: 0, done: 0, systemBlocked: 5 })).toBe(0);
  });
});

describe("pageNote -- a page is not a list, and it says so", () => {
  test("nothing is said when the page IS the list", () => {
    expect(pageNote(12, 12, false)).toBeNull();
  });

  test("the sentence names both numbers", () => {
    expect(pageNote(50, 120, true)).toBe("Showing the newest 50 of 120.");
  });

  test("an unknown total still admits the list is partial", () => {
    expect(pageNote(50, null, true)).toBe("Showing the newest 50.");
  });
});

describe("a done row can be opened", () => {
  test("the object route carries the project", () => {
    expect(objectRouteFor("record_work_progress", "p1")).toBe("/work-progress?projectId=p1");
    expect(objectRouteFor("record_work_progress", null)).toBe("/work-progress");
  });

  test("a function with nowhere to go gets no link rather than a guessed one", () => {
    expect(objectRouteFor("list_notices", "p1")).toBeNull();
    expect(objectRouteFor(null, "p1")).toBeNull();
  });

  test("a done row carries a View action and a route", () => {
    const row = toTaskRow(
      task({ id: "d1", functionId: "record_work_progress", projectId: "p1", result: { number: 412 } }),
      "done",
      { now: NOW }
    );
    expect(row.route).toBe("/work-progress?projectId=p1");
    const open = row.actions.find((a) => a.kind === "open");
    expect(open?.label).toBe("View #412");
    expect(open?.href).toBe("/work-progress?projectId=p1");
  });

  test("a 25-character cuid is never printed on the button", () => {
    const row = toTaskRow(
      task({ id: "d2", functionId: "record_work_progress", projectId: "p1", result: { id: "cm3x8k2p90001qz7h3f2l9d4e" } }),
      "done",
      { now: NOW }
    );
    expect(row.actions.find((a) => a.kind === "open")?.label).toBe("View");
  });

  test("a pending row is not openable -- there is nothing there yet", () => {
    const row = toTaskRow(task({ id: "n9", functionId: "record_work_progress", projectId: "p1" }), "needsYou", {
      now: NOW,
    });
    expect(row.route).toBeUndefined();
    expect(row.actions.some((a) => a.kind === "open")).toBe(false);
  });

  test("objectIdLabel prefers a human code over a key", () => {
    expect(objectIdLabel({ number: 12 })).toBe("#12");
    expect(objectIdLabel({ code: "WP-0412" })).toBe("WP-0412");
    expect(objectIdLabel({})).toBeNull();
    expect(objectIdLabel(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R67 C-13 -- system failures leave the needs-you list; a gap gets a screen.
// ---------------------------------------------------------------------------

describe("the server states whether a failure is anyone's to fix", () => {
  test("the server's own flag is honoured even when the code is unknown here", () => {
    const row = toTaskRow(
      task({ id: "s1", functionId: "list_leads", errorCode: "SOMETHING_NEW", systemFailure: true }),
      "blocked",
      { now: NOW }
    );
    expect(row.isSystemFailure).toBe(true);
  });

  test("a row written before C-13 is still classified from its code", () => {
    const row = toTaskRow(
      task({ id: "s2", functionId: "list_leads", legacyError: "write CONNECT_TIMEOUT 3.109.171.244:6543" }),
      "blocked",
      { now: NOW }
    );
    expect(row.isSystemFailure).toBe(true);
    expect(row.detail).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test("a fixable failure is never treated as an outage", () => {
    const row = toTaskRow(
      task({ id: "s3", functionId: "record_work_progress", errorCode: "BOQ_LINE_REQUIRED" }),
      "blocked",
      { now: NOW }
    );
    expect(row.isSystemFailure).toBe(false);
  });

  test("an unregistered function offers the screen, not a Retry that must fail again", () => {
    const row = toTaskRow(
      task({ id: "g1", functionId: "list_customers", projectId: "p1", errorCode: "FUNCTION_NOT_AVAILABLE" }),
      "blocked",
      { now: NOW }
    );
    expect(row.detail).toBe("PROJEXA can't do that from the composer yet");
    const open = row.actions.find((a) => a.kind === "open");
    expect(open?.label).toBe("Open the screen");
    expect(open?.href).toBe("/customers?projectId=p1");
    expect(row.actions.some((a) => a.kind === "retry")).toBe(false);
  });

  test("with no screen to open, the row states the fact and offers no dead control", () => {
    const row = toTaskRow(
      task({ id: "g2", functionId: "list_notices", errorCode: "FUNCTION_NOT_AVAILABLE" }),
      "blocked",
      { now: NOW }
    );
    expect(row.detail).toBe("PROJEXA can't do that from the composer yet");
    expect(row.actions.some((a) => a.kind === "open")).toBe(false);
  });

  test("a missing timesheet task asks for a task and opens that picker", () => {
    const row = toTaskRow(
      task({ id: "t9", functionId: "record_timesheet", errorCode: "TASK_REQUIRED" }),
      "blocked",
      { now: NOW }
    );
    expect(row.detail).toBe("Pick a task");
    expect(row.actions[0]).toMatchObject({ kind: "fix", label: "Pick task", missingStep: "task" });
  });
});
