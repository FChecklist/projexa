// The PUBLIC share page's reading of whatever VERIDIAN's token endpoint returns.
//
// WHY THIS EXISTS (live 500, 2026-10-22). /share/report/[token] was written for
// a 'project_status' payload that carried cost (totals.budget, dashboard.revenue
// ...). VERIDIAN then redacted every public share to schedule/progress/scope
// only (owner ruling D91: an unauthenticated token can never carry cost), so
// `totals` stopped existing and `data.totals.budget` threw inside the Server
// Component: HTTP 500 and the app-error screen for every fresh project-status
// link. The page trusted a TypeScript type for data it does not control.
//
// The rule now: this module is the only place that looks at the raw body. It
// returns either a normalised, fully-defaulted report or an "unavailable"
// verdict with a reason the reader can act on. Nothing here throws, and a page
// built on it can never be a 500 because of the payload.

export type UnavailableReason = "expired" | "wrong-page" | "unsupported" | "unreadable" | "unreachable";

export type SharedUnavailable = { kind: "unavailable"; reason: UnavailableReason; message: string };

export type SharedProjectStatus = {
  kind: "project_status";
  from: string | null;
  to: string | null;
  boqTitle: string | null;
  projectName: string;
  progressPercent: number | null;
  taskCount: number | null;
  delayedTaskCount: number | null;
  photoCount: number | null;
  categories: { name: string; percentComplete: number | null }[];
  recentEntries: { activityName: string; entryDate: string | null; quantityDone: number | null; percentComplete: number | null }[];
  lines: { key: string; category: string | null; code: string | null; description: string; unit: string | null; quantity: number | null }[];
};

export type SharedWorkProgress = {
  kind: "work_progress";
  // Same shapes buildWorkProgressReport() takes; arrays are guaranteed arrays.
  data: {
    from: string; to: string; boqTitle: string | null;
    lineItems: unknown[]; activities: unknown[]; categories: unknown[]; entries: unknown[];
  };
};

export type SharedAttendance = {
  kind: "attendance_summary";
  from: string | null; to: string | null; headcount: number | null;
  rows: { trade: string; present: number | null; halfDay: number | null; absent: number | null; workerDays: number | null }[];
  totals: { present: number | null; halfDay: number | null; absent: number | null; workerDays: number | null };
  ties: boolean | null;
};

export type SharedReportVerdict = SharedProjectStatus | SharedWorkProgress | SharedAttendance | SharedUnavailable;

export const UNAVAILABLE_COPY: Record<UnavailableReason, { title: string; why: string }> = {
  expired: { title: "This shared report cannot be shown", why: "The link has expired or was turned off by the sender. Ask the sender for a new link." },
  "wrong-page": { title: "This shared report cannot be shown here", why: "This link is for a different kind of shared report. Use the button below to open it." },
  unsupported: { title: "This shared report cannot be shown", why: "This kind of report cannot be shown on a public page yet. Ask the sender to send it another way." },
  unreadable: { title: "This shared report cannot be shown", why: "The report arrived in a form this page could not read. Ask the sender to create a new link; nothing was lost." },
  unreachable: { title: "This shared report cannot be shown right now", why: "The report could not be loaded just now. Wait a minute and open the link again." },
};

function unavailable(reason: UnavailableReason): SharedUnavailable {
  return { kind: "unavailable", reason, message: UNAVAILABLE_COPY[reason].why };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
/** Accepts 70 and "70" (the API sends numeric strings for some figures); anything else is absent, never 0. */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * @param status HTTP status of the token endpoint, or null when the request itself failed.
 * @param body   the parsed JSON body, or undefined when it could not be parsed.
 */
export function interpretSharedReport(status: number | null, body: unknown): SharedReportVerdict {
  if (status === null) return unavailable("unreachable");
  if (status === 404 || status === 410) return unavailable("expired");
  if (status < 200 || status >= 300) return unavailable("unreachable");
  if (!isObj(body)) return unavailable("unreadable");

  const type = body.reportType === undefined ? "work_progress" : body.reportType;
  if (type === "attendance_summary") return interpretAttendance(body);
  if (type === "project_status") return interpretProjectStatus(body);
  if (type === "work_progress") {
    if (!Array.isArray(body.lineItems) || !Array.isArray(body.entries)) return unavailable("unreadable");
    const from = str(body.from), to = str(body.to);
    if (!from || !to) return unavailable("unreadable");
    return {
      kind: "work_progress",
      data: {
        from, to, boqTitle: str(body.boqTitle),
        lineItems: body.lineItems, entries: body.entries, activities: arr(body.activities), categories: arr(body.categories),
      },
    };
  }
  return unavailable("unsupported");
}

function interpretAttendance(body: Record<string, unknown>): SharedReportVerdict {
  if (!Array.isArray(body.rows) || !isObj(body.totals)) return unavailable("unreadable");
  const counts = (o: Record<string, unknown>) => ({ present: num(o.present), halfDay: num(o.halfDay), absent: num(o.absent), workerDays: num(o.workerDays) });
  return {
    kind: "attendance_summary",
    from: str(body.from), to: str(body.to), headcount: num(body.headcount),
    rows: body.rows.filter(isObj).map((r) => ({ trade: str(r.trade) ?? "", ...counts(r) })),
    totals: counts(body.totals),
    ties: isObj(body.reconciliation) && typeof body.reconciliation.ties === "boolean" ? body.reconciliation.ties : null,
  };
}

function interpretProjectStatus(body: Record<string, unknown>): SharedReportVerdict {
  const d = isObj(body.dashboard) ? body.dashboard : null;
  if (!d) return unavailable("unreadable");
  return {
    kind: "project_status",
    from: str(body.from), to: str(body.to), boqTitle: str(body.boqTitle),
    projectName: str(d.projectName) ?? "Project",
    progressPercent: num(d.progressPercent) ?? num(d.progressByActivityLogPct),
    taskCount: num(d.taskCount), delayedTaskCount: num(d.delayedTaskCount), photoCount: num(d.photoCount),
    categories: arr(d.categories).filter(isObj).map((c) => ({ name: str(c.name) ?? "Uncategorised", percentComplete: num(c.percentComplete) })),
    recentEntries: arr(d.recentEntries).filter(isObj).map((e) => ({
      activityName: str(e.activityName) ?? "Activity", entryDate: str(e.entryDate),
      quantityDone: num(e.quantityDone), percentComplete: num(e.percentComplete),
    })),
    lines: arr(body.lines).filter(isObj).map((l, i) => ({
      key: str(l.lineItemId) ?? `line-${i}`, category: str(l.category), code: str(l.code),
      description: str(l.description) ?? "", unit: str(l.unit), quantity: num(l.quantity),
    })),
  };
}

/** Never throws: a network failure, a non-JSON body and a bad status are all verdicts. */
export async function loadSharedReport(origin: string, token: string): Promise<SharedReportVerdict> {
  let res: Response;
  try {
    res = await fetch(`${origin}/api/reports/share/${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    return interpretSharedReport(null, undefined);
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  return interpretSharedReport(res.status, body);
}
