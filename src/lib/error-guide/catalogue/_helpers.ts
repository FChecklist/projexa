// Tiny builders shared by every catalogue file. Nothing here is logic that
// matters to the framework -- they only keep the data files short and typed.
import type { Guide, GuideContext } from "../types";

/** The framework tests messageRegex as a case-insensitive string pattern; rx() just marks intent. */
export const rx = (s: string): string => s;

/** Identity helper so every data file is type-checked against Guide. */
export const guides = (list: Guide[]): Guide[] => list;

/** `/base?projectId=<id>` when a project is known, else plain `/base`. */
export const proj =
  (base: string) =>
  (c: GuideContext): string =>
    c.projectId ? `${base}?projectId=${encodeURIComponent(c.projectId)}` : base;

/** `/base/<entityId>` when an entity is known, else the list page `/base`. */
export const ent =
  (base: string) =>
  (c: GuideContext): string =>
    c.entityId ? `${base}/${encodeURIComponent(c.entityId)}` : base;

/** `/base/<entityId>/<tail>` when known, else `/base`. */
export const entTail =
  (base: string, tail: string) =>
  (c: GuideContext): string =>
    c.entityId ? `${base}/${encodeURIComponent(c.entityId)}/${tail}` : base;

/** Sign-in page that returns the user to the exact screen they were on. */
export const loginBack = (c: GuideContext): string =>
  `/login?redirectTo=${encodeURIComponent((c.route || "/") + (c.search || ""))}`;

/** The screen the user is on right now (used for "try again here"). */
export const here = (c: GuideContext): string => (c.route || "/") + (c.search || "");

/** `/base/<entityId>` when known, else the given fallback page (for bases with no list route of their own). */
export const entOr =
  (base: string, fallback: string) =>
  (c: GuideContext): string =>
    c.entityId ? `${base}/${encodeURIComponent(c.entityId)}` : fallback;
