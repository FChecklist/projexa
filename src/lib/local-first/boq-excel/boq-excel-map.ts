// BOQ spreadsheet -> BOQ lines, ON THE LAPTOP (Sumeet R-70, R-71, R-72; checklist 3.1).
//
// THIS IS THE SERVER'S IMPORT RULE SET, carried over so that the lines the laptop proposes are the lines the server's own importer would make from the
// same file. Source of truth: compliance-tracker src/lib/services/construction-boq-import-service.ts (mapBoqHeaders, mapRowsToLineItems, toPreviewRows)
// and src/lib/gst/column-mapper.ts (parseAmount). The rules, each with a test in boq-excel-import.test.ts:
//   R-72  the column headers are matched by alias, in priority order, one column per field ("Sl No", "Description (Task)", "Sub Task", "Qty", "Rate",
//         "Breakdown %", "Category", "Parent Code" ...);
//   R-71  a row with a Qty or Rate that is present but not a number is SKIPPED AND NAMED BY ROW, blocking (never imported as a silent zero); a row with no
//         description is skipped; a category-header row (a description with no Qty, no Rate, no Sub Task, no Parent code) is skipped and named;
//         a root row with a blank Qty or Rate is skipped and named; a repeated Item Code is blocking;
//   R-70  a sub-task is a row with a Sub Task value or a Parent code: its parent is the explicit Parent code, else the dotted prefix of its Item Code
//         ("2.1" under "2"), else the nearest preceding task row (a row with no Sl No gets a plain generated code LI-0001, so it can anchor its own
//         sub-tasks); it inherits its parent's category; its own Qty and Rate are not asked for (the root's are used); a Breakdown % stored as a fraction
//         (0.3) is read as 30;
//   the amount is ALWAYS quantity x rate; a printed Amount that disagrees is reported (non-blocking) and the recomputed value is the one used.
// Row numbers are 1-based over the sheet, header included (the first data row is "Row 2"), as in the server's messages.
// What the laptop adds: a sub-task with no Breakdown % is reported as blocking (the server refuses it on save), so the person sees it before saving.

import type { LineItemDraft } from "@/lib/boq-helpers";

export type BoqFieldKey = "itemCode" | "parentItemCode" | "description" | "subTask" | "unit" | "quantity" | "rate" | "breakdownPercentage" | "amount" | "category";
export type BoqColumnMapping = Partial<Record<BoqFieldKey, string>>;
export type BoqRowIssue = { row: number; message: string; blocking: boolean };

// Alias order within a field is a PRIORITY order; the field order below is load-bearing (category last, so a sheet with both a Description and a Category
// column gives the Description to `description`), exactly as on the server.
export const BOQ_FIELD_ALIASES: Record<BoqFieldKey, string[]> = {
  itemCode: ["s no", "sno", "sl no", "sr no", "item code", "code", "item no", "bill no"],
  parentItemCode: ["parent code", "parent item code", "main item code", "main item"],
  description: ["description", "description task", "particulars", "item description", "scope of work", "scope", "category"],
  subTask: ["sub task", "subtask", "sub-task"],
  unit: ["unit", "uom", "unit of measure"],
  quantity: ["qty", "quantity"],
  rate: ["rate", "unit rate", "unit price"],
  breakdownPercentage: ["breakdown %", "breakdown percentage", "break up %", "break-up %", "split %"],
  amount: ["amount", "amt", "value"],
  category: ["category", "work category", "trade", "section"],
};

export class BoqMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoqMapError";
  }
}

const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ");

export function mapBoqHeaders(headers: string[]): BoqColumnMapping {
  const mapping: BoqColumnMapping = {};
  const used = new Set<string>();
  for (const field of Object.keys(BOQ_FIELD_ALIASES) as BoqFieldKey[]) {
    let match: string | undefined;
    for (const alias of BOQ_FIELD_ALIASES[field]) {
      match = headers.find((h) => !used.has(h) && normalizeHeader(h) === alias);
      if (match) break;
    }
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

/** parseAmount of the server: commas, the rupee sign and spaces removed, a leading currency token removed, (100) read as -100; garbage reads as 0. */
export function parseAmount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value)
    .replace(/[,₹\s]/g, "")
    .replace(/^[^\d.\-(]+/, "")
    .replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** A cell that is present but is not a number in any shape parseAmount accepts ("TBD", "not-a-number"). Blank is not malformed. */
export function isMalformedNumericCell(raw: string): boolean {
  if (raw === "") return false;
  const cleaned = raw.replace(/[,₹\s]/g, "").replace(/^[^\d.\-(]+/, "").replace(/^\((.*)\)$/, "-$1");
  return !/^-?\d+(\.\d+)?$/.test(cleaned);
}

export type ImportedLine = {
  itemCode?: string;
  parentItemCode?: string;
  breakdownPercentage?: number;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  category?: string;
  /** The sheet row it came from (1-based, header = row 1). */
  sheetRow: number;
};

type Rec = Record<string, string | null | undefined>;

export function mapRowsToLines(rows: Rec[], mapping: BoqColumnMapping): { lines: ImportedLine[]; warnings: string[]; issues: BoqRowIssue[] } {
  if (!mapping.description && !mapping.subTask) throw new BoqMapError("Could not find a Description column in this spreadsheet.");
  if (!mapping.quantity) throw new BoqMapError("Could not find a Quantity column in this spreadsheet.");
  if (!mapping.rate) throw new BoqMapError("Could not find a Rate column in this spreadsheet.");

  const warnings: string[] = [];
  const issues: BoqRowIssue[] = [];
  const say = (row: number, message: string, blocking: boolean, warn: string = message) => {
    warnings.push(warn);
    issues.push({ row, message, blocking });
  };
  type Raw = { itemCode?: string; explicitParentCode?: string; description: string; unit: string; quantity: number; rate: number; breakdownPercentage?: number; isUnlabeledSubTask: boolean; category?: string; sheetRow: number };
  const raw: Raw[] = [];
  const cell = (row: Rec, key: string | undefined) => (key ? String(row[key] ?? "").trim() : "");

  rows.forEach((row, idx) => {
    const sheetRow = idx + 2;
    const descriptionRaw = cell(row, mapping.description);
    const subTaskRaw = cell(row, mapping.subTask);
    const description = descriptionRaw || subTaskRaw;
    if (!description) return say(sheetRow, `Row ${sheetRow}: skipped (no description)`, false);
    const quantityRaw = cell(row, mapping.quantity);
    const rateRaw = cell(row, mapping.rate);
    const parentCodeRaw = cell(row, mapping.parentItemCode);
    if (descriptionRaw && !subTaskRaw && !parentCodeRaw && quantityRaw === "" && rateRaw === "") {
      return say(sheetRow, `Row ${sheetRow}: skipped (category header: "${descriptionRaw}")`, false);
    }
    if (isMalformedNumericCell(quantityRaw)) return say(sheetRow, `Row ${sheetRow}: Qty is not a number`, true, `Row ${sheetRow}: skipped (Quantity "${quantityRaw}" is not a number)`);
    if (isMalformedNumericCell(rateRaw)) return say(sheetRow, `Row ${sheetRow}: Rate is not a number`, true, `Row ${sheetRow}: skipped (Rate "${rateRaw}" is not a number)`);
    const isSubTaskRow = !!subTaskRaw || !!parentCodeRaw;
    if (!isSubTaskRow) {
      if (rateRaw === "") return void warnings.push(`Row ${sheetRow}: Rate is blank`);
      if (quantityRaw === "") return void warnings.push(`Row ${sheetRow}: Qty is blank`);
    }
    const itemCode = cell(row, mapping.itemCode) || undefined;
    const explicitParentCode = parentCodeRaw || undefined;
    const unit = cell(row, mapping.unit);
    const quantity = parseAmount(row[mapping.quantity!]);
    const rate = parseAmount(row[mapping.rate!]);
    const bpRaw = mapping.breakdownPercentage ? parseAmount(row[mapping.breakdownPercentage]) : undefined;
    // a percentage cell stored as a fraction (30% -> 0.3) is read as the whole number the rest of the app uses
    const breakdownPercentage = bpRaw !== undefined && bpRaw > 0 && bpRaw <= 1 ? bpRaw * 100 : bpRaw;
    const isUnlabeledSubTask = !descriptionRaw && !!subTaskRaw;
    const printed = cell(row, mapping.amount);
    if (printed && !isUnlabeledSubTask) {
      const printedAmount = parseAmount(row[mapping.amount!]);
      const recomputed = quantity * rate;
      if (Math.abs(recomputed - printedAmount) > 1e-6) {
        say(sheetRow, `Row ${sheetRow}: printed amount ${printedAmount} does not match quantity x rate (${recomputed}) -- the recomputed value was used`, false);
      }
    }
    const category = cell(row, mapping.category) || undefined;
    raw.push({ itemCode, explicitParentCode, description, unit, quantity, rate, breakdownPercentage: breakdownPercentage || undefined, isUnlabeledSubTask, category, sheetRow });
  });

  const firstRowByCode = new Map<string, number>();
  for (const item of raw) {
    const code = item.itemCode?.trim();
    if (!code) continue;
    const first = firstRowByCode.get(code);
    if (first === undefined) firstRowByCode.set(code, item.sheetRow);
    else issues.push({ row: item.sheetRow, message: `Row ${item.sheetRow}: duplicate Item Code "${code}" (first used on row ${first})`, blocking: true });
  }
  const allItemCodes = new Set(raw.filter((i) => i.itemCode).map((i) => i.itemCode!.trim()));

  let lastItemCode: string | undefined;
  const categoryByResolvedCode = new Map<string, string>();
  const lines: ImportedLine[] = raw.map((i, idx) => {
    let parentItemCode = i.explicitParentCode;
    if (!parentItemCode && i.itemCode) {
      const lastDot = i.itemCode.lastIndexOf(".");
      if (lastDot > 0) {
        const prefix = i.itemCode.slice(0, lastDot);
        if (allItemCodes.has(prefix)) parentItemCode = prefix;
      }
    }
    if (!parentItemCode && !i.itemCode && i.isUnlabeledSubTask && i.breakdownPercentage != null && lastItemCode) parentItemCode = lastItemCode;
    let resolvedItemCode = i.itemCode;
    if (!resolvedItemCode && !i.isUnlabeledSubTask) resolvedItemCode = `LI-${String(idx + 1).padStart(4, "0")}`;
    if (resolvedItemCode) lastItemCode = resolvedItemCode;
    let category = i.category;
    if (!category && parentItemCode) category = categoryByResolvedCode.get(parentItemCode);
    if (resolvedItemCode && category) categoryByResolvedCode.set(resolvedItemCode, category);
    return {
      itemCode: resolvedItemCode, parentItemCode, breakdownPercentage: parentItemCode ? i.breakdownPercentage : undefined,
      description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate, ...(category ? { category } : {}), sheetRow: i.sheetRow,
    };
  });

  // what the server refuses on save, told now: a sub-task needs its Breakdown %
  for (const l of lines) {
    if (l.parentItemCode && l.breakdownPercentage === undefined) {
      issues.push({ row: l.sheetRow, message: `Row ${l.sheetRow}: sub-task "${l.description}" has no Breakdown %`, blocking: true });
    }
  }
  return { lines, warnings, issues };
}

export type PreviewRow = { row: number; category: string | null; code: string | null; description: string; unit: string; quantity: number; rate: number; amount: number; parentItemCode: string | null; breakdownPercentage: number | null };

/** What will be SAVED, not what the sheet printed: a sub-task's quantity is its root's and its rate is the root's rate x its Breakdown %. */
export function toPreviewRows(lines: ImportedLine[]): PreviewRow[] {
  const byCode = new Map(lines.filter((l) => l.itemCode).map((l) => [l.itemCode!, l]));
  const rootOf = (item: ImportedLine): ImportedLine => {
    let current = item;
    const seen = new Set<string>();
    while (current.parentItemCode) {
      if (current.itemCode) {
        if (seen.has(current.itemCode)) return current;
        seen.add(current.itemCode);
      }
      const parent = byCode.get(current.parentItemCode);
      if (!parent) return current;
      current = parent;
    }
    return current;
  };
  return lines.map((l) => {
    const root = l.parentItemCode ? rootOf(l) : l;
    const quantity = l.parentItemCode ? root.quantity : l.quantity;
    const rate = l.parentItemCode && l.breakdownPercentage != null ? root.rate * (l.breakdownPercentage / 100) : l.rate;
    return {
      row: l.sheetRow, category: l.category ?? null, code: l.itemCode ?? null, description: l.description, unit: l.unit, quantity, rate,
      amount: quantity * rate, parentItemCode: l.parentItemCode ?? null, breakdownPercentage: l.breakdownPercentage ?? null,
    };
  });
}

const text = (n: number): string => String(Number(n.toPrecision(15)));

/** The lines as the New BOQ grid holds them (strings). A sub-task leaves Qty and Rate blank: they are derived from its root. */
export function toDrafts(lines: ImportedLine[]): LineItemDraft[] {
  return lines.map((l) => ({
    description: l.description,
    unit: l.unit,
    quantity: l.parentItemCode ? "" : text(l.quantity),
    rate: l.parentItemCode ? "" : text(l.rate),
    ...(l.category ? { category: l.category } : {}),
    itemCode: l.itemCode ?? "",
    parentItemCode: l.parentItemCode ?? "",
    breakdownPercentage: l.breakdownPercentage !== undefined ? text(l.breakdownPercentage) : "",
  }));
}
