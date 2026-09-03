// R67 D-47 (audit R-121) -- the New Activity form's own rules.
//
// /schedule/tasks/new could set a title, a type, a priority and a due date. A
// programme needs a START, a DURATION, what the activity FOLLOWS, and which BOQ
// line it earns its value against -- so the Timeline it fed could not draw a
// bar, could not draw a dependency line, and had nothing to compare to a
// baseline.
//
// These rules live here, not in the component, because this repo's test
// environment does not deliver input/change events to React: a component test
// cannot type a date and reach the message. Each rule is therefore exported and
// exercised directly, and the component is asserted for the states it can be
// driven into.

import { daysBetween, toUtcMs } from "./schedule-progress";

export const TITLE_LABEL = "Title";
export const START_DATE_LABEL = "Start date";
export const DUE_BEFORE_START_MESSAGE = "Due date is before the start date — pick a later date";

export type ActivityDraft = { title: string; startDate: string; dueDate: string };

/** The mandatory fields still empty, in the order they appear on the form. */
export function missingActivityFields(draft: ActivityDraft): string[] {
  return [
    ...(draft.title.trim() ? [] : [TITLE_LABEL]),
    ...(draft.startDate ? [] : [START_DATE_LABEL]),
  ];
}

/**
 * D-47's exact progression: "Save (2 required fields)", then
 * "Save (Start date is required)", then plain "Save".
 *
 * A COUNT while more than one is missing (naming them all makes the button
 * unreadable), the NAME once only one is left (a count of one tells the user
 * nothing they cannot already see).
 */
export function activitySaveLabel(
  missing: readonly string[],
  options: { submitting?: boolean; blocked?: string | null } = {}
): string {
  const reason = activitySaveReason(missing, options);
  return reason ? `Save (${reason})` : "Save";
}

/** The bracket contents only -- the kit's ObjectScreen renders `Save (<reason>)` itself. */
export function activitySaveReason(
  missing: readonly string[],
  options: { submitting?: boolean; blocked?: string | null } = {}
): string | undefined {
  if (options.submitting) return "Creating…";
  if (missing.length > 1) return `${missing.length} required fields`;
  if (missing.length === 1) return `${missing[0]} is required`;
  if (options.blocked) return options.blocked;
  return undefined;
}

/** The blur check on Due Date. Null when either date is absent -- an unfilled field is not an error. */
export function dueDateError(startDate: string, dueDate: string): string | null {
  if (!startDate || !dueDate) return null;
  const days = daysBetween(startDate, dueDate);
  if (days === null) return null;
  return days < 0 ? DUE_BEFORE_START_MESSAGE : null;
}

const DAY_MS = 86_400_000;

/** ISO date `days` after `startDate`; null when the start is unusable. */
export function addDaysIso(startDate: string, days: number): string | null {
  const start = toUtcMs(startDate);
  if (start === null || !Number.isFinite(days)) return null;
  return new Date(start + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Duration in days, as the field shows it: the empty string when it cannot be
 * derived, so the input renders blank rather than "NaN" or a confident 0.
 */
export function durationFieldValue(startDate: string, dueDate: string): string {
  const days = daysBetween(startDate, dueDate);
  return days === null ? "" : String(days);
}

/**
 * Typing a duration moves the finish date; typing a finish date moves the
 * duration. Returns the new due date, or null when there is nothing to derive
 * from -- the caller leaves the field alone in that case rather than clearing
 * a date the user typed.
 */
export function dueDateFromDuration(startDate: string, duration: string): string | null {
  const trimmed = duration.trim();
  if (!startDate || trimmed === "") return null;
  const days = Number(trimmed);
  if (!Number.isFinite(days) || days < 0) return null;
  return addDaysIso(startDate, days);
}
