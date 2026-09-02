// R67 WS-C (C-01, extended by C-10/C-11) -- HOW A pipeline_tasks ROW BECOMES
// A SENTENCE A PERSON CAN READ, and which tab it belongs to.
//
// This was inline in M24Shell.tsx (toTaskRow, :100-130) where it could not be
// tested and where two defects lived:
//
//   1. `object: steps.length ? steps.join(" > ") : (t.functionId ?? "task")`
//      -- the fallback rendered the raw function id, producing rows that read
//      "Record record_work_progress" and "Review
//      get_construction_project_dashboard" beside properly titled ones.
//   2. `detail: t.error ?? t.rawInput` -- the backend's own words, which is
//      how "write CONNECT_TIMEOUT 3.109.171.244:6543" reached a site
//      engineer's screen.
//
// Both are closed here: the object comes from a DISPLAY REGISTRY keyed by
// function id (and never from the id itself), and the detail comes from
// src/lib/task-errors.ts's D-03 dictionary (and never from t.error).
//
// PURE. No React, no fetch, no Date.now() of its own -- `now` is passed in --
// so every rule below is asserted in task-row.test.ts.

import type { ChainMode } from "@fchecklist/veridian-ui-kit/shell";
import { maskTechnical, resolveTaskError, type TaskErrorAction, type TaskErrorCode } from "@/lib/task-errors";

/** M24's closed verb set, the kit's TASK_VERBS. Line 1 always opens with one. */
export type TaskVerb = "Approve" | "Confirm" | "Sign off" | "Review" | "Import" | "Record";

/** The four glyph states the kit's TaskMaster draws. */
export type TaskState = "needs-you" | "running" | "waiting" | "done";

export type TaskGroup = "needsYou" | "running" | "done" | "blocked";

export type TaskTabId = "home" | "approval-pending" | "in-queue" | "completed" | "history";

/** GET /api/tasks -> VERIDIAN /api/v1/projexa/tasks. `errorCode` and `missing`
 *  are WS-B's addition; every field is optional because the rows already in
 *  compliance.pipeline_tasks predate them. */
export type ApiTask = {
  id: string;
  projectId?: string | null;
  derivedChain?: { full?: string; mode?: string; root?: string; steps?: string[] } | null;
  functionId?: string | null;
  status?: string | null;
  error?: string | null;
  /** D-03's closed vocabulary, when the server sends it. */
  errorCode?: string | null;
  /** The slots the server says are missing, most important first. */
  missing?: string[] | null;
  params?: Record<string, unknown> | null;
  rawInput?: string | null;
  mode?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** What a row's button does when pressed. */
export type RowActionKind = TaskErrorAction | "dismiss";

export type RowAction = {
  kind: RowActionKind;
  /** A word, never an icon: "Pick line", "Choose project", "Retry", "Dismiss". */
  label: string;
  /** For a "fix": which picker the loaded chain should open. */
  missingStep: "boqLine" | "project" | "value" | null;
};

export type ProjexaTaskRow = {
  id: string;
  state: TaskState;
  verb: TaskVerb;
  /** The rest of line 1. Never a function id, never carries an underscore. */
  object: string;
  /** Line 2. A D-03 sentence for a failure, the user's own words otherwise. */
  detail?: string;
  urgency: "late" | "today" | "later" | "done";
  urgencyLabel: string;
  chain: { mode: ChainMode; segments: { id: string; label: string; kind: "root" | "action" | "step" }[] };
  route?: string;
  /** Carried so a Fix/Retry can rebuild the identical submission. */
  functionId: string | null;
  projectId: string | null;
  errorCode: TaskErrorCode | null;
  rawInput: string | null;
  /** The task's original params, so a Retry can re-post the IDENTICAL body. */
  params: Record<string, unknown>;
  /** Epoch ms, or null when the row carried no usable timestamp. */
  createdAtMs: number | null;
  actions: RowAction[];
};

// ---------------------------------------------------------------------------
// THE DISPLAY REGISTRY
// ---------------------------------------------------------------------------

// One entry per function the pipeline can actually run today
// (executor.ts's EXECUTORS, plus reports.report and record_timesheet, which
// R67 registers). The value is the OBJECT of the sentence -- the verb is
// prepended from verbFor() -- and it is already in M24's chain grammar, so
// "Record" + "Work Progress > New entry" reads as one line.
export const FUNCTION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  record_work_progress: "Work Progress > New entry",
  record_timesheet: "Timesheet > New entry",
  "reports.report": "Reports",
  get_construction_project_dashboard: "Dashboard",
  get_construction_budget_status: "Budget",
  get_construction_kpi_status: "Reports > KPI status",
  list_delayed_activities: "Schedule > Delayed activities",
  list_over_budget_projects: "Budget > Over budget",
  generate_construction_progress_summary: "Reports > Progress summary",
  detect_construction_budget_schedule_risk: "Reports > Risk",
  get_compliance_stats: "Compliance",
  get_overdue_items: "Compliance > Overdue",
  list_departments: "Departments",
  list_compliance_items: "Compliance Register",
  list_notices: "Notices",
  list_gst_import_batches: "GST > Import batches",
  list_gst_returns: "GST > Returns",
  list_customers: "Customers",
  list_sales_orders: "Sales Orders",
  list_leads: "Leads",
  list_opportunities: "Opportunities",
  get_sales_pipeline_overview: "Sales Pipeline",
};

// Verb prefixes carried by the real function ids, dropped from the object so
// "Record record work progress" cannot happen. Same closed list VERIDIAN's
// derive-chain.ts uses, for the same reason: not a general English rule.
const VERB_PREFIXES: readonly string[] = [
  "record", "create", "update", "delete", "import", "approve", "generate", "detect", "list", "get",
];

/**
 * The last-resort object for a function id with no registry entry. It must
 * still be readable: an id is turned into words, the verb token is dropped
 * (the verb is already line 1's first word) and the result is title-cased.
 * "record_work_progress" -> "Work Progress". NEVER the id itself.
 */
export function humaniseFunctionId(functionId: string): string {
  const tokens = functionId
    .replace(/[.:]/g, "_")
    .split("_")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "Task";
  const withoutVerb = VERB_PREFIXES.includes(tokens[0].toLowerCase()) && tokens.length > 1 ? tokens.slice(1) : tokens;
  // "construction" is a namespace token in this catalogue, not a word the
  // user needs -- get_construction_budget_status is the Budget screen.
  const words = withoutVerb.filter((t) => t.toLowerCase() !== "construction");
  const useful = words.length > 0 ? words : withoutVerb;
  return useful.map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()).join(" ");
}

/** The object of line 1: registry first, then the derived chain, then words. */
export function objectFor(t: Pick<ApiTask, "functionId" | "derivedChain">): string {
  const fid = t.functionId ?? "";
  const registered = FUNCTION_DISPLAY_NAMES[fid];
  if (registered) return registered;
  const steps = t.derivedChain?.steps ?? [];
  if (steps.length > 0) return steps.join(" > ");
  if (fid) return humaniseFunctionId(fid);
  return "Task";
}

/**
 * M24: "Line 1 must START WITH A VERB from a CLOSED SET." Derived from the
 * function id so it can never drift outside the set.
 */
export function verbFor(functionId?: string | null): TaskVerb {
  const f = (functionId ?? "").toLowerCase();
  if (f.startsWith("record_") || f.includes("progress")) return "Record";
  if (f.startsWith("import_") || f.includes("import")) return "Import";
  if (f.includes("approve")) return "Approve";
  if (f.includes("confirm")) return "Confirm";
  if (f.includes("sign")) return "Sign off";
  return "Review";
}

// ---------------------------------------------------------------------------
// THE ROW
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** Line 2 is a glance, not a paragraph. The kit's own LINE2_MAX. */
const DETAIL_MAX = 55;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export type ToTaskRowContext = {
  /** Now, in epoch ms. Passed in so "older than 24 h" is testable. */
  now?: number;
  /** The project the row belongs to, for the BOQ_LINE_NOT_FOUND sentence. */
  projectName?: string | null;
};

export function toTaskRow(t: ApiTask, group: TaskGroup, ctx: ToTaskRowContext = {}): ProjexaTaskRow {
  const now = ctx.now ?? Date.now();
  const steps = t.derivedChain?.steps ?? [];
  const root = t.derivedChain?.root ?? null;

  // A BLOCKED task is one that needs you -- it is stuck on a decision only the
  // user can make -- so it takes the needs-you glyph and the loud pill.
  const state: TaskState = group === "done" ? "done" : group === "running" ? "running" : "needs-you";

  const failed = group === "blocked" || Boolean(t.errorCode) || Boolean(t.error);
  const resolved = failed
    ? resolveTaskError({
        code: t.errorCode,
        missing: t.missing ?? null,
        raw: t.error ?? null,
        itemCode: typeof t.params?.itemCode === "string" ? (t.params.itemCode as string) : null,
        projectName: ctx.projectName ?? null,
      })
    : null;

  // Line 2. A failure gets D-03's sentence; anything else gets the user's own
  // words -- masked, because a person can paste anything into the composer.
  const detail = resolved
    ? resolved.sentence
    : t.rawInput
      ? truncate(maskTechnical(t.rawInput), DETAIL_MAX)
      : undefined;

  const createdAtMs = parseMs(t.createdAt);
  const actions: RowAction[] = [];
  if (resolved) {
    actions.push({ kind: resolved.action, label: resolved.verbLabel, missingStep: resolved.missingStep });
  }
  // C-01: "Add 'Dismiss' on blocked rows older than 24 h." A row nobody has
  // fixed in a day is clutter on the one list that is supposed to be the
  // user's real work, and hiding it is reversible.
  if (group === "blocked" && createdAtMs !== null && now - createdAtMs > DAY_MS) {
    actions.push({ kind: "dismiss", label: "Dismiss", missingStep: null });
  }

  return {
    id: t.id,
    state,
    verb: verbFor(t.functionId),
    object: maskTechnical(objectFor(t)),
    detail,
    urgency: group === "blocked" ? "late" : group === "done" ? "done" : "later",
    urgencyLabel: group === "blocked" ? "blocked" : group === "done" ? "done" : "queued",
    chain: {
      mode: (t.mode?.toLowerCase() as ChainMode) ?? "projects",
      segments: [
        ...(root ? [{ id: t.projectId ?? root, label: root, kind: "root" as const }] : []),
        ...steps.map((label, i) => ({ id: `${t.id}-s${i}`, label, kind: "step" as const })),
      ],
    },
    functionId: t.functionId ?? null,
    projectId: t.projectId ?? null,
    errorCode: resolved?.code ?? null,
    rawInput: t.rawInput ?? null,
    params: t.params ?? {},
    createdAtMs,
    actions,
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// THE TABS ACTUALLY FILTER
// ---------------------------------------------------------------------------

export type GroupedRows = {
  needsYou: ProjexaTaskRow[];
  running: ProjexaTaskRow[];
  done: ProjexaTaskRow[];
  blocked: ProjexaTaskRow[];
};

export type TabView = {
  primaryLabel: string;
  primaryEmpty: string;
  primary: ProjexaTaskRow[];
  secondaryLabel?: string;
  secondaryEmpty?: string;
  secondary?: ProjexaTaskRow[];
  /**
   * The number printed in the tab's own label. It is derived from the SAME
   * arrays rendered beneath it, which is why the badge and the list can never
   * disagree -- the defect C-01 was raised for.
   */
  count: number;
};

/** Local midnight for `now`. "Before today" is a human boundary, not -24 h. */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Which rows a tab shows, what its heading says, and what it says when it is
 * empty. C-01: "each empty tab states its own purpose."
 */
export function tabView(groups: GroupedRows, tab: TaskTabId, now: number): TabView {
  // "Needs you" carries what is stuck on the user, blocked first, because a
  // blocked row is the only loud one and the one that costs time.
  const needsYou = [...groups.blocked, ...groups.needsYou];
  const midnight = startOfDay(now);
  const isOlderThanToday = (r: ProjexaTaskRow) => r.createdAtMs !== null && r.createdAtMs < midnight;

  switch (tab) {
    case "approval-pending":
      return {
        primaryLabel: "Approval pending",
        primaryEmpty: "Nothing waiting for your approval",
        primary: needsYou,
        count: needsYou.length,
      };
    case "in-queue":
      return {
        primaryLabel: "In queue",
        primaryEmpty: "Nothing is running right now",
        primary: groups.running,
        count: groups.running.length,
      };
    case "completed":
      return {
        primaryLabel: "Completed",
        primaryEmpty: "Nothing has finished yet",
        primary: groups.done,
        count: groups.done.length,
      };
    case "history": {
      const past = groups.done.filter(isOlderThanToday);
      return {
        primaryLabel: "History",
        primaryEmpty: "Nothing finished before today",
        primary: past,
        count: past.length,
      };
    }
    case "home":
    default: {
      const waiting = [...groups.running, ...groups.done];
      return {
        primaryLabel: "Needs you",
        primaryEmpty: "Nothing is waiting on you.",
        primary: needsYou,
        secondaryLabel: "Waiting on others",
        secondaryEmpty: "Nothing outstanding with anyone else.",
        secondary: waiting,
        count: needsYou.length + waiting.length,
      };
    }
  }
}
