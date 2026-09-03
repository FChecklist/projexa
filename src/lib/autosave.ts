// R67 D-67 -- what an autosaving screen is allowed to say, and when.
//
// R-257: "MoMs autosave after ~2 s of inactivity with 'Saving… / Saved
// 12:04'." Two decisions live here rather than in the component, so they can
// be asserted without a DOM, a timer or a network:
//
//  1. WHEN A SAVE IS DUE. After a pause in typing, not on every keystroke --
//     a PATCH per character is a load problem, and a PATCH mid-word is a
//     half-written title in the database.
//  2. WHAT THE USER READS. "Saving…" while it is in flight, and the CLOCK
//     TIME it last landed once it has. A tick, a spinner or the word "Saved"
//     with no time attached all fail the same way: a user who has been
//     typing for ten minutes cannot tell whether the last two are safe.
//
// The failure wording is deliberately NOT here. An autosave that fails is a
// read-error-shaped event and it goes through the one dictionary in
// src/lib/task-errors.ts, like every other backend failure in this repo.

/** The pause in typing that makes a save due. R-257's "~2 s". */
export const AUTOSAVE_IDLE_MS = 2000;

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * The line beside the title. Null when there is nothing honest to say --
 * before the first change, the screen makes no claim at all.
 *
 * The time is formatted in the org's zone with an explicit locale for the
 * same hydration reason format-date.ts exists: a server-rendered "12:04" and
 * a browser-rendered "12:04" have to agree.
 */
export function autosaveLabel(
  status: AutosaveStatus,
  savedAt: Date | null,
  timeZone = "Asia/Dubai"
): string | null {
  if (status === "saving") return "Saving…";
  if (status === "error") return "Not saved";
  if (status === "pending") {
    // There ARE unsaved changes. Saying "Saved 12:04" here would be a lie
    // about the words the user can currently see on screen.
    return savedAt ? `Unsaved changes — last saved ${clockTime(savedAt, timeZone)}` : "Unsaved changes";
  }
  if (savedAt) return `Saved ${clockTime(savedAt, timeZone)}`;
  return null;
}

function clockTime(at: Date, timeZone: string): string {
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/**
 * Whether a draft is complete enough to be worth sending on its own.
 *
 * An autosave must never PATCH a record into a state the user could not have
 * reached with the Save button -- a meeting with its title deleted mid-edit
 * would otherwise be written away the moment they paused to think. So the
 * same required set gates both, and while something required is missing the
 * screen holds the change rather than sending it.
 */
export function autosaveIsSendable(missing: string[]): boolean {
  return missing.length === 0;
}
