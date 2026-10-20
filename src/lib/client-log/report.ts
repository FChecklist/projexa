// Turns the raw rows the System log reads (compliance.client_error_issues + client_log_events, snake_case) into plain words, and builds the
// complete plain-text report the owner pastes to an AI. Pure functions: no React, no network.

import { routePattern } from "./fingerprint";
import { plainActionName } from "./plain-action";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type Step = { time: string; text: string };
export type SampleEvent = {
  id: string;
  kind: string;
  message: string;
  stack: string;
  route: string;
  projectId: string | null;
  apiPath: string;
  httpMethod: string;
  httpStatus: number | null;
  requestId: string;
  durationMs: number | null;
  device: string;
  steps: Step[];
  userId: string | null;
  occurredAt: string;
};
export type FixFile = { path: string; change: string };
export type Issue = {
  id: string;
  title: string;
  status: "open" | "fixed" | "reopened" | "ignored";
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Time of the newest sighting (last_event_at), when the backend sends it. */
  lastEventAt: string;
  projectIds: string[];
  routes: string[];
  reopenedCount: number;
  /** Distinct people, when the list read carries it; otherwise null and the screen asks the detail read. */
  people: number | null;
  fixSummary: string;
  fixFiles: FixFile[];
  fixCommit: string;
  fixedAt: string;
  fixedBy: string;
  sample: SampleEvent | null;
};

/** "/finance/budgets/3f2a-..." -> "Finance / Budgets" : the screen in words. */
export function screenName(route: string): string {
  const words = routePattern(route || "/")
    .split("/")
    .filter((s) => s && s !== ":id")
    .map((s) => s.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()));
  return words.length ? words.join(" / ") : "Home";
}

function deviceText(context: unknown): string {
  const c = (context && typeof context === "object" ? (context as Row) : {}) as Row;
  const parts = [str(c.platform), str(c.screen), str(c.language), c.online === false ? "offline" : "", str(c.appVersion) ? `version ${str(c.appVersion)}` : ""].filter(Boolean);
  const ua = str(c.userAgent);
  return [parts.join(", "), ua].filter(Boolean).join(" | ");
}

/** The step list: what the person was doing, in their words, oldest first. */
export function stepsFrom(breadcrumbs: unknown): Step[] {
  return arr(breadcrumbs).map((b) => {
    const r = (b && typeof b === "object" ? b : {}) as Row;
    const label = str(r.label);
    const t = str(r.t);
    const type = str(r.type);
    const text =
      type === "nav" ? label || `Opened ${str(r.route)}`
      : type === "click" ? `Pressed "${label}"`
      : type === "submit" ? `Sent the form "${label}"`
      : type === "api" ? `The app talked to the server: ${label}`
      : type === "error" ? `Something went wrong: ${label}`
      : label;
    return { time: t, text };
  });
}

export function sampleFrom(raw: unknown): SampleEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Row;
  if (!str(e.id) && !str(e.message)) return null;
  return {
    id: str(e.id),
    kind: str(e.kind),
    message: str(e.message),
    stack: str(e.stack),
    route: str(e.route),
    projectId: str(e.project_id) || null,
    apiPath: str(e.api_path),
    httpMethod: str(e.http_method),
    httpStatus: num(e.http_status),
    requestId: str(e.request_id),
    durationMs: num(e.duration_ms),
    device: deviceText(e.context),
    steps: stepsFrom(e.breadcrumbs),
    userId: str(e.user_id) || null,
    occurredAt: str(e.occurred_at),
  };
}

/** A title anyone can read. The raw message stays under "technical details". */
export function plainTitle(kind: string, message: string, route: string, apiPath: string, httpStatus: number | null, method: string): string {
  const screen = screenName(route);
  if (kind === "api_failure") {
    const what = apiPath ? screenName(apiPath.replace(/^\/api/, "")) : "the server";
    const verb = method && method !== "GET" ? "Saving or changing" : "Loading";
    const why = httpStatus === 0 || httpStatus == null ? "the server did not answer" : httpStatus >= 500 ? "the server had a problem" : httpStatus === 401 || httpStatus === 403 ? "the person was not allowed" : httpStatus === 404 ? "it could not be found" : `the server refused it (${httpStatus})`;
    return `${verb} ${what} did not work: ${why}`;
  }
  if (kind === "render_error") return `The screen "${screen}" could not open`;
  if (kind === "unhandled_rejection") return `Something behind the scenes failed on "${screen}"`;
  return `Something stopped working on "${screen}"`;
}

export function normaliseIssue(raw: unknown): Issue {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const sample = sampleFrom(r.sample_event);
  const status = ["open", "fixed", "reopened", "ignored"].includes(str(r.status)) ? (str(r.status) as Issue["status"]) : "open";
  const fixFiles = arr(r.fix_files).map((f) => {
    const o = (f && typeof f === "object" ? f : {}) as Row;
    return { path: str(o.path), change: str(o.change) };
  }).filter((f) => f.path);
  const message = sample?.message || str(r.title);
  return {
    id: str(r.id),
    title: sample ? plainTitle(sample.kind, sample.message, sample.route, sample.apiPath, sample.httpStatus, sample.httpMethod) : str(r.title) || message || "A problem was reported",
    status,
    occurrences: num(r.occurrences) ?? 1,
    firstSeenAt: str(r.first_seen_at),
    lastSeenAt: str(r.last_seen_at),
    lastEventAt: str(r.last_event_at),
    projectIds: arr(r.project_ids).map(str).filter(Boolean),
    routes: arr(r.routes).map(str).filter(Boolean),
    reopenedCount: num(r.reopened_count) ?? 0,
    people: num(r.people ?? r.distinct_users ?? r.user_count),
    fixSummary: str(r.fix_summary),
    fixFiles,
    fixCommit: str(r.fix_commit),
    fixedAt: str(r.fixed_at),
    fixedBy: str(r.fixed_by),
    sample,
  };
}

/** How many different people hit this, counted from the sightings the detail read returns. */
export function distinctPeople(events: unknown): number {
  return new Set(arr(events).map((e) => str((e as Row | null)?.user_id)).filter(Boolean)).size;
}

export type TimelineEntry = { id: string; time: string; isError: boolean; text: string; project: string | null; who: string | null; severity: string; outcome: string };

export function timelineEntries(raw: unknown): TimelineEntry[] {
  return arr(raw).map((x) => {
    const e = (x && typeof x === "object" ? x : {}) as Row;
    const kind = str(e.kind);
    const isError = kind !== "action";
    const text = isError
      ? plainTitle(kind, str(e.message), str(e.route), str(e.api_path), num(e.http_status), str(e.http_method))
      : `${plainActionName(str(e.action_name)) || "An action"} — ${str(e.outcome) === "failed" ? "failed" : "worked"}${num(e.duration_ms) != null ? ` (${Math.round((num(e.duration_ms) ?? 0) / 100) / 10} s)` : ""}`;
    return { id: str(e.id), time: str(e.occurred_at), isError, text, project: str(e.project_id) || null, who: str(e.user_id) || null, severity: str(e.severity), outcome: str(e.outcome) };
  });
}

export function formatWhen(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (!iso || Number.isNaN(t.getTime())) return "unknown time";
  const mins = Math.round((now.getTime() - t.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return t.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** The complete plain-text report of one problem, written to be pasted straight to an AI. */
export function buildCopyReport(issue: Issue, opts: { projectNames?: Record<string, string>; people?: number | null } = {}): string {
  const s = issue.sample;
  const names = opts.projectNames ?? {};
  const projects = issue.projectIds.map((p) => (names[p] ? `${names[p]} (${p})` : p)).join(", ") || "none recorded";
  const lines: string[] = [];
  lines.push("PROJEXA PROBLEM REPORT");
  lines.push(`Problem: ${issue.title}`);
  lines.push(`Status: ${issue.status}${issue.reopenedCount ? ` (came back ${issue.reopenedCount} time(s) after a fix)` : ""}`);
  lines.push(`Happened: ${issue.occurrences} time(s)${opts.people != null ? ` to ${opts.people} person(s)` : ""}; first ${issue.firstSeenAt || "?"}, last ${issue.lastEventAt || issue.lastSeenAt || "?"}`);
  lines.push(`Screen: ${s?.route || issue.routes.join(", ") || "unknown"}`);
  lines.push(`Project(s): ${projects}`);
  if (s?.apiPath) lines.push(`Server call: ${s.httpMethod || "?"} ${s.apiPath} -> HTTP ${s.httpStatus ?? "?"}${s.durationMs != null ? ` after ${s.durationMs} ms` : ""}${s.requestId ? ` (request id ${s.requestId})` : ""}`);
  if (s?.device) lines.push(`Device: ${s.device}`);
  lines.push("");
  lines.push("What the person was doing, step by step:");
  if (s?.steps.length) s.steps.forEach((st, i) => lines.push(`  ${i + 1}. ${st.time ? `[${st.time}] ` : ""}${st.text}`));
  else lines.push("  (no steps were recorded)");
  lines.push("");
  lines.push("Error message:");
  lines.push(s?.message || "(none)");
  lines.push("");
  lines.push("Stack:");
  lines.push(s?.stack || "(none)");
  if (issue.status === "fixed" || issue.fixSummary) {
    lines.push("");
    lines.push(`Fix recorded: ${issue.fixSummary || "(no summary)"}${issue.fixedAt ? ` on ${issue.fixedAt}` : ""}${issue.fixCommit ? ` in commit ${issue.fixCommit}` : ""}`);
    issue.fixFiles.forEach((f) => lines.push(`  - ${f.path}: ${f.change}`));
  }
  lines.push("");
  lines.push(`Issue id: ${issue.id}`);
  return lines.join("\n");
}
