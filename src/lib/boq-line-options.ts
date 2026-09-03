// R67 lane D22 (item D-64, rec R-230): how a BOQ line is NAMED, in one place.
//
// The audit's finding was that the same line appeared three different ways
// across this app -- a raw 25-character id in the Work Progress list, a bare
// description in the Daily Entry select, and nothing at all in the reports. A
// line is a CODE and a DESCRIPTION; these two functions are the only place
// that sentence is composed, so the picker, the list cell and any future
// consumer cannot drift apart again.

export type BoqLineOption = {
  id: string;
  boqId: string;
  boqTitle: string;
  boqVersion: number;
  code: string | null;
  description: string;
  unit: string;
  /** The line's rate, so the Daily Entry's derived Rate field needs no second fetch of the whole BOQ. */
  rate: number;
  quantity: number;
  quantityDone: number;
  remainingQuantity: number;
  isParent: boolean;
};

/** Why a parent line cannot be recorded against -- its quantity is delivered through its children. */
export const PARENT_LINE_REASON = "parent - pick a child";

/** Pure: "R60SK-A — R60 skiphop sub", or just the description when the line has no code. */
export function boqLineLabel(line: { code: string | null; description: string }): string {
  const code = (line.code ?? "").trim();
  return code ? `${code} — ${line.description}` : line.description;
}

/** Pure: "m3 · 80 of 120 remaining" -- the unit and how much of the line is left. */
export function boqLineSublabel(line: { unit: string; quantity: number; remainingQuantity: number }): string {
  const unit = (line.unit ?? "").trim();
  const remaining = `${line.remainingQuantity} of ${line.quantity} remaining`;
  return unit ? `${unit} · ${remaining}` : remaining;
}

/** Pure: the option list a SearchSelect renders. Parent lines stay VISIBLE and are disabled with the reason -- hiding them would leave a QS hunting for a code they can see in the BOQ. */
export function toSearchOptions(lines: BoqLineOption[]) {
  return lines.map((line) => ({
    value: line.id,
    label: boqLineLabel(line),
    sublabel: boqLineSublabel(line),
    disabled: line.isParent,
    disabledReason: line.isParent ? PARENT_LINE_REASON : undefined,
  }));
}

/** Pure: where a BOQ line lives -- the BOQ's own object page, anchored at the line. */
export function boqLineHref(boqId: string, lineItemId: string): string {
  return `/scope/${boqId}#line-${lineItemId}`;
}
