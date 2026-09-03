// R67 E-09 (R-128) + E-10 (R-129/R-133/R-137). The rules of a report RUN:
// what its URL says, what its title block reads, when a result goes stale, and
// the three timings of the run lifecycle.
//
// Pure, so the rules can be tested without a browser, and separate so the
// Reports screen and anything else that runs a report read ONE definition --
// a run that is addressable is only addressable if the reader and the writer
// of that URL agree.


/** Everything that makes a run what it is. All of it lives in the URL. */
export type ReportRunParams = {
  report: string;
  projectId: string | null;
  from: string;
  to: string;
  weekStart: string;
  /**
   * R67 E-11 (R-130): the parameter card's Category and Vendor choices. null is
   * "All" -- a real choice with a name, not an empty control. They ride in the
   * URL with the rest of the run, so a filtered run is as shareable as any
   * other.
   */
  category: string | null;
  vendorId: string | null;
};

/** Month-to-date -- the period a report runs with when the reader has chosen none. */
export function monthToDateRange(today: Date = new Date()): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) };
}

/**
 * Reads a run OUT of the URL, filling anything absent with the default period
 * so the screen can run on arrival rather than waiting for a click.
 */
export function readReportRunParams(
  params: URLSearchParams,
  defaults: { report: string; projectId: string | null; today?: Date }
): ReportRunParams {
  const period = monthToDateRange(defaults.today);
  return {
    report: params.get("report")?.trim() || defaults.report,
    projectId: params.get("projectId")?.trim() || defaults.projectId,
    from: params.get("from")?.trim() || period.from,
    to: params.get("to")?.trim() || period.to,
    // R67 E-11: NOT defaulted to today. The weekly report's backend rejects a
    // week start that is not a Monday, and inventing one here would make the
    // primary pressable into that 400 -- which is the defect R-130 is about.
    // Absent means absent, and the card says so on the button.
    weekStart: params.get("weekStart")?.trim() || "",
    category: params.get("category")?.trim() || null,
    vendorId: params.get("vendorId")?.trim() || null,
  };
}

/** Writes it back, so the URL IS the state and Back returns to the same run. */
export function reportRunSearchParams(run: ReportRunParams): URLSearchParams {
  const qs = new URLSearchParams({ report: run.report, from: run.from, to: run.to });
  if (run.projectId) qs.set("projectId", run.projectId);
  if (run.report === "weekly-project" && run.weekStart) qs.set("weekStart", run.weekStart);
  if (run.category) qs.set("category", run.category);
  if (run.vendorId) qs.set("vendorId", run.vendorId);
  return qs;
}

/**
 * "01 Jan", "02 Sep 2026". A fixed month table rather than toLocaleDateString,
 * for the reason src/lib/format-date.ts states at length: a locale-dependent
 * date renders differently on the server and in the browser and produces a
 * hydration mismatch. The year is printed once, on the end date, where it
 * belongs in a period.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One date on its own: "03 Sep 2026". R67 E-12's empty state names both ends of
 * the period separately, and periodLabel's own "from to to" shape drops the
 * year off the first date when both fall in the same one -- correct for a
 * range, wrong for a date quoted alone.
 */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1] ?? "?"} ${y}`;
}

export function periodLabel(from: string, to: string): string {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? { y, m, d } : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return `${from} to ${to}`;
  const day = (p: { y: number; m: number; d: number }, withYear: boolean) =>
    `${String(p.d).padStart(2, "0")} ${MONTHS[p.m - 1] ?? "?"}${withYear ? ` ${p.y}` : ""}`;
  return `${day(a, a.y !== b.y)} to ${day(b, true)}`;
}

/**
 * R-128's title block: "Project Status Report · Cedar Heights Villa - Phase 1
 * · 01 Jan to 02 Sep 2026 · run 14:32".
 *
 * Every part is a fact about THIS run, so a screenshot of it is
 * self-describing -- which is the point of making a run addressable. The clock
 * time is the READER's own, deliberately: this string is only ever built after
 * a run, in the browser, so there is no server render for it to disagree with.
 */
export function reportTitleBlock(input: {
  reportLabel: string;
  projectName: string | null;
  from: string;
  to: string;
  ranAt: Date;
  /**
   * R67 E-11: what to print in the period's place. Most of these reports take a
   * projectId and nothing else, so printing the From/To window above them said
   * the run covered that window when it covered the whole project -- a false
   * statement in the one line whose job is to make a screenshot self-describing.
   * Left undefined, the period is printed exactly as before.
   */
  periodText?: string;
}): string {
  const period = input.periodText ?? periodLabel(input.from, input.to);
  const time = `${String(input.ranAt.getHours()).padStart(2, "0")}:${String(input.ranAt.getMinutes()).padStart(2, "0")}`;
  const parts = [`${input.reportLabel} Report`];
  if (input.projectName) parts.push(input.projectName);
  parts.push(period, `run ${time}`);
  return parts.join(" · ");
}

/** A result older than this is marked stale -- it is still shown, and it is no longer presented as current. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function isStaleRun(ranAt: Date | null, now: Date = new Date()): boolean {
  if (!ranAt) return false;
  return now.getTime() - ranAt.getTime() > STALE_AFTER_MS;
}

/** R-129's running line: it names the report, the project, and what "normal" looks like. */
export function runningLine(reportLabel: string, projectName: string | null): string {
  return `Running ${reportLabel}${projectName ? ` for ${projectName}` : ""}... usually 2-3 s`;
}

/** Cancel is offered only once a run has outlasted a normal one -- before that it is noise. */
export const CANCEL_VISIBLE_AFTER_MS = 5000;

/** The client budget. A request still in flight at this point is aborted and said so. */
export const RUN_BUDGET_MS = 20000;

/** R-129's exact copy for a run that outlived the budget. */
export const RUN_TIMEOUT_MESSAGE = "This report is taking too long. Retry, or open Work Progress > Report for the tabular WPR.";

/** R-128's empty states, in words, so neither is a blank card. */
export const NO_PROJECT_MESSAGE = "Select a project in the top rail to run project reports.";
export const UNKNOWN_REPORT_MESSAGE = "This report does not exist. Choose one from the list.";

/**
 * R-128: Export offers CSV NOW. The server-rendered PDF and XLSX arrive with
 * the schema-driven document template (item E-12); until then the PDF entry is
 * disabled WITH this reason rather than hidden, so the reader is told the
 * capability exists and is not yet here.
 */
export const PDF_NOT_YET_REASON = "PDF export not yet available";

/**
 * OWASP formula-injection guard. A report result carries user-typed text
 * (project names, BOQ descriptions, vendor names), and this CSV is built in
 * the browser -- it never passes through compliance-tracker's
 * report-export-shared.ts, which guards the server-rendered files.
 */
export function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The CSV of a report result, from the SHAPE the report actually returned --
 * the 17 named reports each answer differently, and a per-report exporter for
 * each would be 17 chances to drift from the screen.
 *
 * Two shapes, both of which the screen itself renders:
 *   * an array of objects  -> a header row and one row per entry
 *   * an object            -> Field,Value for its scalars, then each nested
 *                             array as its own titled block
 *
 * The title line comes first, so a shared file states which run it is.
 */
export function reportResultToCsv(result: unknown, titleLine: string): string {
  const lines: string[] = [csvEscape(titleLine)];

  const appendRows = (rows: unknown[], heading?: string) => {
    if (rows.length === 0) return;
    if (heading) lines.push("", csvEscape(heading));
    if (isPlainObject(rows[0])) {
      const columns = [...new Set(rows.flatMap((r) => (isPlainObject(r) ? Object.keys(r) : [])))];
      lines.push(columns.map(csvEscape).join(","));
      for (const row of rows) {
        lines.push(columns.map((c) => csvEscape(isPlainObject(row) ? row[c] : row)).join(","));
      }
    } else {
      lines.push("Value");
      for (const row of rows) lines.push(csvEscape(row));
    }
  };

  if (Array.isArray(result)) {
    appendRows(result);
    return lines.join("\n");
  }

  if (isPlainObject(result)) {
    const scalars = Object.entries(result).filter(([, v]) => !Array.isArray(v) && !isPlainObject(v));
    if (scalars.length > 0) {
      lines.push("Field,Value");
      for (const [k, v] of scalars) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
    }
    for (const [k, v] of Object.entries(result)) {
      if (Array.isArray(v)) appendRows(v, k);
      else if (isPlainObject(v)) {
        lines.push("", csvEscape(k), "Field,Value");
        for (const [k2, v2] of Object.entries(v)) lines.push(`${csvEscape(k2)},${csvEscape(v2)}`);
      }
    }
    return lines.join("\n");
  }

  lines.push("Value", csvEscape(result));
  return lines.join("\n");
}
