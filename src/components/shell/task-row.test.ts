import { describe, expect, test } from "bun:test";
import {
  humaniseFunctionId,
  objectFor,
  startOfDay,
  tabView,
  toTaskRow,
  verbFor,
  type ApiTask,
  type GroupedRows,
  type ProjexaTaskRow,
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
      task({ functionId: "list_leads", error: "write CONNECT_TIMEOUT 3.109.171.244:6543" }),
      "blocked",
      { now: NOW }
    );
    expect(row.detail).toBe("The construction data service didn't answer — nothing was saved");
    expect(row.detail).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
    expect(row.errorCode).toBe("BACKEND_UNAVAILABLE");
    expect(row.actions[0]).toEqual({ kind: "retry", label: "Retry", missingStep: null });
  });

  test("a camelCase parameter name never reaches the row", () => {
    const row = toTaskRow(task({ functionId: "record_work_progress", error: "itemCode is required" }), "blocked", {
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
    expect(row.actions).toEqual([]);
  });

  test("a pasted stack trace in the user's own words is masked too", () => {
    const row = toTaskRow(task({ rawInput: "it said ECONNREFUSED 10.0.0.1:5432" }), "needsYou", { now: NOW });
    expect(row.detail).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
    expect(row.detail).not.toContain("ECONNREFUSED");
  });
});

describe("Dismiss appears only on a blocked row older than 24 h", () => {
  const blocked = (createdAt: string) =>
    toTaskRow(task({ functionId: "record_work_progress", error: "itemCode is required", createdAt }), "blocked", {
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
    const row = toTaskRow(task({ error: "itemCode is required" }), "blocked", { now: NOW });
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

  test("History is what finished before today", () => {
    const view = tabView(groups, "history", NOW);
    expect(view.primary.map((r) => r.id)).toEqual(["d-old"]);
    expect(view.count).toBe(1);
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
    expect(tabView(empty, "history", NOW).primaryEmpty).toBe("Nothing finished before today");
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
