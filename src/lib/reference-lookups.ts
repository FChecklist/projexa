"use client";

// R67 F-06 (R-088/R-094). Reference data shared across a module's three
// screens.
//
// THE PATTERN THIS REPLACES. /labour, /labour/new and /labour/[id] each
// fetched GET /api/vendors independently, from their own useEffect, on every
// mount -- three identical requests for the same never-changing subcontractor
// list during one user's trip through the module, plus one more every time
// they came back. LabourClient additionally awaited it inside the same
// Promise.allSettled as the roster, so a slow vendor lookup delayed the roster
// table it only decorates with a company name.
//
// The fix is the same shape currency.ts already uses for /api/currencies: one
// tab-lifetime cache, one in-flight request shared by every caller, and a
// failure that is never cached (a blip must not pin "this org has no vendors"
// for a minute -- that renders every Company cell as an em-dash and looks like
// data, not an outage).
//
// The store itself is src/lib/shell-cache.ts's -- the same TTL + request
// coalescing the shell uses. It is not shell-specific; only the keys are.
import { cachedShellJson, invalidateShellCache, SHELL_CACHE_TTL_MS } from "@/lib/shell-cache";

export type Vendor = { id: string; vendorName: string };

export const VENDORS_CACHE_KEY = "reference:vendors";

/**
 * The org's subcontractor/vendor list, memoised for the tab.
 *
 * NEVER REJECTS. Every caller uses this for a display-only lookup (a company
 * name next to a worker, the options in an optional Company select), so a
 * failed lookup degrades that one cell to "—" rather than turning a working
 * roster into an error card. The failure is logged, not swallowed silently,
 * and is not cached, so the next mount retries.
 */
export async function loadVendors(ttlMs: number = SHELL_CACHE_TTL_MS): Promise<Vendor[]> {
  try {
    const data = await cachedShellJson<{ vendors?: Vendor[] }>(VENDORS_CACHE_KEY, "/api/vendors", { ttlMs });
    return data.vendors ?? [];
  } catch (err) {
    console.error("[reference-lookups] vendors lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Drops the memoised vendor list -- call after creating or editing a vendor. */
export function invalidateVendors(): void {
  invalidateShellCache(VENDORS_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// R80 GAP-8 -- deriving a create screen's DEFAULT from reference data.
//
// The owner's point 7 is "the system should pre-populate data before the user
// asks". The measured state was that 42 of 64 create screens opened completely
// blank, and every screen that seeded anything seeded today's date or a static
// enum constant.
//
// THE RULE THESE TWO FUNCTIONS EXIST TO ENFORCE, and the reason they are here
// rather than inlined per screen: only pre-fill a value that can be JUSTIFIED
// from real data. Each returns null for "nothing here is derivable" rather
// than reaching for a plausible-looking answer, because a wrong default on a
// create form is worse than an empty one -- an empty field is visibly the
// user's to answer, whereas a wrong one gets saved.
//
// They are pure and take their inputs as arguments, so the judgement can be
// asserted without a DOM, a clock or a network.
//
// NOT SEEDED, and deliberately: BudgetCreateClient.tsx renders an unseeded
// "Fiscal Year" select. A helper could derive the current year from
// erp_fiscal_years, but seeding that screen is a change to
// BudgetCreateClient.tsx and belongs with that screen, alongside its real
// call site -- an exported helper with no caller is dead code, and one whose
// comment asserts a caller misleads the next reader into thinking a screen is
// already seeded.
// ---------------------------------------------------------------------------

/** Anything with an id: the shape every reference list in this app shares. */
type Identified = { id: string };

/**
 * The id of the ONLY row, when there is exactly one.
 *
 * The case this answers: an org with one warehouse, one legal entity, one
 * audit engagement, one department. Asking somebody to open a dropdown and
 * choose the single thing in it is pure ceremony -- there is no second answer
 * to get wrong, so the choice carries no information.
 *
 * TWO rows is not "probably the first one", it is a real question, and this
 * returns null for it. Preselecting the sole option is also safe as the org
 * grows: nothing is locked, the control still lists everything, and the moment
 * a second row exists this stops seeding on its own.
 *
 * A blank or whitespace id is treated as no id -- a select whose value is ""
 * means "nothing chosen" everywhere in this codebase, so seeding one would set
 * a field to the empty answer while looking like it had set something.
 */
export function soleOptionId<T extends Identified>(rows: readonly T[] | null | undefined): string | null {
  if (!rows || rows.length !== 1) return null;
  const id = (rows[0]?.id ?? "").trim();
  return id === "" ? null : id;
}

/**
 * A remembered choice, but only if it is still a real option.
 *
 * Rule 2 of src/lib/last-choice.ts ("a remembered choice is a suggestion,
 * never a commitment") stated as a function. A worker who left the roster, a
 * material that was retired, an expense head that was renamed: all of them are
 * ids that storage still holds and the current list no longer offers, and
 * re-selecting one would post a value the user never saw.
 *
 * ITS CALLER is resolveInitialValue() in src/components/EntityCombobox.tsx --
 * the one place in the app that turns a remembered id into a preselection, and
 * therefore the only place this rule has to hold. It was inlined there as
 * `options.some(...)` until R80 GAP-8; sharing the function is what keeps the
 * rule and the sentence describing it from drifting apart.
 */
export function rememberedOption(
  stored: string | null | undefined,
  options: readonly string[] | null | undefined
): string | null {
  const value = (stored ?? "").trim();
  if (value === "" || !options) return null;
  return options.includes(value) ? value : null;
}
