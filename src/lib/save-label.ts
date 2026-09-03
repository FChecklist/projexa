// R67 D-67 -- the one required-field convention, extracted from /labour/new.
//
// /labour/new is the model the audit picked out (correction C-11: "the good
// create-form pattern in PROJEXA is /labour/new's 'Save (Name, Daily Rate)'
// disabled-with-reason button"). Every other create screen had invented its
// own: Permits rendered a separate helper sentence counting fields ("2
// required fields still needed — permit name, permit PDF") beside a button
// that just said "Create"; /scope/new had a teal Save that was ENABLED on a
// completely empty form; the Budget ledger form put a 200-character
// explanation inside the button label.
//
// The convention, in one line: the primary action's own LABEL names what is
// missing, and the button is disabled until nothing is. There is no separate
// helper sentence, no asterisk, and no marker on optional fields -- a field
// that is not named in the label is not required, which is a rule a user can
// learn once and apply everywhere.
//
// Item D-73 owns this file's remaining half (a useRequired() hook and the
// per-form migration of /scope/new, /permits/new, /labour/new and
// /budgets/new). saveLabel() is created here, to D-73's exact specified
// signature, because D-67's CreateScreen archetype cannot render its primary
// action without it -- one implementation, adopted twice, rather than two.

/**
 * The primary action's label.
 *
 *   saveLabel("Save", [])                        === "Save"
 *   saveLabel("Save", ["Name", "Daily Rate"])    === "Save (Name, Daily Rate)"
 *
 * `missing` carries the labels a user READS on the form -- never the API's
 * camelCase parameter names, which is the same rule src/lib/task-errors.ts
 * applies to failures.
 */
export function saveLabel(verb: string, missing: string[]): string {
  const named = missing.map((m) => m.trim()).filter(Boolean);
  return named.length === 0 ? verb : `${verb} (${named.join(", ")})`;
}

/**
 * What the disabled primary explains when hovered or read out. `undefined`
 * means the control is live and needs no explanation -- the shape every
 * disabled-with-reason control in this repo already uses.
 */
export function saveDisabledReason(missing: string[], saving: boolean): string | undefined {
  if (saving) return "Saving…";
  if (missing.length === 0) return undefined;
  return `Still needed: ${missing.join(", ")}`;
}
