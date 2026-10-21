// GUIDED ERRORS, GROUP G1 (projects, Scope of Work / BOQ, import, baseline, budget): every fault a person can make with their OWN hands, found by
// the form itself before anything is sent, as a plain value: which guide (`code`), which input (`field`, a DOM id the highlight can find), and the
// one complete sentence. Pure, no React, no network -- so each rule is unit-tested and the online and the on-laptop screens cannot disagree.
//
// A Fault becomes the panel through `faultError()` -> contextFromError(...): the catalogue (catalogue/boq.ts, project.ts, import.ts) has one guide per
// `code`, and because those guides are source "validation" the framework sends the person to `field` on the SAME screen (resolveGuide).
//
// The ids the BOQ grid answers to, on BOTH the online screens and the laptop screens:
//   boq-title                         the title box
//   boq-line-<i>-<column>             column = description | unit | quantity | rate | itemCode | parentItemCode | breakdownPercentage   (i from 0)

import { draftRootAncestor, isUntouchedLine, unitForLine, type LineItemDraft } from "@/lib/boq-helpers";
import type { SubmitFailure } from "@/lib/use-submit";

export type Fault = {
  /** The catalogue guide this is: matched on GuideContext.code. */
  code: string;
  /** The message in full: what is wrong and where, in the words a site manager uses. */
  message: string;
  /** DOM id (or data-testid / name) of the input to take the person to. */
  field?: string;
  /** 1-based line number, when the fault is about one line of a BOQ. */
  line?: number;
};

/** An Error carrying the guide's code, ready for contextFromError(err, { field }). */
export function faultError(f: Fault): Error & { code: string; field?: string } {
  return Object.assign(new Error(f.message), { code: f.code, field: f.field });
}

const trim = (s: string | undefined | null) => (s ?? "").trim();

export const BOQ_TITLE_ID = "boq-title";
export const boqLineId = (index: number, column: BoqColumn): string => `boq-line-${index}-${column}`;
export type BoqColumn = "description" | "unit" | "quantity" | "rate" | "itemCode" | "parentItemCode" | "breakdownPercentage";

/** A quantity or a rate above this is a typed-in-the-wrong-place figure (a phone number, an extra pair of zeros), not a bill of quantities line. */
export const BOQ_NUMBER_LIMIT = 1_000_000_000_000;
export const BOQ_DESCRIPTION_LIMIT = 2000;
export const BOQ_UNIT_LIMIT = 40;
export const PROJECT_NAME_LIMIT = 200;

/** "12,500" and " 12 500 " are numbers to a person; to the server they are not. Returns NaN for anything that is not plain digits. */
export function plainNumber(raw: string | undefined | null): number {
  const t = trim(raw);
  if (t === "") return NaN;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

function numberFault(label: string, n: number, line: number, field: string, raw: string): Fault | null {
  if (!Number.isFinite(n)) {
    const hint = /[,\s]/.test(trim(raw)) ? " Remove commas and spaces: type 12500, not 12,500." : "";
    return { code: "BOQ_LINE_NUMBER_INVALID", line, field, message: `Line ${line}: ${label} "${trim(raw)}" is not a number.${hint} Nothing was saved.` };
  }
  if (n < 0) return { code: "BOQ_LINE_NUMBER_INVALID", line, field, message: `Line ${line}: ${label} cannot be negative (you typed ${trim(raw)}). Use zero or more. Nothing was saved.` };
  if (n > BOQ_NUMBER_LIMIT) {
    return { code: "BOQ_LINE_NUMBER_INVALID", line, field, message: `Line ${line}: ${label} ${trim(raw)} is too large to be a real figure (the limit is 1,000,000,000,000). Check for extra zeros. Nothing was saved.` };
  }
  return null;
}

/**
 * Every fault in a BOQ the person typed, in the order they read it (title first, then line by line). An untouched row is ignored; a BOQ with only a
 * title is legitimate. Rules are the server's (construction-boq-service.ts), plus the ones the server lets through silently but that are always a
 * mistake: a share over 100 %, a quantity that is a phone number.
 */
export function boqDraftFaults(title: string, lines: LineItemDraft[], opts: { titleLabel?: string } = {}): Fault[] {
  const out: Fault[] = [];
  if (!trim(title)) {
    out.push({ code: "BOQ_TITLE_REQUIRED", field: BOQ_TITLE_ID, message: `The ${opts.titleLabel ?? "BOQ"} has no title. Type a title, for example "Civil Works - Phase 1". Nothing was saved.` });
  }

  const seenCodes = new Map<string, number>();
  lines.forEach((line, i) => {
    if (isUntouchedLine(line)) return;
    const n = i + 1;
    const sub = Boolean(trim(line.parentItemCode));

    if (!trim(line.description)) {
      out.push({ code: "BOQ_LINE_DESCRIPTION_REQUIRED", line: n, field: boqLineId(i, "description"), message: `Line ${n} has no description. Type what the work is, for example "Blockwork - external walls". Nothing was saved.` });
    } else if (trim(line.description).length > BOQ_DESCRIPTION_LIMIT) {
      out.push({ code: "BOQ_LINE_TEXT_TOO_LONG", line: n, field: boqLineId(i, "description"), message: `Line ${n}: the description is ${trim(line.description).length} letters long; the most that can be saved is ${BOQ_DESCRIPTION_LIMIT}. Shorten it. Nothing was saved.` });
    }

    const unit = unitForLine(lines, i);
    if (!unit) {
      out.push({ code: "BOQ_LINE_UNIT_REQUIRED", line: n, field: boqLineId(i, "unit"), message: `Line ${n} has no unit. Type how it is measured, for example sqm, m3, kg or nos. Nothing was saved.` });
    } else if (unit.length > BOQ_UNIT_LIMIT) {
      out.push({ code: "BOQ_LINE_TEXT_TOO_LONG", line: n, field: boqLineId(i, "unit"), message: `Line ${n}: the unit is ${unit.length} letters long; the most that can be saved is ${BOQ_UNIT_LIMIT}. Use a short unit such as sqm. Nothing was saved.` });
    }

    if (sub) {
      const raw = trim(line.breakdownPercentage);
      const pct = plainNumber(raw);
      if (raw === "") {
        out.push({ code: "BOQ_BREAKDOWN_REQUIRED", line: n, field: boqLineId(i, "breakdownPercentage"), message: `Line ${n} is a sub-task of "${trim(line.parentItemCode)}" but has no Breakdown %. Type its share of the parent, from 0 to 100. Nothing was saved.` });
      } else if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        out.push({ code: "BOQ_BREAKDOWN_RANGE", line: n, field: boqLineId(i, "breakdownPercentage"), message: `Line ${n}: Breakdown % must be a number from 0 to 100 (you typed ${raw}). It is the share of the parent's amount this sub-task carries. Nothing was saved.` });
      }
    } else {
      for (const [column, label, raw] of [["quantity", "Qty", line.quantity], ["rate", "Rate", line.rate]] as const) {
        if (trim(raw) === "") {
          out.push({ code: column === "quantity" ? "BOQ_LINE_QTY_REQUIRED" : "BOQ_LINE_RATE_REQUIRED", line: n, field: boqLineId(i, column), message: `Line ${n} has no ${label}. Type a number, for example ${column === "quantity" ? "120" : "45"}. Nothing was saved.` });
          continue;
        }
        const f = numberFault(label, plainNumber(raw), n, boqLineId(i, column), raw);
        if (f) out.push(f);
      }
    }

    const code = trim(line.itemCode);
    if (code) {
      const first = seenCodes.get(code);
      if (first !== undefined) {
        out.push({ code: "BOQ_CODE_DUPLICATE", line: n, field: boqLineId(i, "itemCode"), message: `Line ${n}: the item code "${code}" is already used on line ${first}. Item codes must be different on every line of one BOQ. Nothing was saved.` });
      } else {
        seenCodes.set(code, n);
      }
    }
  });

  // parents are checked after every code is known, because a parent may be typed on a later line
  const known = new Set<string>();
  lines.forEach((l) => {
    if (!isUntouchedLine(l) && trim(l.itemCode)) known.add(trim(l.itemCode));
  });
  const touched = lines.filter((l) => !isUntouchedLine(l));
  lines.forEach((line, i) => {
    if (isUntouchedLine(line)) return;
    const parent = trim(line.parentItemCode);
    if (!parent) return;
    const n = i + 1;
    if (parent === trim(line.itemCode)) {
      out.push({ code: "BOQ_PARENT_INVALID", line: n, field: boqLineId(i, "parentItemCode"), message: `Line ${n}: a line cannot be its own parent (the item code and the parent code are both "${parent}"). Clear the parent code or choose another line. Nothing was saved.` });
    } else if (!known.has(parent)) {
      out.push({ code: "BOQ_PARENT_INVALID", line: n, field: boqLineId(i, "parentItemCode"), message: `Line ${n}: no line has the item code "${parent}", so it cannot be the parent. Type that code on its own line first, or correct the parent code. Nothing was saved.` });
    } else if (draftRootAncestor(line, touched) === null) {
      out.push({ code: "BOQ_PARENT_INVALID", line: n, field: boqLineId(i, "parentItemCode"), message: `Line ${n}: the parent codes go round in a circle ("${parent}" leads back to this line). Break the loop by clearing one parent code. Nothing was saved.` });
    }
  });
  return out;
}

/** The first fault, or null. */
export const firstFault = (faults: Fault[]): Fault | null => faults[0] ?? null;

/** field id -> sentence, for the message under each bad input (the first fault of an input wins). */
export function faultsByField(faults: Fault[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of faults) if (f.field && !(f.field in map)) map[f.field] = f.message.replace(/\s*Nothing was saved\.$/, "");
  return map;
}

/** One sentence for the panel: the first fault, plus how many others are marked on the form. */
export function panelMessage(faults: Fault[]): string {
  const [first, ...rest] = faults;
  if (!first) return "";
  return rest.length === 0 ? first.message : `${first.message} ${rest.length === 1 ? "1 other problem is" : `${rest.length} other problems are`} marked on the form below.`;
}

// ───────────── project ─────────────

export const PROJECT_YEAR_MIN = 1990;
export const PROJECT_YEAR_MAX = 2100;

/** A date box's value is YYYY-MM-DD, but a keyboard can still leave a year like 0002 or 20250 in it. */
export function projectDateFault(label: string, field: string, value: string): Fault | null {
  const v = trim(value);
  if (!v) return null;
  const m = /^(\d{1,6})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return { code: "PROJECT_DATE_INVALID", field, message: `${label} "${v}" is not a complete date. Pick a day, month and year. Nothing was saved.` };
  const year = Number(m[1]);
  if (year < PROJECT_YEAR_MIN || year > PROJECT_YEAR_MAX) {
    return { code: "PROJECT_DATE_INVALID", field, message: `${label} is in the year ${year}, which cannot be right for a project (use ${PROJECT_YEAR_MIN} to ${PROJECT_YEAR_MAX}). Check the year you typed. Nothing was saved.` };
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { code: "PROJECT_DATE_INVALID", field, message: `${label} "${v}" is not a real calendar day. Nothing was saved.` };
  return null;
}

/** Every fault of the New Project form, in reading order. The name is optional (an empty one becomes "New project <date>"). */
export function projectFormFaults(v: { name: string; description: string; startDate: string; targetDate: string }): Fault[] {
  const out: Fault[] = [];
  if (trim(v.name).length > PROJECT_NAME_LIMIT) {
    out.push({ code: "PROJECT_NAME_TOO_LONG", field: "name", message: `The project name is ${trim(v.name).length} letters long; the most that can be saved is ${PROJECT_NAME_LIMIT}. Shorten it and keep the details in the description. Nothing was saved.` });
  }
  const s = projectDateFault("The start date", "startDate", v.startDate);
  const t = projectDateFault("The target date", "targetDate", v.targetDate);
  if (s) out.push(s);
  if (t) out.push(t);
  if (!s && !t && trim(v.startDate) && trim(v.targetDate) && trim(v.targetDate) < trim(v.startDate)) {
    out.push({ code: "PROJECT_DATE_ORDER", field: "targetDate", message: "The target date must be on or after the start date. Pick a later target date, or an earlier start date. Nothing was saved." });
  }
  return out;
}

// ───────────── import ─────────────

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_EXTENSIONS = [".xlsx", ".csv"] as const;

/** The file the person chose, checked before it is sent: no file, a file of the wrong kind, an empty one, one that is too big. */
export function importFileFault(file: { name: string; size: number } | null | undefined): Fault | null {
  if (!file) return { code: "IMPORT_NO_FILE", field: "import-file", message: "No file was chosen. Choose the BOQ workbook (.xlsx) or a .csv file first. Nothing was read." };
  const name = file.name.toLowerCase();
  if (!IMPORT_EXTENSIONS.some((e) => name.endsWith(e))) {
    const kind = name.endsWith(".xls") ? "an old Excel .xls workbook, which this screen cannot read" : name.endsWith(".pdf") ? "a PDF" : `"${file.name}"`;
    return { code: "IMPORT_WRONG_TYPE", field: "import-file", message: `${kind === `"${file.name}"` ? kind : `${file.name} is ${kind}`}. Only an .xlsx workbook or a .csv file can be imported here. Open it in Excel and use Save As .xlsx. Nothing was read.` };
  }
  if (file.size === 0) return { code: "IMPORT_EMPTY_FILE", field: "import-file", message: `${file.name} is empty (0 bytes). Save the workbook again from Excel and choose it again. Nothing was read.` };
  if (file.size > IMPORT_MAX_BYTES) {
    return { code: "IMPORT_TOO_BIG", field: "import-file", message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The most that can be read is 10 MB. Remove pictures and unused sheets, or split it, and choose it again. Nothing was read.` };
  }
  return null;
}

// ───────────── baseline and budget ─────────────

export function baselineEvidenceFault(evidence: string): Fault | null {
  const t = trim(evidence);
  if (!t) return { code: "BASELINE_EVIDENCE_REQUIRED", field: "baseline-evidence", message: "Name the evidence first: the PO, signed proposal or e-mail that proves the agreed value, so the baseline can be checked later. Nothing was confirmed." };
  if (t.length > 500) return { code: "BASELINE_EVIDENCE_REQUIRED", field: "baseline-evidence", message: `The evidence reference is ${t.length} letters long; keep it to a short reference such as "PO 4411 dated 3 Aug" (500 at most). Nothing was confirmed.` };
  return null;
}

export function budgetPercentFault(raw: string, field: string): Fault | null {
  const n = plainNumber(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { code: "BUDGET_PERCENT_RANGE", field, message: `Budget % must be a number from 0 to 100 (you typed ${trim(raw) || "nothing"}). It is the share of the line's amount set aside. Nothing was saved.` };
  return null;
}

export function moneyAmountFault(label: string, raw: string, field: string): Fault | null {
  const n = plainNumber(raw);
  if (!Number.isFinite(n) || n < 0 || n > BOQ_NUMBER_LIMIT) return { code: "BUDGET_AMOUNT_INVALID", field, message: `${label} must be a number, zero or more (you typed ${trim(raw)}). Remove letters, commas and signs. Nothing was saved.` };
  return null;
}

// ───────────── from a Fault list to the panel, and from the server's words back to an input ─────────────


/** The failure CreateScreen / GuidedSubmitFailure show for faults the form found itself. Never retryable: the person corrects, then saves. */
export function faultFailure(faults: Fault[]): SubmitFailure | null {
  const first = firstFault(faults);
  if (!first) return null;
  return { kind: "not-sent", message: panelMessage(faults), serverMessage: panelMessage(faults), retryable: false, code: first.code, field: first.field };
}

const COLUMN_WORDS: [RegExp, BoqColumn][] = [
  [/breakdownpercentage|breakdown/i, "breakdownPercentage"],
  [/parentitemcode/i, "parentItemCode"],
  [/itemcode/i, "itemCode"],
  [/description/i, "description"],
  [/\bunit\b/i, "unit"],
  [/quantity|qty/i, "quantity"],
  [/\brate\b/i, "rate"],
];

/**
 * Which input of the BOQ grid a refusal from the server is about, from its words. The server counts only the lines that were sent (blank rows are
 * dropped before sending), so "line item 3" is the 3rd NON-blank row, not the 3rd row. Returns undefined when the message names no input; the
 * panel then speaks for the whole form. Messages seen: construction-boq-service.ts validateLineItemInputs / resolveRootAncestor / updateBoq.
 */
export function fieldFromServerMessage(message: string, lines: LineItemDraft[]): string | undefined {
  const m = message ?? "";
  if (/^title (is required|must be)/i.test(m)) return BOQ_TITLE_ID;
  const touched: number[] = [];
  lines.forEach((l, i) => {
    if (!isUntouchedLine(l)) touched.push(i);
  });
  const ref = /line item (\d+)/i.exec(m);
  if (ref) {
    const gridIndex = touched[Number(ref[1]) - 1];
    if (gridIndex === undefined) return undefined;
    const afterRef = m.slice(ref.index + ref[0].length);
    const rest = afterRef.includes(":") ? afterRef.slice(afterRef.indexOf(":") + 1) : afterRef;
    const hit = COLUMN_WORDS.find(([re]) => re.test(rest));
    return hit ? boqLineId(gridIndex, hit[1]) : boqLineId(gridIndex, "description");
  }
  const byCode = (code: string, column: BoqColumn, key: "itemCode" | "parentItemCode") => {
    const i = lines.findIndex((l) => trim(l[key]) === code && !isUntouchedLine(l));
    return i >= 0 ? boqLineId(i, column) : undefined;
  };
  let q = /Circular parentItemCode reference detected at "([^"]+)"/i.exec(m);
  if (q) return byCode(q[1], "parentItemCode", "itemCode");
  q = /parentItemCode "([^"]+)" does not match/i.exec(m);
  if (q) return byCode(q[1], "parentItemCode", "parentItemCode");
  q = /Unresolvable parentItemCode reference\(s\) among: ([^,]+)/i.exec(m);
  if (q) return byCode(q[1].trim(), "parentItemCode", "itemCode") ?? byCode(q[1].trim(), "parentItemCode", "parentItemCode");
  q = /breakdownPercentage is required for line item "([^"]+)"/i.exec(m);
  if (q) {
    const i = lines.findIndex((l) => trim(l.description) === q![1]);
    return i >= 0 ? boqLineId(i, "breakdownPercentage") : undefined;
  }
  return undefined;
}

/** The same faults with some inputs known by another id on this screen (the online title box is "title"). */
export function remapFaults(faults: Fault[], map: Record<string, string>): Fault[] {
  return faults.map((f) => (f.field && map[f.field] ? { ...f, field: map[f.field] } : f));
}

/** Keeps only the faults that are STILL true after the person changed something: a fixed one leaves the panel, nothing new is shouted mid-typing. */
export function stillTrue(previous: Fault[], current: Fault[]): Fault[] {
  return previous.filter((p) => current.some((c) => c.code === p.code && c.field === p.field && c.line === p.line));
}

// ───────────── the site instruction file (attached to a BOQ revision, or to a site instruction) ─────────────

/** The same limits the New Site Instruction screen states (src/lib/site-instruction-form.ts): a PDF or a photo, up to 10 MB. */
export const SI_MAX_BYTES = 10 * 1024 * 1024;

export function siFileFault(file: { name: string; size: number; type?: string }, field = "site-instruction"): Fault | null {
  const name = file.name.toLowerCase();
  const okType = /\.(pdf|png|jpe?g)$/.test(name);
  if (!okType) return { code: "SI_FILE_INVALID", field, message: `${file.name} is not a PDF or a photo (.pdf, .png, .jpg). Choose the instruction as a PDF, or take a photo of it. Nothing was saved.` };
  if (file.size === 0) return { code: "SI_FILE_INVALID", field, message: `${file.name} is empty (0 bytes). Choose the file again. Nothing was saved.` };
  if (file.size > SI_MAX_BYTES) {
    return { code: "SI_FILE_INVALID", field, message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The most that can be attached is 10 MB. Make the photo smaller or save the PDF at a lower quality, then choose it again. Nothing was saved.` };
  }
  return null;
}

/** The issue date of a site instruction: the same year/real-day rules as a project date. */
export function siDateFault(value: string): Fault | null {
  const f = projectDateFault("The issue date", "issueDate", value);
  return f ? { ...f, code: "SI_DATE_INVALID" } : null;
}

/**
 * The faults of the NEW lines of a form that adds items to an existing BOQ (Add a scope item): the whole set is judged together (a repeated item code or
 * a parent code is checked against the BOQ's own lines too), but only faults on the new rows are reported, numbered and addressed as the form shows
 * them. `offset` is how many existing lines come first in `all`.
 */
export function newLineFaults(all: Fault[], offset: number): Fault[] {
  const out: Fault[] = [];
  for (const f of all) {
    if (f.line === undefined || f.line <= offset) continue;
    const renumber = (text: string) =>
      text
        .replace(/\b([Ll])ine (\d+)\b/g, (_m, l: string, n: string) => (Number(n) > offset ? `${l}ine ${Number(n) - offset}` : "an existing line of this BOQ"))
        .replace(/\ban existing line of this BOQ has no/, "an existing line has no");
    out.push({
      ...f,
      line: f.line - offset,
      message: renumber(f.message),
      field: f.field?.replace(/^boq-line-(\d+)-/, (_m, n: string) => `boq-line-${Number(n) - offset}-`),
    });
  }
  return out;
}
