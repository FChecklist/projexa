// Shared BOQ (Scope of Work) types + pure helper functions, extracted so the
// real-screen conversion (List/Object/Create/Revise/Compare, 2026-08-30) can
// share ONE copy of this logic instead of five independent re-implementations
// drifting apart. Every function here is pure (no fetch, no React state) --
// matches this codebase's own established convention of keeping business
// logic independently testable from the DB/network layer.

import { formatMoney, formatSignedMoney } from "@/lib/format-money";

export type Boq = {
  id: string;
  projectId: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
};

export type LineItemDraft = {
  description: string; unit: string; quantity: string; rate: string;
  // R67 lane I item I-05 (drizzle/0532) created the column; D-24 carries it
  // through this grid. Optional -- a line without one reads as "Uncategorized"
  // in the WPR's category-wise view and shows a "no category" chip rather than
  // blocking Save. The PICKLIST is the org-editable
  // compliance.construction_boq_categories table, read through
  // BoqCategorySelect, not a list this module invents.
  category?: string;
  itemCode?: string; activityId?: string; parentItemCode?: string; breakdownPercentage?: string;
};

// R67 lane I (WS-I item I-05): the chip shown beside a line that has no
// category. One constant so the Create, Revise and Object screens can never
// drift into three different words for the same state.
export const NO_CATEGORY_CHIP_LABEL = "no category";

export type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  category?: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
  // R39/R-C09: Point 154's budget overlay -- computedBudget is derived
  // server-side (amount * budgetPercentage / 100, construction-boq-
  // service.ts#computedBudget), never sent back independently editable.
  budgetPercentage?: string | null;
  computedBudget?: number | null;
  vendorId?: string | null;
  vendorAmount?: string | null;
  // R67 lane I (WS-I item I-03) / D-26: the other two thirds of Sumeet's
  // budget model, the material/manpower split of this line. Served by
  // VERIDIAN's BOQ GET and written by the same PATCH /api/scope/line-items/{id}
  // that carries vendorAmount and category. null means NOT COSTED and renders
  // as an en dash; "0" is a real, entered zero and renders as "AED 0.00".
  materialAmount?: string | null;
  manpowerAmount?: string | null;
};

export type Vendor = { id: string; vendorName: string };

export type ChangedLineItem = {
  key: string; previous: BoqLineItemRow; current: BoqLineItemRow;
  quantityChange: number; rateChange: number; breakdownPercentageChange: number; netVariation: number;
};

export type BoqComparison = {
  added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[];
  warnings: string[]; totalVariation: number;
};

export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

export const emptyLine = (): LineItemDraft => ({
  description: "", unit: "", quantity: "", rate: "", category: "", itemCode: "", parentItemCode: "", breakdownPercentage: "",
});

export function toDrafts(rows: BoqLineItemRow[]): LineItemDraft[] {
  const codeById = new Map<string, string>();
  const taken = new Set(rows.map((r) => r.itemCode?.trim()).filter((c): c is string => Boolean(c)));
  for (const r of rows) {
    const existing = r.itemCode?.trim();
    if (existing) { codeById.set(r.id, existing); continue; }
    let synth = `_row_${r.id}`;
    while (taken.has(synth)) synth = `${synth}_x`;
    taken.add(synth);
    codeById.set(r.id, synth);
  }
  return rows.map((row) => ({
    description: row.description,
    unit: row.unit,
    quantity: String(row.quantity),
    rate: String(row.rate),
    category: row.category ?? "",
    itemCode: codeById.get(row.id),
    activityId: row.activityId ?? undefined,
    parentItemCode: row.parentLineItemId ? codeById.get(row.parentLineItemId) : undefined,
    breakdownPercentage: row.breakdownPercentage != null ? String(row.breakdownPercentage) : undefined,
  }));
}

// R67 G-05 / D-74: these three used `toLocaleString(undefined, ...)`, which
// resolves to the RUNTIME's locale -- the deployment's on the server pass and
// the visitor's in the browser. Two different strings for one BOQ amount is a
// hydration mismatch, and neither of them is the organisation's form. They
// now all route through THE money module, so a BOQ line and a Materials cell
// on the same screen cannot disagree about how an amount is written.
//
// `pending: true` rather than an absent currency: these helpers are called
// both with a resolved code and without one, and an absent code would print
// the warning glyph in front of a figure whose currency the CALLER is showing
// separately (ScopeCompareClient prefixes the code itself). "We were not told
// here" is the honest state for a helper that takes the code as an argument.
export function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatMoney(amount, { pending: true })}`;
}

export function formatAmount(value: string | number | null | undefined): string {
  return formatMoney(value ?? 0, { pending: true });
}

// Deliberately NOT currencyLabel() from the shared helper: that returns a
// hardcoded rupee symbol when no base currency is found, which would be wrong
// on a UAE contractor's BOQ. Here an unresolved currency degrades to the bare
// number instead - no label is survivable, the wrong label is not.
export function withCurrency(code: string, value: string | number | null | undefined): string {
  return formatMoney(value ?? 0, { currency: code || null, pending: !code });
}

/**
 * A BOQ variance with its DIRECTION readable without colour -- "▲ AED +2,025".
 * The signed form the money module already owns; exported here so a BOQ screen
 * reaching for it does not write a fourth one.
 */
export function formatSignedAmount(code: string, value: number | string | null | undefined): string {
  return formatSignedMoney(value, { currency: code || null, pending: !code });
}

export function childPercentSum(lines: LineItemDraft[], parentItemCode?: string): number | null {
  const code = parentItemCode?.trim();
  if (!code) return null;
  const children = lines.filter((l) => l.parentItemCode?.trim() === code);
  if (children.length === 0) return null;
  return children.reduce((sum, l) => sum + (Number(l.breakdownPercentage) || 0), 0);
}

// Sumeet audit fix (2026-08-30, requirement #13: "Nested sub-task prices off
// the ROOT"). Walks the full parentLineItemId chain to the true root (no
// parentLineItemId at all) before reading quantity/rate, matching the real
// backend's own resolveRootAncestor() in construction-boq-service.ts.
// Set-based cycle guard mirrors that same function.
export function derivedSubQtyRate(row: BoqLineItemRow, allRows: BoqLineItemRow[]): { qty: number; rate: number } | null {
  if (row.breakdownPercentage == null) return null;
  const pct = Number(row.breakdownPercentage);
  if (!Number.isFinite(pct)) return null;

  let current: BoqLineItemRow | undefined = allRows.find((p) => p.id === row.parentLineItemId);
  if (!current) return null;
  const visited = new Set<string>([row.id]);
  while (current.parentLineItemId) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const next: BoqLineItemRow | undefined = allRows.find((p) => p.id === current!.parentLineItemId);
    if (!next) break;
    current = next;
  }

  const rootQty = Number(current.quantity);
  const rootRate = Number(current.rate);
  if (!Number.isFinite(rootQty) || !Number.isFinite(rootRate)) return null;
  return { qty: rootQty, rate: (rootRate * pct) / 100 };
}

// A weighted sub-task's amount is DERIVED from its parent (parent qty x
// parent rate x breakdown %), so it is already contained in the parent's
// amount. Summing every row flat double-counts the BOQ. Top-level rows only.
export function boqTotal(rows: BoqLineItemRow[]): number {
  return rows.filter((r) => !r.parentLineItemId).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
}

const val = (s: string | undefined) => (s ?? "").trim();

/**
 * R67 D-24. The line fields a human can be told to fix, and the ONE sentence
 * each one is told with. Rendered under the offending input on blur AND (via
 * missingBoqFields below) inside the primary's own disabled reason, so the two
 * can never say different things about the same empty box.
 */
export type LineField = "description" | "unit" | "quantity" | "rate" | "breakdownPercentage";

export const LINE_FIELD_MESSAGE: Record<LineField, string> = {
  description: "Enter a description, e.g. Blockwork - external walls",
  unit: "Enter the unit, e.g. sqm",
  quantity: "Enter the quantity",
  rate: "Enter the rate",
  breakdownPercentage: "Enter a breakdown % for this sub-task",
};

/** The short label the same field carries inside a "Line 2 is incomplete — add ..." sentence. */
export const LINE_FIELD_LABEL: Record<LineField, string> = {
  description: "Description",
  unit: "Unit",
  quantity: "Qty",
  rate: "Rate",
  breakdownPercentage: "Breakdown %",
};

export const TITLE_REQUIRED_MESSAGE = "Enter a title, e.g. Civil Works - Phase 1";

/** A row with NOTHING in it: ignorable. A row with ANY content is something a human meant. */
export function isUntouchedLine(l: LineItemDraft): boolean {
  return !val(l.description) && !val(l.unit) && !val(l.quantity) && !val(l.rate) &&
    !val(l.category) && !val(l.itemCode) && !val(l.parentItemCode) && !val(l.breakdownPercentage);
}

/**
 * A sub-task may leave Unit blank and inherit its parent's -- the real backend
 * derives a child's quantity/rate from its root, and the unit follows the same
 * chain. Returns "" when neither the line nor its named parent supplies one.
 */
export function unitForLine(lines: LineItemDraft[], index: number): string {
  const line = lines[index];
  const own = val(line?.unit);
  if (own) return own;
  const parentCode = val(line?.parentItemCode);
  if (!parentCode) return "";
  const parent = lines.find((p) => val(p.itemCode) === parentCode);
  return parent ? val(parent.unit) : "";
}

/**
 * Which fields of ONE line are still missing. A sub-line (one carrying a
 * Parent Item Code) needs a Breakdown % instead of Qty/Rate, because the
 * backend DERIVES a child's quantity and rate from its root ancestor
 * (construction-boq-service.ts's canonical child-rate rule) -- asking for them
 * would be asking for numbers that are then thrown away.
 */
export function lineMissingFields(lines: LineItemDraft[], index: number): LineField[] {
  const line = lines[index];
  if (!line) return [];
  const missing: LineField[] = [];
  if (!val(line.description)) missing.push("description");
  if (!unitForLine(lines, index)) missing.push("unit");
  if (val(line.parentItemCode)) {
    if (!val(line.breakdownPercentage)) missing.push("breakdownPercentage");
  } else {
    if (!val(line.quantity)) missing.push("quantity");
    if (!val(line.rate)) missing.push("rate");
  }
  return missing;
}

/**
 * R67 D-24. What the primary's disabled reason names, in the exact
 * "Save (Title, Line 1)" shape /labour/new already ships -- instead of an
 * enabled Save on an empty form that fails only after the click.
 *
 * Line 1 is always required (a BOQ screen with no usable line is not something
 * a user meant to save here); every later line is only named once it has been
 * touched, so "+ Add Line" never immediately disables Save.
 */
export function missingBoqFields(title: string, lines: LineItemDraft[]): string[] {
  const missing: string[] = [];
  if (!val(title)) missing.push("Title");
  lines.forEach((line, i) => {
    if (i > 0 && isUntouchedLine(line)) return;
    if (lineMissingFields(lines, i).length > 0) missing.push(`Line ${i + 1}`);
  });
  return missing;
}

// R47-003 (fault R47_SILENT_DROP_01): the distinction that matters is
// UNTOUCHED vs INCOMPLETE. A wholly blank row must stay ignorable; a row
// with ANY content is something a human meant, and dropping it silently is
// never the right answer. Returns the rows to submit, or a message naming
// the offending row.
export function collectLines(lines: LineItemDraft[]): { valid: LineItemDraft[]; error: string | null } {
  const valid: LineItemDraft[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isUntouchedLine(lines[i])) continue;
    // R67 D-24: the same lineMissingFields() the on-blur field messages and
    // the Save button's own reason read, so the three can never disagree.
    const missing = lineMissingFields(lines, i);
    if (missing.length > 0) {
      return { valid: [], error: `Line ${i + 1} is incomplete — add ${missing.map((f) => LINE_FIELD_LABEL[f]).join(", ")}. Nothing was saved.` };
    }
    valid.push({ ...lines[i], unit: unitForLine(lines, i) });
  }
  // Sumeet audit fix (2026-08-30, requirement #3): a submission where every
  // row is genuinely blank is a legitimate title-only, zero-line BOQ -- the
  // real backend explicitly allows this. Never an error.
  return { valid, error: null };
}

// ─── R67 lane D22 (item D-60, recs R-196/R-225) ───────────────────────────
// THE NEW-BOQ GRID, REBUILT FOR A QS. The create screen was a wall of
// placeholder-only inputs with no column headers, no Amount, no total, and a
// Save button that was always enabled and failed afterwards. A quantity
// surveyor building a BOQ needs to see the arithmetic as they type it and be
// told what a field is for BEFORE they get it wrong.
//
// All of it is pure and lives here, next to collectLines()'s own submission
// rules, so the grid and the save path can never disagree about what a
// complete line is.

const trimmed = (s: string | undefined) => (s ?? "").trim();

/**
 * The root ancestor of a draft row, following parentItemCode up the chain.
 *
 * The canonical child-rate rule (schema.ts, settled R45 seq7 / E-127) prices a
 * sub-task off the ROOT, not the immediate parent, and derivedSubQtyRate()
 * already implements that for PERSISTED rows. This is the same walk over
 * unsaved drafts, which are keyed by itemCode rather than by row id.
 * Returns null on a broken or circular chain rather than guessing.
 */
export function draftRootAncestor(line: LineItemDraft, lines: LineItemDraft[]): LineItemDraft | null {
  let current = line;
  const visited = new Set<string>();
  while (trimmed(current.parentItemCode)) {
    const code = trimmed(current.parentItemCode);
    if (visited.has(code)) return null; // circular: A parents B parents A
    visited.add(code);
    const parent = lines.find((l) => trimmed(l.itemCode) === code);
    if (!parent) return null; // dangling parent code -- the field message says so
    current = parent;
  }
  return current === line ? line : current;
}

/**
 * A draft row's Amount, or null when it cannot be computed yet.
 *
 * Root:  amount = qty x rate.
 * Child: amount = rootQty x (rootRate x breakdown%/100) -- identical to F4 in
 * schema.ts, so what the grid shows is what the server will store.
 */
export function draftLineAmount(line: LineItemDraft, lines: LineItemDraft[]): number | null {
  const root = draftRootAncestor(line, lines);
  if (!root) return null;
  const rootQty = Number(trimmed(root.quantity));
  const rootRate = Number(trimmed(root.rate));
  if (!trimmed(root.quantity) || !trimmed(root.rate) || !Number.isFinite(rootQty) || !Number.isFinite(rootRate)) return null;
  if (root === line) return rootQty * rootRate;
  const pct = Number(trimmed(line.breakdownPercentage));
  if (!trimmed(line.breakdownPercentage) || !Number.isFinite(pct)) return null;
  return rootQty * ((rootRate * pct) / 100);
}

/**
 * The running BOQ total: root lines only.
 *
 * A weighted sub-task's amount is contained in its parent's, so summing every
 * row flat double-counts the BOQ -- the same rule boqTotal() applies to saved
 * rows.
 */
export function draftBoqTotal(lines: LineItemDraft[]): number {
  return lines
    .filter((l) => !trimmed(l.parentItemCode))
    .reduce((sum, l) => sum + (draftLineAmount(l, lines) ?? 0), 0);
}

/** True when the row has content of any kind -- the same "untouched" test collectLines() uses. */
export function draftLineTouched(line: LineItemDraft): boolean {
  return !!(
    trimmed(line.description) || trimmed(line.unit) || trimmed(line.quantity) || trimmed(line.rate) ||
    trimmed(line.itemCode) || trimmed(line.parentItemCode) || trimmed(line.breakdownPercentage) || trimmed(line.category)
  );
}

/** The fields still missing from one draft row, in Sumeet's own column order. */
export function draftLineMissingFields(line: LineItemDraft, lines: LineItemDraft[]): string[] {
  const missing: string[] = [];
  if (!trimmed(line.description)) missing.push("Description");
  const isChild = !!trimmed(line.parentItemCode);
  // A sub-task inherits its unit from its parent, exactly as collectLines does.
  const unit = trimmed(line.unit) || (isChild ? trimmed(lines.find((l) => trimmed(l.itemCode) === trimmed(line.parentItemCode))?.unit) : "");
  if (!unit) missing.push("Unit");
  if (isChild) {
    if (!trimmed(line.breakdownPercentage)) missing.push("Breakdown %");
  } else {
    if (!trimmed(line.quantity)) missing.push("Qty");
    if (!trimmed(line.rate)) missing.push("Rate");
  }
  return missing;
}

/**
 * The reason the primary button is disabled, or null when it is not.
 *
 * On an untouched form this is exactly "Title, 1 line with Description, Qty,
 * Rate" -- the promise of the minimum a BOQ needs. Once a line HAS been
 * touched the sentence narrows to what that line is actually still missing, so
 * a QS who typed everything but the unit is told "1 line with Unit" rather
 * than being read the whole rule again.
 */
export function createBoqSaveDisabledReason(title: string, lines: LineItemDraft[]): string | null {
  const parts: string[] = [];
  if (!trimmed(title)) parts.push("Title");

  const touched = lines.filter(draftLineTouched);
  const anyComplete = touched.some((l) => draftLineMissingFields(l, lines).length === 0);
  if (!anyComplete) {
    if (touched.length === 0) {
      parts.push("1 line with Description, Qty, Rate");
    } else {
      // The row closest to being usable is the one worth naming.
      const closest = touched
        .map((l) => draftLineMissingFields(l, lines))
        .sort((a, b) => a.length - b.length)[0]!;
      parts.push(`1 line with ${closest.join(", ")}`);
    }
  }
  return parts.length ? parts.join(", ") : null;
}

/**
 * What to say at a field once the user leaves it.
 *
 * Only ever about THIS row's own hierarchy fields, and only once they have
 * been filled in -- an empty Parent code is not an error, it is the normal
 * case for a root line.
 */
export function draftLineFieldMessages(line: LineItemDraft, lines: LineItemDraft[]): { field: "parentItemCode" | "breakdownPercentage"; text: string }[] {
  const messages: { field: "parentItemCode" | "breakdownPercentage"; text: string }[] = [];
  const parentCode = trimmed(line.parentItemCode);
  if (!parentCode) return messages;

  if (parentCode === trimmed(line.itemCode)) {
    messages.push({ field: "parentItemCode", text: "A line cannot be its own parent" });
  } else if (!lines.some((l) => trimmed(l.itemCode) === parentCode)) {
    messages.push({ field: "parentItemCode", text: `No line has Item Code ${parentCode}` });
  } else if (!draftRootAncestor(line, lines)) {
    messages.push({ field: "parentItemCode", text: `Item Code ${parentCode} is part of a loop of parents` });
  }

  if (!trimmed(line.breakdownPercentage)) {
    messages.push({ field: "breakdownPercentage", text: "Enter the % of the parent this sub-task carries" });
  }
  return messages;
}

/** "children total 75% of 100%", or null when this line has no children. */
export function childPercentNote(lines: LineItemDraft[], itemCode: string | undefined): string | null {
  const sum = childPercentSum(lines, itemCode);
  if (sum === null) return null;
  return `children total ${Number(sum.toFixed(2))}% of 100%`;
}

export function toPayloadLineItems(validLines: LineItemDraft[]) {
  return validLines.map((l) => ({
    description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate),
    ...(l.category?.trim() ? { category: l.category.trim() } : {}),
    ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}),
    ...(l.activityId ? { activityId: l.activityId } : {}),
    ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
    ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
  }));
}
