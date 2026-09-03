// MERGE NOTE (2026-09-03). Two items landed a module at this path in the same
// wave and they are not the same concern, so this file carries both:
//   * R67 E-05's client-side FORMATTING, tie check and CSV for the Cost Report
//     screen (below). The report itself is computed server-side, because a
//     period, a vendor join and the voided-receipt exclusion are not things a
//     browser can derive from the rows it happens to hold.
//   * R67 F-07's buildMaterialCostReport (further down) -- the pure roll-up
//     that lets a screen show an unfiltered total without a request.
// Neither shadows the other: different types, different functions, one file.

// R67 E-05 (R-103): the Material Cost Report's client-side rules.
//
// The arithmetic itself is compliance-tracker's (aggregateMaterialCostReport)
// -- this file never re-adds a column, because a second summation path is
// exactly how a screen and its export come to disagree. What lives here is
// what the SCREEN owes the reader: the tie check that decides whether Export
// may be offered at all, the CSV built from the rows actually on screen, and
// the empty-range sentence.

export type MaterialCostReportGroupBy = "material" | "vendor";

export type MaterialCostRow = {
  key: string;
  materialId: string | null;
  name: string;
  spec: string | null;
  vendorId: string | null;
  vendorName: string | null;
  unit: string | null;
  totalQuantityReceived: number;
  totalCost: number;
  averageUnitCost: number;
  masterUnitCost: number | null;
  variance: number | null;
};

export type MaterialCostReport = {
  rows: MaterialCostRow[];
  totals: { quantity: number; cost: number };
  params: { projectId: string; from: string | null; to: string | null; groupBy: MaterialCostReportGroupBy };
};

/** DD-MM-YYYY, the shape the empty-range sentence uses. A slice, so no timezone can move the day. */
export function dmy(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * "No receipts between 01-01-2026 and 02-09-2026 - widen the range", never a
 * blank card. A reader who sees nothing cannot tell an empty range from a
 * broken screen; this sentence tells them which, and what to do.
 */
export function emptyRangeMessage(from: string | null, to: string | null): string {
  const f = dmy(from);
  const t = dmy(to);
  if (f && t) return `No receipts between ${f} and ${t} — widen the range`;
  if (f) return `No receipts on or after ${f} — widen the range`;
  if (t) return `No receipts on or before ${t} — widen the range`;
  // No window at all: nothing has been received on this project, which is a
  // different fact from "nothing in the window you chose" and gets the
  // sentence that says how the report fills in.
  return "No receipts to report yet — the Cost Report fills in as receipts are recorded";
}

/**
 * R67 E-18 (R-178): what this document is CALLED in a WhatsApp message, in a
 * copied-link toast and in the "PDF ready" line -- so the recipient can tell
 * one exported cost report from another without opening it. The period is part
 * of the name because two files with the same name and different windows is
 * exactly how a wrong figure gets quoted in a meeting.
 */
export function costReportTitle(from: string | null, to: string | null): string {
  const f = dmy(from);
  const t = dmy(to);
  if (f && t) return `Material Cost Report ${f} to ${t}`;
  if (f) return `Material Cost Report from ${f}`;
  if (t) return `Material Cost Report to ${t}`;
  return "Material Cost Report — every receipt on record";
}

/**
 * The arithmetic identity a QS checks by hand: the rows on screen must sum to
 * the Grand Total under them. If they do not, the report is wrong and must say
 * so LOUDLY rather than render quietly -- and Export is disabled with that as
 * the stated reason, because a wrong file outlives a wrong screen.
 *
 * Returns null when the totals tie, or the sentence to show when they do not.
 * The one-cent tolerance is for float noise, not for a real discrepancy.
 */
export function checkMaterialCostTies(report: MaterialCostReport, money: (n: number) => string): string | null {
  // Defensive on SHAPE, not on arithmetic. A deploy can briefly put an older
  // response in front of a newer screen, and the honest failure for that is
  // "no tie check ran", never a white screen where a report should be: this
  // function is called during render, so a throw here takes the whole tab
  // down. A genuinely mismatched total still returns its sentence below.
  const rows = Array.isArray(report?.rows) ? report.rows : null;
  const stated = report?.totals?.cost;
  if (!rows || typeof stated !== "number") return null;
  const rowSum = rows.reduce((s, r) => s + r.totalCost, 0);
  if (Math.abs(rowSum - stated) <= 0.01) return null;
  return `The rows on screen add up to ${money(rowSum)} but the Grand Total reads ${money(stated)}. Export is disabled until this is fixed.`;
}

const CSV_HEADERS = [
  "Material", "Spec", "Vendor", "Unit", "Qty Received", "Total Cost", "Avg Unit Cost", "Master Unit Cost", "Variance",
] as const;

/**
 * OWASP CSV/formula injection: a cell starting with =, +, - or @ is executed
 * as a formula when the file is opened. Material and vendor names are
 * user-typed free text, so every cell gets the standard leading-apostrophe
 * mitigation -- the same guard compliance-tracker's report-export-shared.ts
 * applies to the server-rendered exports, restated here because this CSV is
 * built in the browser from the rows on screen and never passes through it.
 */
export function csvEscape(value: string | number | null): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–";

/**
 * CSV from the rows ON SCREEN, per the item -- so what a reader exports is
 * what they were looking at, filters and grouping included. The caption line
 * comes first, so the file states its own period and grouping and cannot be
 * mistaken for a different run.
 */
export function buildMaterialCostCsv(report: MaterialCostReport): string {
  const caption = `Material Cost Report · ${dmy(report.params.from) ?? "all time"} to ${dmy(report.params.to) ?? "today"} · grouped by ${report.params.groupBy}`;
  const lines = [
    csvEscape(caption),
    CSV_HEADERS.join(","),
    ...report.rows.map((r) =>
      [
        csvEscape(r.name),
        csvEscape(r.spec ?? EMPTY),
        csvEscape(r.vendorName ?? EMPTY),
        csvEscape(r.unit ?? EMPTY),
        r.totalQuantityReceived,
        r.totalCost,
        r.averageUnitCost,
        r.masterUnitCost === null ? EMPTY : r.masterUnitCost,
        r.variance === null ? EMPTY : r.variance,
      ].join(",")
    ),
    // The Grand Total travels WITH the rows it totals -- a file whose reader
    // has to re-add the column is the defect this report exists to fix.
    ["Grand Total", "", "", "", report.totals.quantity, report.totals.cost, "", "", ""].join(","),
  ];
  return lines.join("\n");
}

/**
 * The period the report opens on, so it runs by pressing nothing.
 *
 * The item words this as "project start -> today". PROJEXA does not have the
 * project's start date: the org dashboard payload it resolves projects from
 * carries id and name only (src/lib/project-selection.ts), and inventing a
 * start date would be worse than not having one. An OPEN lower bound is what
 * "from the project's start" actually means for a project whose start we were
 * never told -- every receipt this project has, up to today -- rather than a
 * month-to-date window that would show an empty report for a project whose
 * deliveries were last month and make a real ledger look empty.
 *
 * The From field is therefore blank on arrival and says so in words; typing
 * one narrows the range.
 */
export function defaultCostReportRange(today: Date = new Date()): { from: string; to: string } {
  return { from: "", to: today.toISOString().slice(0, 10) };
}

// R67 F-07 (R-100/R-106). The Cost Report tab used to cost a THIRD hot-path
// request: /materials fetched the master, the receipts AND
// /api/construction-materials/cost-report on mount, all behind one flag, for a
// two-row table. But the cost report is a pure roll-up of the receipts the
// screen has already loaded -- there is nothing in it the browser does not
// already hold.
//
// So the on-screen tab derives it here, and the server endpoint stays for the
// exportable report (C03-14), which needs to run without a loaded page.
//
// *** THE ARITHMETIC MATCHES construction-materials-service.ts#getMaterialCostReport
// EXACTLY, AND THAT IS THE POINT. *** Two screens showing different totals
// under the same label is the defect class this programme is removing, so this
// is a re-expression of that SQL, not a second opinion:
//
//   totalQuantityReceived = sum(quantity)                 -- every receipt
//   totalCost             = sum(quantity * unitCost)      -- SQL sum() skips
//                                                            NULLs, so a
//                                                            receipt with no
//                                                            stated unit cost
//                                                            adds quantity but
//                                                            no cost
//   averageUnitCost       = totalCost / totalQuantityReceived, 0 when there is
//                           no quantity
//   both money figures rounded to 2 dp, the same way and at the same step
//   only materials that actually have receipts appear (the SQL GROUP BY)
//
// NOTE ON THE ITEM'S OWN WORDING. R67 F-07 describes the cost as
// "quantity x (unitCost ?? master.unitCost)". That fallback is deliberately
// NOT implemented: the server-side report -- the one a user exports and sends
// on -- does not do it, so adopting it here would make the number on screen
// disagree with the number in the export for any receipt booked without a
// price. If the fallback is the behaviour the business wants, it belongs in
// getMaterialCostReport() first, and both sides move together.
//
// The one deliberate difference is ordering: the SQL has no ORDER BY, so its
// row order is whatever Postgres returns. This sorts by material name, which
// is stable and readable, and changes no value.

export type CostReportMaterial = { id: string; name: string; spec: string | null; unit: string };
export type CostReportReceipt = { materialId: string; quantity: string | number; unitCost: string | number | null };

export type CostReportRow = {
  materialId: string;
  name: string;
  spec: string | null;
  unit: string;
  totalQuantityReceived: number;
  totalCost: number;
  averageUnitCost: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildMaterialCostReport(
  materials: CostReportMaterial[],
  receipts: CostReportReceipt[]
): CostReportRow[] {
  if (receipts.length === 0) return [];

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const totals = new Map<string, { quantity: number; cost: number }>();

  for (const receipt of receipts) {
    const quantity = toNumber(receipt.quantity) ?? 0;
    const unitCost = toNumber(receipt.unitCost);
    const running = totals.get(receipt.materialId) ?? { quantity: 0, cost: 0 };
    running.quantity += quantity;
    // NULL unit cost contributes no cost -- exactly what SQL's
    // sum(quantity * unitCost) does with a NULL factor.
    //
    // A DELIBERATE DEVIATION FROM THE R67 F-07 ITEM, recorded here rather than
    // only in a PR body. F-07 specifies the derived cost as
    // `quantity x (unitCost ?? master.unitCost)`. That fallback is NOT applied,
    // because compliance-tracker's getMaterialCostReport() -- the aggregation
    // behind the EXPORTABLE report, construction-materials-service.ts:107 --
    // does a plain `sum(quantity * unit_cost)` with no fallback. Adopting the
    // fallback on the screen alone would make the Cost Report tab and its own
    // export show different totals under the same heading for any receipt
    // booked without a price, which is a worse fault than the one it fixes.
    //
    // If the fallback is the wanted behaviour it belongs in the SERVICE first,
    // so the screen and the export move together -- and that is a change to a
    // shipped money report's figures, which needs its own decision, its own
    // test and its own API_CHANGELOG entry. Owner call, not a lane call.
    if (unitCost !== null) running.cost += quantity * unitCost;
    totals.set(receipt.materialId, running);
  }

  return [...totals.entries()]
    .map(([materialId, { quantity, cost }]) => {
      const material = materialById.get(materialId);
      const totalCost = round2(cost);
      return {
        materialId,
        // Same honest fallback the service uses: an unresolvable material is
        // named by its id rather than shown as blank or dropped.
        name: material?.name ?? materialId,
        spec: material?.spec ?? null,
        unit: material?.unit ?? "",
        totalQuantityReceived: quantity,
        totalCost,
        averageUnitCost: quantity > 0 ? round2(totalCost / quantity) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
