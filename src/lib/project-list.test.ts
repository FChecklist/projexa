import { describe, expect, test } from "bun:test";
import {
  PROJECT_EXPORT_HEADERS,
  filterProjects,
  percentBarWidth,
  projectExportRows,
  projectStatus,
  projectStatusText,
  type ProjectRow,
} from "./project-list";

function row(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    name: "Cedar Heights Villa - Phase 1",
    taskCount: 10,
    delayedTaskCount: 0,
    contractValue: 4_000_000,
    projectValue: 4_200_000,
    projectValueSource: "entered",
    earnedValue: 1_000_000,
    percentByValue: 25,
    ...over,
  };
}

describe("R67 D-69 project status", () => {
  test("a project with a late task is Delayed", () => {
    expect(projectStatus(row({ delayedTaskCount: 1 }))).toBe("delayed");
  });

  test("tasks logged and none late is On track", () => {
    expect(projectStatus(row())).toBe("on_track");
  });

  test("a project with NO tasks is not reported as On track", () => {
    expect(projectStatus(row({ taskCount: 0, delayedTaskCount: 0 }))).toBe("no_tasks");
    expect(projectStatusText(row({ taskCount: 0 }))).toBe("○ No tasks yet");
  });

  test("every status carries a glyph AND a word, never a bare colour", () => {
    expect(projectStatusText(row({ delayedTaskCount: 2 }))).toBe("● Delayed");
    expect(projectStatusText(row())).toBe("✓ On track");
  });
});

describe("R67 D-69 filter", () => {
  const rows = [
    row({ id: "a", delayedTaskCount: 3 }),
    row({ id: "b" }),
    row({ id: "c", taskCount: 0 }),
  ];

  test("no filter means every row", () => {
    expect(filterProjects(rows, "")).toHaveLength(3);
  });

  test("each status selects only its own rows", () => {
    expect(filterProjects(rows, "delayed").map((r) => r.id)).toEqual(["a"]);
    expect(filterProjects(rows, "on_track").map((r) => r.id)).toEqual(["b"]);
    expect(filterProjects(rows, "no_tasks").map((r) => r.id)).toEqual(["c"]);
  });

  test("filtering returns a copy, so the caller cannot mutate the source list", () => {
    expect(filterProjects(rows, "")).not.toBe(rows);
  });
});

describe("R67 D-69 percent bar", () => {
  test("null when the project has no BOQ, so the row says so in words instead of drawing 0%", () => {
    expect(percentBarWidth(null)).toBeNull();
  });

  test("a real zero draws a real empty bar", () => {
    expect(percentBarWidth(0)).toBe(0);
  });

  test("clamped, so a backend figure outside 0-100 cannot overrun its track", () => {
    expect(percentBarWidth(140)).toBe(100);
    expect(percentBarWidth(-4)).toBe(0);
    expect(percentBarWidth(25)).toBe(25);
  });
});

describe("R67 D-69 export", () => {
  test("the export carries the same five columns the table shows", () => {
    expect(PROJECT_EXPORT_HEADERS).toEqual(["Project", "% complete", "Contract value", "Project value", "Status"]);
    expect(projectExportRows([row()])[0]).toEqual([
      "Cedar Heights Villa - Phase 1",
      25,
      4_000_000,
      4_200_000,
      "✓ On track",
    ]);
  });

  test("a null exports as an empty cell, never as 0", () => {
    const [exported] = projectExportRows([row({ percentByValue: null, contractValue: null, projectValue: null })]);
    expect(exported[1]).toBe("");
    expect(exported[2]).toBe("");
    expect(exported[3]).toBe("");
  });
});
