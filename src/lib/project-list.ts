// R67 D-69 (audit R-261/R-300). The Projects list's own rules, kept out of the
// component so the status vocabulary, the filter and the export are provable
// without a DOM.
//
// Deliberately NOT "use client": pure functions over the rows /api/projects
// already returns.

import type { ProjectValueSource } from "@/lib/dashboard-kpi";

export type ProjectRow = {
  id: string;
  name: string;
  taskCount: number;
  delayedTaskCount: number;
  /** R67 D-62's own naming: the BOQ's root-line total. null when there is no active BOQ. */
  contractValue: number | null;
  projectValue: number | null;
  projectValueSource: ProjectValueSource;
  earnedValue: number | null;
  /** Whole-percent earned/contract, straight from the backend. null when there is no BOQ. */
  percentByValue: number | null;
};

/**
 * A project's status, glyph AND word, on the same WS-G rule the drawing register
 * follows: a colour alone is unreadable to a colour-blind user, unprintable in a
 * CSV export and meaningless to anyone who has not been told the code.
 *
 * THE THREE STATES ARE REAL READS, NOT A SCORE. The org dashboard returns a task
 * count and a delayed-task count per project and nothing else that could carry a
 * status, so those are what this says -- and the third state exists precisely so
 * that a project with no tasks logged is NOT reported as "On track". "Nobody has
 * logged anything" is not the same fact as "nothing is late", and a green tick
 * against an empty project is the kind of invented reassurance this programme is
 * removing everywhere else.
 */
export const PROJECT_STATUSES = ["delayed", "on_track", "no_tasks"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectStatusPresentation = { glyph: string; word: string; className: string };

const PRESENTATION: Record<ProjectStatus, ProjectStatusPresentation> = {
  // Clay dot: something on this project is past its due date.
  delayed: { glyph: "●", word: "Delayed", className: "text-[color:var(--color-veri-status-late)]" },
  // Sage tick: tasks exist and none of them is late.
  on_track: { glyph: "✓", word: "On track", className: "text-[color:var(--color-veri-status-done)]" },
  // Grey ring: nothing has been logged, so nothing can be said.
  no_tasks: { glyph: "○", word: "No tasks yet", className: "text-ct-muted" },
};

export function projectStatus(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): ProjectStatus {
  if (row.delayedTaskCount > 0) return "delayed";
  return row.taskCount > 0 ? "on_track" : "no_tasks";
}

export function projectStatusPresentation(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): ProjectStatusPresentation {
  return PRESENTATION[projectStatus(row)];
}

/** "✓ On track" -- the same words the export writes. */
export function projectStatusText(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): string {
  const { glyph, word } = projectStatusPresentation(row);
  return `${glyph} ${word}`;
}

/** The Filter bar's options, in the order the three states are read. */
export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "delayed", label: "Delayed" },
  { value: "on_track", label: "On track" },
  { value: "no_tasks", label: "No tasks yet" },
];

export function filterProjects(rows: readonly ProjectRow[], status: string): ProjectRow[] {
  if (!status) return [...rows];
  return rows.filter((r) => projectStatus(r) === status);
}

/**
 * The % complete bar's width. Clamped to 0-100 so a backend figure outside the
 * range cannot draw a bar past the end of its track, and null when there is no
 * BOQ -- the row then says so in words instead of drawing an empty bar, which
 * reads as 0% rather than as "no scope defined".
 */
export function percentBarWidth(percentByValue: number | null): number | null {
  if (percentByValue === null || !Number.isFinite(percentByValue)) return null;
  return Math.max(0, Math.min(100, percentByValue));
}

export const PROJECT_EXPORT_HEADERS = ["Project", "% complete", "Contract value", "Project value", "Status"];

export function projectExportRows(rows: readonly ProjectRow[]): unknown[][] {
  return rows.map((r) => [
    r.name,
    r.percentByValue ?? "",
    r.contractValue ?? "",
    r.projectValue ?? "",
    projectStatusText(r),
  ]);
}
