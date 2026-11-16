// BOQ Compare screen: turn the server's comparison into the rows the shared
// CompareScreen draws. Extracted from ScopeCompareClient.tsx (which could not
// be unit-tested: it pulls in the whole UI kit) so the rule is a pure function.
//
// Sumeet R-24: "Percentage-only change detected as variation". When a line's
// qty and rate are untouched and ONLY its breakdown % moved, the line must
// still appear as changed, with its amount and breakdown % flagged. R-21:
// each changed line is compared with its prior revision (previous/current).
// Boss16 closure test: src/lib/boq-compare-result.test.ts.

import type { BoqComparison, ChangedLineItem } from "@/lib/boq-helpers";

export type CompareChangedFields = string[];

export function changedFieldsFor(c: Pick<ChangedLineItem, "quantityChange" | "rateChange" | "breakdownPercentageChange">): CompareChangedFields {
  const changedFields: string[] = [];
  if (c.quantityChange !== 0) changedFields.push("quantity");
  if (c.rateChange !== 0) changedFields.push("rate");
  if (c.quantityChange !== 0 || c.rateChange !== 0 || c.breakdownPercentageChange !== 0) changedFields.push("amount");
  if (c.breakdownPercentageChange !== 0) changedFields.push("breakdownPercentage");
  return changedFields;
}

export function toCompareResult(cmp: BoqComparison) {
  const changed = cmp.changed.map((c) => ({
    key: c.key,
    previous: c.previous,
    current: c.current,
    changedFields: changedFieldsFor(c),
  }));
  return { added: cmp.added, removed: cmp.removed, changed, warnings: cmp.warnings };
}
