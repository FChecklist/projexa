// R67 D-34 (R-085): the roster form's validation model, in ONE place.
//
// The roster is where every trade-wise number in this product comes from, and
// its create form and its edit fields were two independent implementations of
// the same rules -- the create screen refused an empty name silently, the edit
// screen refused it with a toast, and neither said which field was wrong. This
// module is what both now read, so the button's disabled reason, the on-blur
// message and the submit-time error cannot disagree.

export type RosterFieldKey = "name" | "dailyRate";

/** The label used in the "Save (…)" disabled reason -- Sumeet's own words for these fields. */
export const ROSTER_FIELD_LABEL: Record<RosterFieldKey, string> = {
  name: "Name",
  dailyRate: "Daily Rate",
};

export const NAME_REQUIRED_MESSAGE = "Enter the worker's name";

/**
 * "Enter a daily rate in AED, e.g. 120".
 *
 * The currency is NOT hardcoded: currencyLabel() is this repo's one source for
 * it, and its own rule (see src/lib/currency.ts) is that a currency token is
 * never rendered when it cannot be sourced. So an org whose currency is known
 * gets the sentence with its code in it, and an org whose currency has not
 * loaded gets the same sentence without a currency it would be guessing at --
 * rather than a confidently wrong one.
 */
export function rateRequiredMessage(currencyLabelValue: string): string {
  const code = currencyLabelValue.trim();
  return code ? `Enter a daily rate in ${code}, e.g. 120` : "Enter a daily rate, e.g. 120";
}

export type RosterDraft = { name: string; dailyRate: string };

/** The fields still missing, in form order. Empty means Save may proceed. */
export function missingRosterFields(draft: RosterDraft): RosterFieldKey[] {
  const missing: RosterFieldKey[] = [];
  if (!draft.name.trim()) missing.push("name");
  if (!isUsableRate(draft.dailyRate)) missing.push("dailyRate");
  return missing;
}

/**
 * A rate is usable when it is a real, non-negative number. "abc" and "-5" are
 * NOT usable: the server refuses both (construction-labour-service's own
 * dailyRate guard), and a form that lets you click Save into a refusal is the
 * fail-after-click this programme keeps closing.
 */
export function isUsableRate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

/** The message for one field, or null when it is fine. One function, so the blur and the submit agree. */
export function rosterFieldMessage(field: RosterFieldKey, draft: RosterDraft, currencyLabelValue: string): string | null {
  if (field === "name") return draft.name.trim() ? null : NAME_REQUIRED_MESSAGE;
  return isUsableRate(draft.dailyRate) ? null : rateRequiredMessage(currencyLabelValue);
}

/** "Name, Daily Rate" -- the reason the primary carries, in the convention /labour/new already ships. */
export function missingRosterReason(draft: RosterDraft): string | undefined {
  const missing = missingRosterFields(draft);
  return missing.length > 0 ? missing.map((f) => ROSTER_FIELD_LABEL[f]).join(", ") : undefined;
}

/** The sentinel the Trade select uses for its "+ Add trade…" option. Not a trade name, and never submitted. */
export const ADD_TRADE_OPTION = "__add_trade__";
export const ADD_TRADE_LABEL = "+ Add trade…";

/** The Company select's first option. A worker with no subcontractor is a direct hire, which is a real answer, not a blank. */
export const DIRECT_HIRE_OPTION = "__direct__";
export const DIRECT_HIRE_LABEL = "Direct hire (no subcontractor)";
