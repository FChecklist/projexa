// R67 D-80 (audit R-302) -- "pickers that cost one click".
//
// Mark Attendance, Record Receipt and Log Time all open with an empty required
// picker, every time, for a user who picks the same option all day. This module
// is the memory that stops that: the last option chosen in a given picker, on a
// given project, by a given person, is remembered and offered back.
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
//     knows the list -- rememberedOption() in src/lib/reference-lookups.ts is
//     the shared shape of it.
//  3. IT IS SCOPED, NOT GLOBAL. Three axes, and all three are load-bearing:
//     the PERSON, the PROJECT and the PICKER. The same picker on two projects
//     is two different habits -- a storekeeper's usual material on the villa is
//     not their usual material on the tower -- and the same picker for two
//     people is two different habits for the same reason.
//
// NOT "use client": imported by client components and by tests alike.

// R80 GAP-8: BUMPED FROM "veri.lastChoice" TO ".v2".
//
// v1 keys were written with the identity segment hard-coded to "self" (see
// below), so on a shared browser profile -- a site office machine, a shared
// laptop, one Windows account used by a whole team -- every v1 entry belongs to
// "whoever last used this browser" rather than to a person. Reading them back
// under the new scheme would be the same defect wearing a new key, so they are
// deliberately orphaned instead: the affected pickers open empty exactly once,
// then start remembering per person. Orphaned entries are inert (nothing reads
// the v1 prefix any more) and are cleared by the browser's own site-data
// controls like any other localStorage key.
const PREFIX = "veri.lastChoice.v2";

/**
 * The bucket used when the caller genuinely has no identity to name.
 *
 * Reached in exactly two situations: the shell bootstrap has not answered yet
 * (a fraction of the first page load of a session -- see useShellUserId() in
 * src/lib/shell-store.ts, which is null until it lands), and a render with no
 * session at all -- which includes the case where /api/shell FAILED, since
 * that branch records userId: null.
 *
 * IT IS READ-ONLY. setLastChoice() below refuses to write when the id is null,
 * so nothing is ever stored under this name and every read of it answers null.
 * That is the whole point: a writable unknown bucket is the v1 "self" defect
 * exactly, just reached down a narrower path -- one signed-in person saving a
 * receipt while the bootstrap is still in flight (or after it failed) would
 * file their choice under a name the NEXT person on that browser profile reads
 * back. A picker that forgets one save is a lost click; a picker that hands
 * one user's habit to another is the leak this module was rewritten to close.
 */
export const UNKNOWN_USER_SCOPE = "self";

/**
 * The identity half of the key.
 *
 * `userId` is REQUIRED, and deliberately so. It used to be optional and every
 * call site omitted it, which is how the literal "self" ended up being the
 * scope for every user of every browser (R80 GAP-8). A parameter a caller can
 * forget is a defect that comes back; one the compiler asks for is a decision
 * somebody has to make on purpose. Pass useShellUserId()'s value straight
 * through -- including its null, which means "not known yet" and lands in
 * UNKNOWN_USER_SCOPE above.
 */
export function lastChoiceKey(picker: string, projectId: string | null | undefined, userId: string | null | undefined): string {
  return `${PREFIX}.${userId || UNKNOWN_USER_SCOPE}.${projectId || "no-project"}.${picker}`;
}

/** The last option chosen in this picker, or null. Never throws. */
export function getLastChoice(
  picker: string,
  projectId: string | null | undefined,
  userId: string | null | undefined
): string | null {
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
 *
 * A NULL userId WRITES NOTHING AT ALL -- see UNKNOWN_USER_SCOPE above. There
 * is nothing to clear in that bucket either, because nothing can ever have
 * been put there, so the early return covers both the store and the clear.
 */
export function setLastChoice(
  picker: string,
  projectId: string | null | undefined,
  value: string | null | undefined,
  userId: string | null | undefined
): void {
  // Not "we do not know who this is yet, so file it under everybody".
  if (!userId) return;
  try {
    const key = lastChoiceKey(picker, projectId, userId);
    if (value && value.trim() !== "") window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // A picker that cannot remember still works; one that throws on save does not.
  }
}
