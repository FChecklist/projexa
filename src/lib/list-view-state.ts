"use client";

// R67 D-10. "Back restores the list's filters and scroll" is a mandatory rule
// in this product (the kit's ListScreen carries the sort/page/scroll half of it
// already, keyed by functionId). What ListScreen does NOT carry is the filters:
// it saves `filters: {}` unconditionally, because a filter set is owned by the
// screen that renders the filter bar, not by the table underneath it.
//
// This is that half. Same storage as screen-message.ts (sessionStorage, every
// access wrapped -- it throws outright in some privacy modes) with the opposite
// lifetime rule: a receipt is read ONCE and cleared, a filter set is read every
// time the screen mounts and cleared only when the user clears the filter. A
// user who opens a drawing and comes back must find the register the way they
// left it; a user who opens it tomorrow in a new tab must not.
//
// Deliberately untyped beyond "a flat record of strings": every screen's filter
// shape is its own, and a shared module that knew about Kind and Discipline
// would have to change every time a second screen adopted it.

const PREFIX = "veri.list.filters:";

export type ListFilters = Record<string, string>;

/** Read the saved filter set for `key` (e.g. "drawings.list"). */
export function readListFilters(key: string): ListFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw ? parseListFilters(raw) : {};
  } catch {
    return {};
  }
}

/** Save (or, for an empty set, forget) the filter set for `key`. */
export function writeListFilters(key: string, filters: ListFilters): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(filters).filter(([, v]) => typeof v === "string" && v !== "");
    if (entries.length === 0) {
      window.sessionStorage.removeItem(PREFIX + key);
      return;
    }
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage unavailable. Restoring a filter is a convenience; failing to
    // store one must never stop the screen rendering.
  }
}

/**
 * Exported for its own test: the shape check `readListFilters` applies. A
 * corrupted or hand-edited entry must come back as "no filters", never as a
 * filter whose value renders "[object Object]" in a chip.
 */
export function parseListFilters(raw: string): ListFilters {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ListFilters = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}
