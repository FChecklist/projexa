// R67 D-80 (audit R-302) -- "pickers that cost one click".
//
// Mark Attendance, Record Receipt and Log Time all open with an empty required
// picker, every time, for a user who picks the same option all day. This module
// is the memory that stops that: the last option chosen in a given picker, on a
// given project, is remembered and offered back.
//
// THREE RULES, and they are the whole module:
//
//  1. EVERY ACCESS IS GUARDED. localStorage throws outright in a Safari private
//     window, in an embedded webview with site data disabled, and inside a
//     cross-origin iframe -- not "returns null", THROWS. An unguarded read here
//     would take down a create screen for a class of users who would have no
//     idea why. Every function below returns a value rather than propagating.
//  2. A REMEMBERED CHOICE IS A SUGGESTION, NEVER A COMMITMENT. The caller
//     checks that the stored id is still in the option list before selecting
//     it; a worker who left the roster must not be silently re-selected. That
//     check lives in the caller (see EntityCombobox) because only the caller
//     knows the list.
//  3. IT IS SCOPED, NOT GLOBAL. The same picker on two projects is two
//     different habits: a storekeeper's usual material on the villa is not
//     their usual material on the tower.
//
// NOT "use client": imported by client components and by tests alike.

const PREFIX = "veri.lastChoice";

/**
 * The identity half of the key.
 *
 * `userId` is a parameter because the key MUST be able to carry one the moment
 * a picker screen knows who is looking at it. Today none of the three do --
 * none of them fetches an identity, and adding a round trip to /api/organization
 * just to name a localStorage key would cost more than the feature saves -- so
 * "self" is the honest placeholder. It is not a fabricated user id, and
 * localStorage is already partitioned per browser profile, which is the same
 * boundary for every single-user machine. When a screen gains a real user id,
 * pass it and the key changes shape without touching any of the logic.
 */
export function lastChoiceKey(picker: string, projectId: string | null | undefined, userId?: string | null): string {
  return `${PREFIX}.${userId || "self"}.${projectId || "no-project"}.${picker}`;
}

/** The last option chosen in this picker, or null. Never throws. */
export function getLastChoice(picker: string, projectId: string | null | undefined, userId?: string | null): string | null {
  try {
    const value = window.localStorage.getItem(lastChoiceKey(picker, projectId, userId));
    return value && value.trim() !== "" ? value : null;
  } catch {
    // Storage unavailable (private window, site data blocked, sandboxed frame).
    // The picker simply opens empty, which is what it did before this existed.
    return null;
  }
}

/**
 * Remembers a choice. An empty id CLEARS the memory rather than storing "",
 * so "I deliberately blanked this field" is not remembered as a selection.
 * Never throws.
 */
export function setLastChoice(
  picker: string,
  projectId: string | null | undefined,
  value: string | null | undefined,
  userId?: string | null
): void {
  try {
    const key = lastChoiceKey(picker, projectId, userId);
    if (value && value.trim() !== "") window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // A picker that cannot remember still works; one that throws on save does not.
  }
}
