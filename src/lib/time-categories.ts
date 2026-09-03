// R67 D-51 (audit R-145 / R-149) -- the Category a time entry is logged
// against.
//
// THE DEFECT THIS REPLACES. /schedule/log-time had a free-text "Activity Type
// (optional)" input whose placeholder was "e.g. Development, Site Visit". That
// is a software team's vocabulary on a site product, it was optional, and it
// was free text -- so designerTimesheetReport's byCategory breakdown grouped on
// whatever each person happened to type, which in practice is two or three
// spellings per person and no usable subtotal at all.
//
// WHERE THE OPTIONS COME FROM. The project's own construction categories, which
// GET /api/work-progress/activities already returns alongside its activities
// (`{ activities, categories }`) -- one existing call, no new endpoint. Those
// are the categories this org actually books progress against, so a time entry
// and a progress entry end up under the same name.
//
// WHY THERE IS ALSO A SEED LIST. A project that has not yet had a BOQ imported
// has zero categories, and an empty required select is a dead end. The seed is
// the customer's own BOQ vocabulary, and it is UNIONED with the real list
// rather than replacing it -- so the moment a project has categories of its
// own, they appear, and the seeded ones do not vanish underneath entries that
// were already logged against them.
//
// R67 lane I's item I-05 has since added an editable org-level BOQ category
// list (compliance.construction_boq_categories, reachable at
// GET /api/scope/categories) whose own default set is a superset of the seed
// below. When that proxy exists in this repo, `loadCategoryNames`'s single
// fetch is the one line to repoint; nothing else here changes.

/** Sumeet's own BOQ categories -- the vocabulary a site manager already uses. */
export const SEEDED_CATEGORIES: readonly string[] = ["Joinery", "Gypsum", "Paint", "Civil", "Misc"];

/**
 * The option that reveals a free-text field. It is a real option rather than a
 * hidden escape hatch because a category list is never complete, and forcing a
 * wrong choice is worse than one honest "Other".
 */
export const OTHER_CATEGORY_VALUE = "__other__";
export const OTHER_CATEGORY_LABEL = "Other (specify)";

/**
 * Merges the project's own categories with the seed, case-insensitively, and
 * keeps the project's OWN casing where the two collide ("civil" typed by this
 * org stays "civil", not silently retitled "Civil").
 *
 * The project's categories come first: they are the ones this org actually
 * uses, and the seed exists only so the list is never empty.
 */
export function mergeCategoryNames(projectCategories: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const name of [...projectCategories, ...SEEDED_CATEGORIES]) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged;
}

/**
 * What is actually stored in pms_time_entries.activityType.
 *
 * D-51: "Persist the value into the existing activityType field until the
 * backend gains a real category column, so designerTimesheetReport's byCategory
 * breakdown groups on a stable value from day one instead of on two spellings
 * per designer." Choosing "Other" and typing nothing is not a category, and
 * must not be saved as the literal sentinel.
 */
export function resolveCategoryValue(selected: string, otherText: string): string | null {
  if (!selected) return null;
  if (selected !== OTHER_CATEGORY_VALUE) return selected;
  const trimmed = otherText.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The project's own construction categories, merged with the seed.
 *
 * ONE fetch, and it never rejects: a failed lookup degrades to the seeded
 * vocabulary rather than leaving a REQUIRED select with nothing in it. The
 * caller therefore has no error branch to render for this field -- a category
 * list that is merely shorter than it could be is not a failure the user can
 * act on, and telling them about it would be noise beside a working control.
 *
 * The source is GET /api/work-progress/activities, which already returns the
 * project's categories alongside its activities. See the note at the top of
 * this file for the one line to repoint when lane I's /api/scope/categories
 * proxy lands in this repo.
 */
export async function loadCategoryNames(projectId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return mergeCategoryNames([]);
    const data = (await res.json()) as { categories?: { name?: string | null }[] } | null;
    const names = (data?.categories ?? []).map((c) => (c?.name ?? "").trim()).filter(Boolean);
    return mergeCategoryNames(names);
  } catch {
    return mergeCategoryNames([]);
  }
}
