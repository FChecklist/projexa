// R67 E-22 (R-199 / R-207). A report is a DOCUMENT, not a key-value card.
//
// WHAT WAS ON SCREEN. Running "Project Status" rendered
// ReportOutput's generic object renderer: a grid of the payload's own JSON
// keys against their raw values -- "projectId g555imnoq4wihavpwc7t64um",
// "contractValue 475000", "percentByValue 25", "progressPercent 60". A raw
// cuid is not a fact a customer can use, two differently-derived percentages
// side by side with no words disagree in public, and an unformatted 475000
// is not money. Sumeet's six named reports each have their own fixed column
// set and none of them is a key-value grid.
//
// WHAT THIS MODULE IS. Pure builders: each takes the REAL payload the
// existing /api/reports/<name> proxy already returns and produces a
// {sections: [{columns, rows, totals}]} model. Nothing is fetched, nothing is
// invented -- a figure the payload does not carry is null, and null renders
// as "Not set" with the action that would set it. Keeping it pure is what
// makes the column sets testable without a browser.

import { EMPTY_VALUE } from "./format-number";

export type ReportUnit = "currency" | "percent" | "number" | "date" | "text";

export type ReportColumn = {
  key: string;
  label: string;
  unit: ReportUnit;
  /** Numbers right, words left. Defaulted from `unit` when omitted. */
  align?: "left" | "right";
};

export type ReportCellValue = string | number | null;

export type ReportRow = {
  key: string;
  cells: Record<string, ReportCellValue>;
  /** "subtotal" and "total" rows are emphasised and never counted as data rows. */
  kind?: "row" | "subtotal" | "total";
  /** When present, the row's first cell links here. */
  href?: string;
  /** Shown under the row's first cell -- the action a "Not set" cell needs. */
  hint?: string;
};

export type ReportSection = {
  key: string;
  title?: string;
  /** One sentence under the title, in words -- e.g. what a measure actually measures. */
  note?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Rendered as a photo grid rather than a table. */
  photos?: { key: string; date: string; items: { id: string; name: string }[] }[];
  emptyLabel?: string;
};

export type ReportDocumentModel = {
  /** The report's own name, as the reader chose it. */
  title: string;
  sections: ReportSection[];
};

export const NOT_SET = "Not set";

/** The default alignment for a unit, so no column has to repeat it. */
export function alignFor(column: ReportColumn): "left" | "right" {
  if (column.align) return column.align;
  return column.unit === "currency" || column.unit === "percent" || column.unit === "number" ? "right" : "left";
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

// ---------------------------------------------------------------- Project Status

export type ProjectStatusPayload = {
  projectId?: string;
  projectName?: string;
  budget?: number | null;
  revenue?: number | null;
  expenses?: number | null;
  progressPercent?: number | null;
  percentByValue?: number | null;
  contractValue?: number | null;
  projectValue?: number | null;
  earnedValue?: number | null;
  taskCount?: number | null;
  delayedTaskCount?: number | null;
  photoCount?: number | null;
};

export type BudgetVarianceLine = {
  lineItemId: string;
  code: string | null;
  description: string;
  category?: string | null;
  amount?: number | null;
  budgetPercentage?: number | null;
  budget?: number | null;
  vendorId?: string | null;
  vendorName?: string | null;
  vendorAmount?: number | null;
  variance?: number | null;
};

export type BudgetVariancePayload = {
  lines?: BudgetVarianceLine[];
  totalBudget?: number | null;
  totalVendorAmount?: number | null;
  totalVariance?: number | null;
};

/**
 * Sumeet's Project Status sheet: a money table (Revenue | Budget | Expense),
 * a progress block that names BOTH measures in words, and the
 * subcontractor/budget breakup. Never a key-value card, and the project id is
 * never printed -- it is a database key, not information.
 */
export function buildProjectStatusDocument(
  status: ProjectStatusPayload,
  variance?: BudgetVariancePayload | null
): ReportDocumentModel {
  const money: ReportSection = {
    key: "money",
    title: "Revenue, budget and expense",
    columns: [
      { key: "measure", label: "Measure", unit: "text" },
      { key: "amount", label: "Amount", unit: "currency" },
    ],
    rows: [
      { key: "revenue", cells: { measure: "Revenue", amount: num(status.revenue) }, hint: status.revenue === null || status.revenue === undefined ? "No sales invoices raised for this project yet" : undefined },
      { key: "budget", cells: { measure: "Budget", amount: num(status.budget) }, hint: num(status.budget) === null ? "Set a budget on the project's cost centre" : undefined },
      { key: "expense", cells: { measure: "Expense", amount: num(status.expenses) } },
      { key: "contract", cells: { measure: "Contract value (latest BOQ, parent lines only)", amount: num(status.contractValue) }, hint: num(status.contractValue) === null ? "Import a BOQ to set the contract value" : undefined },
      { key: "projectValue", cells: { measure: "Project value (entered, or linked purchase orders)", amount: num(status.projectValue) }, hint: num(status.projectValue) === null ? "Set a project value, or link a purchase order" : undefined },
    ],
  };

  // The two percentages are genuinely different measures, and the report says
  // which is which in words rather than printing two camelCase keys that
  // disagree.
  const progress: ReportSection = {
    key: "progress",
    title: "Progress",
    note: "These two measure different things, so they are expected to differ: one weighs completed BOQ value, the other averages the latest percentage logged against each activity.",
    columns: [
      { key: "measure", label: "Measure", unit: "text" },
      { key: "percent", label: "Complete", unit: "percent" },
      { key: "amount", label: "Value earned", unit: "currency" },
    ],
    rows: [
      {
        key: "byValue",
        cells: {
          measure: "% complete by BOQ value",
          percent: num(status.percentByValue),
          amount: num(status.earnedValue),
        },
        hint: num(status.percentByValue) === null ? "Needs a BOQ with quantities booked against its lines" : undefined,
      },
      {
        key: "byActivityLog",
        cells: { measure: "% complete by activity log", percent: num(status.progressPercent), amount: null },
        hint: num(status.progressPercent) === null ? "Needs at least one progress entry" : undefined,
      },
      {
        key: "tasks",
        cells: { measure: "Tasks delayed, of tasks open", percent: null, amount: null },
      },
    ],
  };
  // The task counts are counts, not percentages -- carried in their own row's
  // cells so the column stays honest about its unit.
  progress.rows[2].cells.percent = null;
  progress.rows[2].cells.measure = `Tasks delayed: ${num(status.delayedTaskCount) ?? 0} of ${num(status.taskCount) ?? 0} open`;

  const breakupLines = (variance?.lines ?? []).filter((l) => l.vendorId || l.vendorAmount !== null || num(l.budget) !== null);
  const breakup: ReportSection = {
    key: "breakup",
    title: "Subcontractor and budget breakup",
    note: "Budget is the BOQ line's amount at its budget percentage. Vendor amount is what the subcontractor quoted.",
    emptyLabel: "No BOQ line carries a budget percentage or a vendor amount yet.",
    columns: [
      { key: "code", label: "Code", unit: "text" },
      { key: "description", label: "Description", unit: "text" },
      { key: "category", label: "Category", unit: "text" },
      { key: "vendor", label: "Vendor", unit: "text" },
      { key: "budget", label: "Budget", unit: "currency" },
      { key: "vendorAmount", label: "Vendor amount", unit: "currency" },
      { key: "variance", label: "Variance", unit: "currency" },
    ],
    rows: breakupLines.map((line) => ({
      key: line.lineItemId,
      href: `/scope`,
      cells: {
        code: str(line.code) ?? EMPTY_VALUE,
        description: line.description,
        category: str(line.category) ?? NOT_SET,
        vendor: str(line.vendorName) ?? NOT_SET,
        budget: num(line.budget),
        vendorAmount: num(line.vendorAmount),
        variance: num(line.variance),
      },
    })),
  };
  if (variance && breakupLines.length > 0) {
    breakup.rows.push({
      key: "__total",
      kind: "total",
      cells: {
        code: "",
        description: "Total",
        category: "",
        vendor: "",
        budget: num(variance.totalBudget),
        vendorAmount: num(variance.totalVendorAmount),
        variance: num(variance.totalVariance),
      },
    });
  }

  return { title: "Project Status", sections: [money, progress, breakup] };
}

// ---------------------------------------------------------------- Weekly Project

export type WeeklyProjectDay = {
  date: string;
  labourCost: number;
  workersPresent: number;
  expenseTotal: number;
  progressEntriesLogged: number;
  diaryEntries: number;
};

export type WeeklyProjectPayload = {
  weekStart?: string;
  weekEnd?: string;
  labourCost?: number;
  expenseTotal?: number;
  progressEntriesLogged?: number;
  diaryEntries?: number;
  workersPresent?: number;
  byDay?: WeeklyProjectDay[];
};

const WEEKLY_CATEGORIES: { key: keyof WeeklyProjectDay; label: string; unit: ReportUnit }[] = [
  { key: "labourCost", label: "Labour cost", unit: "currency" },
  { key: "expenseTotal", label: "Expenses", unit: "currency" },
  { key: "workersPresent", label: "Workers present", unit: "number" },
  { key: "progressEntriesLogged", label: "Progress entries", unit: "number" },
  { key: "diaryEntries", label: "Site diary entries", unit: "number" },
];

/**
 * Sumeet's Weekly Project sheet: DAY COLUMNS, CATEGORY ROWS, and a total
 * column that is the sum of the days on the row -- so the total and the
 * columns cannot disagree.
 *
 * A unit column is deliberately absent: two of the five rows are money and
 * three are counts, so the unit is stated in the row label instead of in a
 * header that would be wrong for three rows out of five.
 */
export function buildWeeklyProjectDocument(payload: WeeklyProjectPayload): ReportDocumentModel {
  const days = payload.byDay ?? [];
  const columns: ReportColumn[] = [
    { key: "category", label: "Category", unit: "text" },
    ...days.map((d) => ({ key: `d_${d.date}`, label: d.date, unit: "number" as ReportUnit })),
    { key: "total", label: "Week total", unit: "number" },
  ];

  const rows: ReportRow[] = WEEKLY_CATEGORIES.map((category) => {
    const cells: Record<string, ReportCellValue> = {
      category: category.unit === "currency" ? `${category.label} (amount)` : category.label,
    };
    let total = 0;
    for (const day of days) {
      const value = Number(day[category.key] ?? 0);
      cells[`d_${day.date}`] = value;
      total += value;
    }
    cells.total = total;
    return { key: String(category.key), cells };
  });

  return {
    title: "Weekly Project",
    sections: [
      {
        key: "week",
        title: payload.weekStart && payload.weekEnd ? `Week of ${payload.weekStart}` : "Week",
        note: "Every day in the window has a column, including the days with nothing on them. The week total is the sum of the day columns.",
        emptyLabel: "This week has no days in range -- pick a week start.",
        columns,
        rows: days.length > 0 ? rows : [],
      },
    ],
  };
}

// ---------------------------------------------------------------- Attendance

export type AttendanceWorker = {
  rosterId: string;
  employeeCode: string | null;
  name: string;
  company: string | null;
  trade: string | null;
  daysPresent: number;
  daysHalf?: number;
  daysAbsent?: number;
  salary: number;
};

export type AttendancePayload = {
  workers?: AttendanceWorker[];
  tradeSubtotals?: { trade: string; workers: number; daysPresent: number; salary: number }[];
};

/**
 * Sumeet's Attendance sheet: S.No | ID | Name | Company | Trade | Salary,
 * with a subtotal row after each trade. Workers arrive already ordered by
 * trade then name, so the subtotal is emitted when the trade changes.
 */
export function buildAttendanceDocument(payload: AttendancePayload): ReportDocumentModel {
  const workers = payload.workers ?? [];
  const subtotalByTrade = new Map((payload.tradeSubtotals ?? []).map((s) => [s.trade, s]));
  const tradeOf = (w: AttendanceWorker) => w.trade?.trim() || NOT_SET;

  const rows: ReportRow[] = [];
  let serial = 0;
  let grandSalary = 0;
  let grandDays = 0;

  workers.forEach((worker, index) => {
    serial += 1;
    grandSalary += worker.salary;
    grandDays += worker.daysPresent;
    rows.push({
      key: worker.rosterId,
      cells: {
        sno: serial,
        id: str(worker.employeeCode) ?? NOT_SET,
        name: worker.name,
        company: str(worker.company) ?? "Direct labour",
        trade: tradeOf(worker),
        days: worker.daysPresent,
        salary: worker.salary,
      },
      hint: str(worker.employeeCode) === null ? "Give this worker an ID on the roster" : undefined,
    });

    const next = workers[index + 1];
    if (!next || tradeOf(next) !== tradeOf(worker)) {
      // rollUpAttendanceByTrade names an untraded worker's bucket "Not set",
      // and so does tradeOf -- the two spellings must match or the subtotal
      // lookup silently misses.
      const subtotal = subtotalByTrade.get(tradeOf(worker));
      rows.push({
        key: `subtotal-${tradeOf(worker)}`,
        kind: "subtotal",
        cells: {
          sno: "",
          id: "",
          name: `${tradeOf(worker)} subtotal`,
          company: "",
          trade: "",
          days: subtotal?.daysPresent ?? null,
          salary: subtotal?.salary ?? null,
        },
      });
    }
  });

  if (workers.length > 0) {
    rows.push({
      key: "__total",
      kind: "total",
      cells: { sno: "", id: "", name: "Total", company: "", trade: "", days: grandDays, salary: grandSalary },
    });
  }

  return {
    title: "Attendance",
    sections: [
      {
        key: "attendance",
        emptyLabel: "No attendance has been marked for this project yet.",
        columns: [
          { key: "sno", label: "S.No", unit: "number" },
          { key: "id", label: "ID", unit: "text" },
          { key: "name", label: "Name", unit: "text" },
          { key: "company", label: "Company", unit: "text" },
          { key: "trade", label: "Trade", unit: "text" },
          { key: "days", label: "Days present", unit: "number" },
          { key: "salary", label: "Salary", unit: "currency" },
        ],
        rows,
      },
    ],
  };
}

// ---------------------------------------------------------------- Site Picture

export type SitePicturePayload = { photos?: { id: string; name: string; createdAt: string }[] };

/** Sumeet's Site Picture sheet: photos grouped by the day they were taken, newest day first. */
export function buildSitePictureDocument(payload: SitePicturePayload): ReportDocumentModel {
  const byDate = new Map<string, { id: string; name: string }[]>();
  for (const photo of payload.photos ?? []) {
    const date = String(photo.createdAt).slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push({ id: photo.id, name: photo.name });
    byDate.set(date, list);
  }
  const groups = Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, items]) => ({ key: date, date, items }));

  return {
    title: "Site Picture",
    sections: [
      {
        key: "photos",
        note: "Site photos, grouped by the day they were uploaded.",
        emptyLabel: "No site photos have been uploaded for this project yet.",
        columns: [],
        rows: [],
        photos: groups,
      },
    ],
  };
}

// ---------------------------------------------------------------- Scope

export type ScopePayload = {
  boq?: { id: string; version: number; status: string } | null;
  totalValue?: number;
  lineItemCount?: number;
  revisions?: { id: string; version: number; status: string }[];
};

export type ScopeFilters = { category?: string | null; vendor?: string | null };

/**
 * Sumeet's Scope sheet: the BOQ's subcontractor lines -- rate, amount and
 * vendor -- with Category and Vendor filters. The per-line detail lives on
 * the budget-variance report (the only endpoint that carries vendor and
 * category per BOQ line); the scope report supplies the revision header the
 * document is stamped with.
 */
export function buildScopeDocument(
  scope: ScopePayload,
  variance: BudgetVariancePayload | null,
  filters: ScopeFilters = {}
): ReportDocumentModel {
  const all = variance?.lines ?? [];
  const category = filters.category?.trim() || null;
  const vendor = filters.vendor?.trim() || null;
  const lines = all.filter((line) => {
    if (category && (str(line.category) ?? NOT_SET) !== category) return false;
    if (vendor && (str(line.vendorName) ?? NOT_SET) !== vendor) return false;
    return true;
  });

  const rows: ReportRow[] = lines.map((line) => ({
    key: line.lineItemId,
    cells: {
      code: str(line.code) ?? EMPTY_VALUE,
      description: line.description,
      category: str(line.category) ?? NOT_SET,
      vendor: str(line.vendorName) ?? NOT_SET,
      rate: num(line.budgetPercentage),
      amount: num(line.amount),
      vendorAmount: num(line.vendorAmount),
    },
  }));

  if (rows.length > 0) {
    rows.push({
      key: "__total",
      kind: "total",
      cells: {
        code: "",
        description: `Total of ${lines.length} line${lines.length === 1 ? "" : "s"}`,
        category: "",
        vendor: "",
        rate: null,
        amount: lines.reduce((s, l) => s + (num(l.amount) ?? 0), 0),
        vendorAmount: lines.reduce((s, l) => s + (num(l.vendorAmount) ?? 0), 0),
      },
    });
  }

  return {
    title: "Scope",
    sections: [
      {
        key: "scope",
        title: scope.boq ? `BOQ revision ${scope.boq.version} (${scope.boq.status})` : "No BOQ yet",
        note: `${scope.lineItemCount ?? 0} root line${(scope.lineItemCount ?? 0) === 1 ? "" : "s"} in the latest revision. Budget % is the line's own budget rate.`,
        emptyLabel:
          all.length === 0
            ? "This project has no BOQ lines yet."
            : "No BOQ line matches this Category and Vendor filter.",
        columns: [
          { key: "code", label: "Code", unit: "text" },
          { key: "description", label: "Description", unit: "text" },
          { key: "category", label: "Category", unit: "text" },
          { key: "vendor", label: "Vendor", unit: "text" },
          { key: "rate", label: "Budget %", unit: "percent" },
          { key: "amount", label: "Amount", unit: "currency" },
          { key: "vendorAmount", label: "Vendor amount", unit: "currency" },
        ],
        rows,
      },
    ],
  };
}

/** The distinct values a Scope filter may take, in the order they should appear. */
export function scopeFilterOptions(variance: BudgetVariancePayload | null): { categories: string[]; vendors: string[] } {
  const categories = new Set<string>();
  const vendors = new Set<string>();
  for (const line of variance?.lines ?? []) {
    categories.add(str(line.category) ?? NOT_SET);
    vendors.add(str(line.vendorName) ?? NOT_SET);
  }
  return { categories: Array.from(categories).sort(), vendors: Array.from(vendors).sort() };
}

// ---------------------------------------------------------------- Export

/**
 * OWASP CSV/formula injection: a cell starting with =, +, - or @ executes as
 * a live formula when the file is opened in Excel or Sheets, and report cells
 * carry user-typed text (descriptions, vendor names). The standard
 * leading-apostrophe mitigation forces the value to be read as text while
 * leaving every original character intact. Same guard as
 * compliance-tracker's own report-export-shared.ts#csvEscape.
 */
export function csvEscape(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The rendered document as CSV -- the same rows, in the same order, with
 * subtotal and total rows kept (a spreadsheet of a report that silently drops
 * its total is not the report).
 *
 * Money is written as a RAW NUMBER with the currency code in the column
 * header, not as "AED 1,234.00": a formatted string is not a number a
 * spreadsheet can sum, and repeating the code down forty rows is noise.
 * PROJEXA gains no CSV library for this -- it is string building, which is
 * why it can live here and stay pure.
 */
export function documentToCsv(model: ReportDocumentModel, currency?: string | null): string {
  const lines: string[] = [];
  for (const section of model.sections) {
    if (section.columns.length === 0) continue;
    if (lines.length > 0) lines.push("");
    if (section.title) lines.push(csvEscape(section.title));
    lines.push(
      section.columns
        .map((c) => csvEscape(c.unit === "currency" && currency ? `${c.label} (${currency})` : c.label))
        .join(",")
    );
    for (const row of section.rows) {
      lines.push(section.columns.map((c) => csvEscape(row.cells[c.key] ?? "")).join(","));
    }
  }
  return lines.join("\n");
}
