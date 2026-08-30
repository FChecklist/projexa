// Shared BOQ (Scope of Work) types + pure helper functions, extracted so the
// real-screen conversion (List/Object/Create/Revise/Compare, 2026-08-30) can
// share ONE copy of this logic instead of five independent re-implementations
// drifting apart. Every function here is pure (no fetch, no React state) --
// matches this codebase's own established convention of keeping business
// logic independently testable from the DB/network layer.

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
  itemCode?: string; activityId?: string; parentItemCode?: string; breakdownPercentage?: string;
};

export type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
  // R39/R-C09: Point 154's budget overlay -- computedBudget is derived
  // server-side (amount * budgetPercentage / 100, construction-boq-
  // service.ts#computedBudget), never sent back independently editable.
  budgetPercentage?: string | null;
  computedBudget?: number | null;
  vendorId?: string | null;
  vendorAmount?: string | null;
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
  description: "", unit: "", quantity: "", rate: "", itemCode: "", parentItemCode: "", breakdownPercentage: "",
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
    itemCode: codeById.get(row.id),
    activityId: row.activityId ?? undefined,
    parentItemCode: row.parentLineItemId ? codeById.get(row.parentLineItemId) : undefined,
    breakdownPercentage: row.breakdownPercentage != null ? String(row.breakdownPercentage) : undefined,
  }));
}

export function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatAmount(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value ?? "");
}

// Deliberately NOT currencyLabel() from the shared helper: that returns a
// hardcoded rupee symbol when no base currency is found, which would be wrong
// on a UAE contractor's BOQ. Here an unresolved currency degrades to the bare
// number instead - no label is survivable, the wrong label is not.
export function withCurrency(code: string, value: string | number | null | undefined): string {
  const n = formatAmount(value);
  return code ? `${code} ${n}` : n;
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

// R47-003 (fault R47_SILENT_DROP_01): the distinction that matters is
// UNTOUCHED vs INCOMPLETE. A wholly blank row must stay ignorable; a row
// with ANY content is something a human meant, and dropping it silently is
// never the right answer. Returns the rows to submit, or a message naming
// the offending row.
export function collectLines(lines: LineItemDraft[]): { valid: LineItemDraft[]; error: string | null } {
  const val = (s: string | undefined) => (s ?? "").trim();
  const isUntouched = (l: LineItemDraft) =>
    !val(l.description) && !val(l.unit) && !val(l.quantity) && !val(l.rate) &&
    !val(l.itemCode) && !val(l.parentItemCode) && !val(l.breakdownPercentage);

  const unitFor = (l: LineItemDraft): string => {
    const own = val(l.unit);
    if (own) return own;
    const parentCode = val(l.parentItemCode);
    if (!parentCode) return "";
    const parent = lines.find((p) => val(p.itemCode) === parentCode);
    return parent ? val(parent.unit) : "";
  };

  const missingFrom = (l: LineItemDraft): string[] => {
    const missing: string[] = [];
    if (!val(l.description)) missing.push("Description");
    if (!unitFor(l)) missing.push("Unit");
    if (val(l.parentItemCode)) {
      if (!val(l.breakdownPercentage)) missing.push("Breakdown %");
    } else {
      if (!val(l.quantity)) missing.push("Qty");
      if (!val(l.rate)) missing.push("Rate");
    }
    return missing;
  };

  const valid: LineItemDraft[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isUntouched(lines[i])) continue;
    const missing = missingFrom(lines[i]);
    if (missing.length > 0) {
      return { valid: [], error: `Line ${i + 1} is incomplete — add ${missing.join(", ")}. Nothing was saved.` };
    }
    valid.push({ ...lines[i], unit: unitFor(lines[i]) });
  }
  // Sumeet audit fix (2026-08-30, requirement #3): a submission where every
  // row is genuinely blank is a legitimate title-only, zero-line BOQ -- the
  // real backend explicitly allows this. Never an error.
  return { valid, error: null };
}

export function toPayloadLineItems(validLines: LineItemDraft[]) {
  return validLines.map((l) => ({
    description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate),
    ...(l.itemCode?.trim() ? { itemCode: l.itemCode.trim() } : {}),
    ...(l.activityId ? { activityId: l.activityId } : {}),
    ...(l.parentItemCode?.trim() ? { parentItemCode: l.parentItemCode.trim() } : {}),
    ...(l.breakdownPercentage?.trim() ? { breakdownPercentage: Number(l.breakdownPercentage) } : {}),
  }));
}
