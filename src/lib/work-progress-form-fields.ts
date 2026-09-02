// R67 lane B (B-09, DE-22) -- WHAT THE DAILY ENTRY FORM STILL NEEDS, IN WORDS.
//
// Pure, and deliberately its OWN module rather than three helpers inside
// WorkProgressFormClient.tsx: the rule it encodes -- which fields are
// required, and therefore what the Save button is allowed to say -- has to
// agree with the rule the server enforces in
// construction-progress-service.createEntry(), and a rule you can only
// exercise by mounting a client component is a rule nobody re-checks.
//
// THE BUTTON NAMES WHAT IS MISSING. "Log Entry", disabled, with "2 required
// fields" beside it, makes the user hunt the form for which two. "Log Entry
// (BOQ line)" does not. The labels here are the same words the controls
// themselves carry, so the button and the field can never disagree.

/** The label each required field shows on its own control. */
export const REQUIRED_FIELD_LABELS: Readonly<Record<string, string>> = {
  activityId: "Activity",
  boqLineItemId: "BOQ line",
  entryDate: "Date",
  quantityDone: "Quantity done",
  percentComplete: "% complete",
  entryBasis: "Entry basis",
};

/**
 * THE RULE, client side. It must match the server's:
 *
 *   the project has at least one BOQ -> a BOQ line is required
 *   the project has no BOQ           -> there is nothing to link to
 *
 * (construction-progress-service.createEntry raises BOQ_LINE_REQUIRED for
 * exactly the first case.) The order is the order the fields appear on the
 * form, so the button reads them out top to bottom.
 */
export function requiredProgressFields(projectHasBoq: boolean): string[] {
  return [
    "activityId",
    ...(projectHasBoq ? ["boqLineItemId"] : []),
    "entryDate",
    "quantityDone",
    "percentComplete",
    "entryBasis",
  ];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function missingProgressFields(values: Record<string, unknown>, projectHasBoq: boolean): string[] {
  return requiredProgressFields(projectHasBoq).filter((f) => isBlank(values[f]));
}

/** "Log Entry" when nothing is missing; "Log Entry (BOQ line)" when it is. */
export function submitLabelFor(missing: string[]): string {
  if (missing.length === 0) return "Log Entry";
  return `Log Entry (${missing.map((f) => REQUIRED_FIELD_LABELS[f] ?? f).join(", ")})`;
}

/** The same names, for the disabled-reason and the after-click message. */
export function missingFieldNames(missing: string[]): string {
  return missing.map((f) => REQUIRED_FIELD_LABELS[f] ?? f).join(", ");
}
