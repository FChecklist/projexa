// LOCAL-FIRST shell, overview cluster: REPORTS, read from the laptop's own database.
//
// Every report is computed by the server (most carry money: budgets, costs, revenue). The laptop never works one out. What it keeps is
// the LAST answer the server gave this person for a report of a project (snapshot-cache.ts), and the screen shows that, labelled
// "As of ..., from this laptop". While the laptop is online the screen asks the server again, at the SAME endpoint the online Reports
// screen uses: reportDestination() from src/lib/report-destinations.ts builds the URL here too, so the two can never drift apart.
//
// A report that lives on its own screen (work progress, materials, designer cost, budget: reportDestination's "navigate" kind) is a
// link to that screen, as online; whether that screen is on this laptop is the shell's business (it says so calmly when it is not).

import { reportDestination } from "@/lib/report-destinations";
import type { ShellData } from "../context";
import { snapshotCacheFor, snapshotKey, type Snapshot, type SnapshotName } from "../snapshot-cache";

/**
 * The reports of the online Reports screen, in its order, with its labels (ReportsClient.tsx DEFAULT_REPORT_COLUMNS). That list is a
 * private constant of a client component, so it is repeated here; reports-adapter.test.ts pins the two together by reading that file.
 */
export const REPORTS: readonly { value: string; label: string }[] = [
  { value: "project-status", label: "Project Status" },
  { value: "project-completion", label: "Project Completion" },
  { value: "work-progress", label: "Work Progress" },
  { value: "category-progress", label: "Category Progress" },
  { value: "weekly-project", label: "Weekly Project (needs week start)" },
  { value: "attendance", label: "Attendance" },
  { value: "manpower-cost", label: "Manpower Cost" },
  { value: "site-picture", label: "Site Picture Log" },
  { value: "scope", label: "Scope (BOQ)" },
  { value: "budget-summary", label: "Budget Summary" },
  { value: "budget-vs-actual", label: "Budget vs Actual" },
  { value: "material-consumption", label: "Material Consumption" },
  { value: "vendor-cost", label: "Vendor Cost" },
  { value: "designer-timesheet", label: "Designer Timesheet" },
  { value: "kpi", label: "KPI" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
];

export type ReportEntry = {
  value: string;
  label: string;
  /** "fetch": shown on this screen from the server's answer; "navigate": the report is its own screen. */
  kind: "fetch" | "navigate";
  /** The endpoint (fetch) or the screen (navigate). */
  target: string;
  /** When this laptop last saved the server's answer for it (fetch reports only). */
  savedAt: number | null;
};

export type SelectedReport =
  | { kind: "fetch"; value: string; label: string; url: string; name: SnapshotName; snapshot: Snapshot<unknown> | null }
  | { kind: "navigate"; value: string; label: string; href: string };

export type ReportsData =
  | { state: "no_project" }
  | { state: "local"; projectId: string; reports: ReportEntry[]; selected: SelectedReport | null; weekStart: string | null };

/** A report's answer is untrusted until it is an object or a list (the two shapes the screen and the CSV export read). */
export function isReportBody(v: unknown): v is Record<string, unknown> | unknown[] {
  return Array.isArray(v) || (typeof v === "object" && v !== null);
}

/** The snapshot of one report run: keyed by its endpoint and every parameter the URL carries. */
export function reportSnapshotName(url: string, projectId: string): SnapshotName {
  const [path, query = ""] = url.split("?");
  return { route: path!, projectId, query };
}

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

export async function loadReports(data: ShellData, projectId: string | null, query: URLSearchParams): Promise<ReportsData> {
  if (!projectId) return { state: "no_project" };
  const weekStartRaw = query.get("weekStart");
  const weekStart = weekStartRaw && WEEK.test(weekStartRaw) ? weekStartRaw : null;
  const cache = snapshotCacheFor({ userId: data.userId, role: data.role, idb: data.idb });

  const saved = new Map((await cache.list().catch(() => [])).map((e) => [e.key, e.fetchedAt]));
  const reports: ReportEntry[] = [];
  for (const r of REPORTS) {
    const dest = reportDestination(r.value, { projectId, weekStart: r.value === "weekly-project" ? weekStart ?? undefined : undefined });
    if (dest.kind === "navigate") {
      reports.push({ value: r.value, label: r.label, kind: "navigate", target: dest.href, savedAt: null });
    } else {
      const name = reportSnapshotName(dest.path, projectId);
      reports.push({ value: r.value, label: r.label, kind: "fetch", target: dest.path, savedAt: saved.get(snapshotKey(name)) ?? null });
    }
  }

  const wanted = query.get("report");
  const entry = reports.find((r) => r.value === wanted) ?? null;
  let selected: SelectedReport | null = null;
  if (entry?.kind === "navigate") selected = { kind: "navigate", value: entry.value, label: entry.label, href: entry.target };
  else if (entry) {
    const name = reportSnapshotName(entry.target, projectId);
    selected = { kind: "fetch", value: entry.value, label: entry.label, url: entry.target, name, snapshot: await cache.read(name, isReportBody) };
  }
  return { state: "local", projectId, reports, selected, weekStart };
}
