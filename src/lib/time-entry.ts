// R67 D-50 (audit R-142 / R-143 / R-151) -- the rules behind /schedule/log-time.
//
// They live here rather than inside the component for one measured reason: this
// repo's test environment does not deliver input/change events to React, so a
// component test cannot type into Hours and reach the message the item names.
// Every rule that depends on a typed value is therefore an exported function
// with its own exhaustive test, and the component is asserted for the states it
// can actually be driven into.
//
// The vocabulary is fixed here too, so the field message, the Save label and
// the receipt cannot drift into three different spellings of the same rule.

import { formatDayMonthYear } from "./format-date";

/** Quarter-hour granularity: the smallest unit anyone books on a site, and what the field's own step already is. */
export const HOURS_STEP = 0.25;
export const HOURS_MAX = 24;

export const TASK_REQUIRED_MESSAGE = "Choose the task these hours were spent on";
export const HOURS_INVALID_MESSAGE = "Enter hours greater than 0, in steps of 0.25 (max 24)";
export const DATE_REQUIRED_MESSAGE = "Pick the date the work was done";

/**
 * The Hours field's own rule.
 *
 * An EMPTY field is not "invalid" -- it is "not filled in yet", which the Save
 * label already reports. Returning a validation error for it would put a red
 * message under a field the user has not reached.
 */
export function hoursError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours)) return HOURS_INVALID_MESSAGE;
  if (hours <= 0 || hours > HOURS_MAX) return HOURS_INVALID_MESSAGE;
  // Multiples of 0.25, compared in whole quarter-hours so 7.5 does not fail on
  // binary floating point the way (7.5 % 0.25) can.
  const quarters = hours / HOURS_STEP;
  if (Math.abs(quarters - Math.round(quarters)) > 1e-9) return HOURS_INVALID_MESSAGE;
  return null;
}

export type TimeEntryDraft = {
  issueId: string;
  hours: string;
  spentOn: string;
  /** D-51's required Category, already resolved (an "Other" with nothing typed is null). */
  category: string | null;
};

/** The fields still to be filled in, in the order they appear on the form. */
export function missingFields(draft: TimeEntryDraft): string[] {
  return [
    ...(draft.issueId ? [] : ["Task"]),
    ...(draft.hours.trim() ? [] : ["Hours"]),
    ...(draft.spentOn ? [] : ["Date"]),
    ...(draft.category ? [] : ["Category"]),
  ];
}

/**
 * What goes INSIDE the brackets on the primary button, or undefined when the
 * form is ready to save.
 *
 * A count AND the names, because a bare count makes the user hunt and bare
 * names get long. `blocked` carries a rule failure (bad hours) that is not a
 * missing field, so a filled-but-wrong form cannot look ready to save.
 *
 * This is the shape the kit's ObjectScreen wants -- it renders
 * `Save (<reason>)` itself -- which is why the reason and the whole label are
 * two functions rather than one string with a regex taken back off it.
 */
export function saveReason(
  missing: readonly string[],
  options: { submitting?: boolean; blocked?: string | null } = {}
): string | undefined {
  if (options.submitting) return "Logging…";
  if (missing.length > 0) return `${missing.length} required: ${missing.join(", ")}`;
  if (options.blocked) return options.blocked;
  return undefined;
}

/** The whole label: "Save (2 required: Task, Hours)", collapsing to a plain "Save". */
export function saveLabel(missing: readonly string[], options: { submitting?: boolean; blocked?: string | null } = {}): string {
  const reason = saveReason(missing, options);
  return reason ? `Save (${reason})` : "Save";
}

export type LoggedEntry = {
  hours: string | number;
  spentOn: string;
  taskNumber?: number | null;
  taskTitle?: string | null;
};

/**
 * The receipt: "Time logged: 3.00 h on #12 Joinery shop drawings, 02 Sep 2026".
 *
 * D-50: "a toast alone is not a receipt". It is built from the row the SERVER
 * stored and returned, not from the form's own state, so it can never report
 * something different from what was written. The date goes through the shared
 * formatter D-51 mandates for this screen, which prints a two-digit day.
 */
export function timeLoggedReceipt(entry: LoggedEntry): string {
  const hours = Number(entry.hours);
  const amount = Number.isFinite(hours) ? hours.toFixed(2) : String(entry.hours);
  const task =
    entry.taskNumber !== undefined && entry.taskNumber !== null
      ? `#${entry.taskNumber}${entry.taskTitle ? ` ${entry.taskTitle}` : ""}`
      : entry.taskTitle || "the selected activity";
  return `Time logged: ${amount} h on ${task}, ${formatDayMonthYear(entry.spentOn)}`;
}
