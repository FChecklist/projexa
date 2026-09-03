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
import {
  isSystemFailureCode,
  maskTechnical,
  resolveTaskError,
  type MissingStep,
  type TaskErrorAction,
  type TaskErrorCode,
} from "@/lib/task-errors";

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
  /**
   * R67 C-13: the server's own answer to "can anyone on site do something
   * about this?" Stated rather than inferred -- the client should not have to
   * know which codes mean an outage to keep them out of its needs-you badge.
   * Absent on every row written before C-13, which is why the code is still
   * consulted as a fallback.
   */
  systemFailure?: boolean | null;
  /** The slots the server says are missing, most important first. */
  missing?: string[] | null;
  params?: Record<string, unknown> | null;
  /** R67 C-11: what the function actually returned, so a done row can link to it. */
  result?: Record<string, unknown> | null;
  rawInput?: string | null;
  mode?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** What a row's button does when pressed. */
export type RowActionKind = TaskErrorAction | "dismiss" | "open";

export type RowAction = {
  kind: RowActionKind;
  /** A word, never an icon: "Pick line", "Choose project", "Retry", "Dismiss". */
  label: string;
  /** For a "fix": which picker the loaded chain should open. */
  // R67 C-16: one exported union (task-errors.ts's MissingStep), because this
  // is now the key into chain-walk.ts's level table -- "which picker answers
  // this?" -- and three hand-written copies of it is three places to forget.
  missingStep: MissingStep | null;
  /** For an "open": where the row's object actually is. */
  href?: string;
};

export type ProjexaTaskRow = {
  id: string;
  state: TaskState;
  verb: TaskVerb;
  /** The rest of line 1. Never a function id, never carries an underscore. */
  object: string;
  /**
   * R67 C-10: line 1, whole: "<Verb> <Object> > <Step>". Built here rather
   * than concatenated at each render, so the rule that it can never contain
   * an underscore is enforceable in one place -- and is enforced, below.
   */
  title: string;
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
  /**
   * R67 C-10: a failure the user can do nothing about (a pool timeout, an
   * upstream 5xx). These leave the needs-you list entirely -- see tabView.
   */
  isSystemFailure: boolean;
  rawInput: string | null;
  /** The task's original params, so a Retry can re-post the IDENTICAL body. */
  params: Record<string, unknown>;
  /** Epoch ms, or null when the row carried no usable timestamp. */
  createdAtMs: number | null;
  actions: RowAction[];
};

/** GET /api/tasks now returns the task's `result` too (R67 C-11). */
export type ApiTaskResult = Record<string, unknown> | null | undefined;

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

// ---------------------------------------------------------------------------
// WHERE A ROW'S OBJECT ACTUALLY IS
// ---------------------------------------------------------------------------

// R67 C-11: "Done rows ... show their object id as a link." A finished task
// with nowhere to go is a receipt for something the user cannot look at. One
// entry per function that produces a row somebody can open; a function absent
// from this table gets no link rather than a guessed one.
const OBJECT_ROUTES: Readonly<Record<string, string>> = {
  record_work_progress: "/work-progress",
  record_timesheet: "/schedule/timesheet",
  "reports.report": "/reports",
  get_construction_project_dashboard: "/dashboard/project",
  get_construction_budget_status: "/budgets",
  list_delayed_activities: "/schedule",
  list_over_budget_projects: "/budgets",
  list_customers: "/customers",
  list_leads: "/leads",
  list_opportunities: "/opportunities",
};

/** The screen a finished task's object lives on, with the project carried. */
export function objectRouteFor(functionId: string | null | undefined, projectId: string | null): string | null {
  const base = functionId ? OBJECT_ROUTES[functionId] : undefined;
  if (!base) return null;
  return projectId ? `${base}?projectId=${encodeURIComponent(projectId)}` : base;
}

/**
 * The id printed on a done row's link -- ONLY when it is one a person can read.
 *
 * compliance keys its progress and timesheet rows with cuids, and "View
 * cm3x8k2p90001qz7h3f2l9d4e" is not an id a foreman recognises; it is noise
 * that pushes the useful word off the button. Same rule the C-09 receipt
 * follows: print a short human id, never a 25-character key, and never invent
 * one the row does not carry.
 */
export function objectIdLabel(result: ApiTaskResult): string | null {
  if (!result || typeof result !== "object") return null;
  const number = (result as Record<string, unknown>).number;
  if (typeof number === "number" && Number.isFinite(number)) return `#${number}`;
  for (const key of ["code", "reference", "entryNumber", "documentNumber"]) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() && value.trim().length <= 16) return value.trim();
  }
  const id = (result as Record<string, unknown>).id;
  if (typeof id === "string" && id.trim().length > 0 && id.trim().length <= 12) return id.trim();
  return null;
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
  const objectRoute = objectRouteFor(t.functionId, t.projectId ?? null);
  const actions: RowAction[] = [];
  if (resolved) {
    // R67 C-13: an "open" action needs somewhere to go. Where the pipeline
    // cannot run a function AND this product has no screen for it either,
    // there is no honest button at all -- so the row states the fact and
    // offers nothing, rather than a control that does nothing.
    if (resolved.action !== "open" || objectRoute) {
      actions.push({
        kind: resolved.action,
        label: resolved.verbLabel,
        missingStep: resolved.missingStep,
        href: resolved.action === "open" ? objectRoute ?? undefined : undefined,
      });
    }
  }
  // C-01: "Add 'Dismiss' on blocked rows older than 24 h." A row nobody has
  // fixed in a day is clutter on the one list that is supposed to be the
  // user's real work, and hiding it is reversible.
  if (group === "blocked" && createdAtMs !== null && now - createdAtMs > DAY_MS) {
    actions.push({ kind: "dismiss", label: "Dismiss", missingStep: null });
  }

  // R67 C-11: a done row's own object, reachable. The word carries the id when
  // the row has a readable one, so the link IS the id rather than a bare
  // "View" beside an id printed somewhere else.
  if (group === "done" && objectRoute) {
    const idLabel = objectIdLabel(t.result);
    actions.push({
      kind: "open",
      label: idLabel ? `View ${idLabel}` : "View",
      missingStep: null,
      href: objectRoute,
    });
  }

  const verb = verbFor(t.functionId);
  const object = assertNoUnderscore(maskTechnical(objectFor(t)));

  return {
    id: t.id,
    state,
    verb,
    object,
    title: `${verb} ${object}`,
    detail,
    urgency: group === "blocked" ? "late" : group === "done" ? "done" : "later",
    urgencyLabel: group === "blocked" ? "blocked" : group === "done" ? "done" : "queued",
    // R67 C-11: a done row's click opens the object it produced. On every
    // other row it stays undefined, so a click still only LOADS the chain --
    // the load-never-execute rule is untouched either way.
    route: group === "done" && objectRoute ? objectRoute : undefined,
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
    // R67 C-13: the SERVER's answer first, this file's inference second. A row
    // written before C-13 carries no flag, and those still have to be
    // classified from the code -- which is what isSystemFailureCode does.
    isSystemFailure: t.systemFailure === true || isSystemFailureCode(resolved?.code ?? null),
    rawInput: t.rawInput ?? null,
    params: t.params ?? {},
    createdAtMs,
    actions,
  };
}

/**
 * R67 C-10's guard: "add a guard rejecting underscores in a rendered task
 * name". It does not throw -- a thrown error in a list renderer would take
 * the whole pane down over a cosmetic defect -- it REPAIRS: an underscore
 * becomes a space, so the worst case is a slightly odd title rather than
 * "record_work_progress" on a site engineer's screen.
 */
export function assertNoUnderscore(name: string): string {
  return name.includes("_") ? name.replace(/_+/g, " ").replace(/\s{2,}/g, " ").trim() : name;
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

/**
 * R67 C-11 -- WHAT EACH TAB ASKS THE SERVER FOR.
 *
 * The tab click already wrote ?taskTab; it drove the highlight and nothing
 * else, so every navigation pulled fifty rows of everything and filtered them
 * in the browser. These are VERIDIAN's own tab vocabulary
 * (src/lib/pipeline/task-tabs.ts): null means "no status filter", which is
 * what Home needs because Home shows both groups at once.
 */
export const TAB_STATUS_QUERY: Readonly<Record<TaskTabId, string | null>> = {
  home: null,
  "approval-pending": "approval",
  "in-queue": "queued",
  completed: "done",
  // History is Completed filtered by a DATE rule the server does not carry, so
  // it asks for the same rows and narrows them here.
  history: "done",
};

/** VERIDIAN's `counts.tabs` payload, keyed by its own vocabulary. */
export type ServerTabCounts = Partial<Record<"needs_you" | "waiting" | "approval" | "queued" | "done", number>> & {
  /**
   * R67 FIX PASS -- how many of the server's needs-you rows are infrastructure
   * failures. Needed so HOME's server number can be built with the SAME
   * definition as its rendered one; see homeServerCount() below.
   */
  systemBlocked?: number;
};

/**
 * *** FIX PASS -- HOME'S NUMBER MUST MEAN ONE THING. ***
 *
 * Untruncated, Home printed views.home.count, which tabView defines as
 * needsYou (SYSTEM FAILURES EXCLUDED) + running + done. Truncated, it fell back
 * to the server's GRAND TOTAL over the whole scope, which includes them. So the
 * badge jumped by exactly the number of system failures the moment an org
 * crossed the page limit -- the same "the number silently changes meaning"
 * defect C-11 was raised to remove for the other tabs.
 *
 * This builds Home's server number the way tabView builds its rendered one:
 * the needs-you tab's rows minus the infrastructure ones, plus the queue and
 * the completed. It returns undefined rather than guessing when any piece is
 * absent -- no number at all is better than a differently-defined one, which
 * is the rule History already follows in this same function.
 *
 * It cannot account for LOCALLY dismissed rows, and neither can any server
 * count; that divergence is the one this function's own header already accepts
 * for every non-active tab.
 */
export function homeServerCount(serverTabs: ServerTabCounts | null): number | undefined {
  if (!serverTabs) return undefined;
  const { needs_you: needsYou, queued, done, systemBlocked = 0 } = serverTabs;
  if (needsYou === undefined || queued === undefined || done === undefined) return undefined;
  return Math.max(0, needsYou - systemBlocked) + queued + done;
}

/**
 * The number printed on each tab.
 *
 * TWO SOURCES, AND THE RULE FOR CHOOSING BETWEEN THEM IS THE POINT:
 *
 *  - The tab you are LOOKING AT counts the rows in front of you. A badge that
 *    disagrees with the list under it is the defect C-01 was raised for, and
 *    local facts the server cannot know (a dismissed row, the system-failure
 *    split from C-10) only apply to the rows actually loaded.
 *  - Every OTHER tab takes the server's count, because its rows are not in
 *    memory at all -- that is the whole saving C-11 asks for.
 *  - When the page was truncated by `limit`, the rendered count is a page and
 *    the server's is the truth, so the server's wins even for the active tab
 *    and the caller says "showing the newest N of M" beneath the list.
 *  - History has NO server number (its 7-day rule is client-side), so it
 *    prints one only while the done rows it is derived from are loaded.
 *    An unknown count is left undefined and no number is printed -- inventing
 *    one is worse than omitting it.
 */
export function mergeTabCounts(input: {
  views: Record<TaskTabId, { count: number }>;
  serverTabs: ServerTabCounts | null;
  /**
   * The server's grand total over the scope. Kept in the signature because the
   * caller reads it for the "Showing the newest 50 of 120." line beneath the
   * list -- which is the ONE thing it is honestly the number for. It is
   * deliberately not used as any tab's badge: see homeServerCount().
   */
  serverTotal?: number | null;
  activeTab: TaskTabId;
  truncated: boolean;
}): Record<TaskTabId, number | undefined> {
  const { views, serverTabs, activeTab, truncated } = input;
  const server: Record<TaskTabId, number | undefined> = {
    // NOT serverTotal -- see homeServerCount() for why that number means
    // something different from the one this tab renders.
    home: homeServerCount(serverTabs),
    "approval-pending": serverTabs?.approval,
    "in-queue": serverTabs?.queued,
    completed: serverTabs?.done,
    history: undefined,
  };

  const doneRowsLoaded = TAB_STATUS_QUERY[activeTab] === null || TAB_STATUS_QUERY[activeTab] === "done";

  const out = {} as Record<TaskTabId, number | undefined>;
  for (const tab of TASK_TAB_IDS) {
    const rendered = views[tab]?.count;
    if (tab === "history") {
      out[tab] = doneRowsLoaded ? rendered : undefined;
      continue;
    }
    if (tab === activeTab && !truncated) {
      out[tab] = rendered;
      continue;
    }
    out[tab] = server[tab] ?? (tab === activeTab ? rendered : undefined);
  }
  return out;
}

/** Every tab id, in the order the strip renders them. */
export const TASK_TAB_IDS: readonly TaskTabId[] = [
  "home",
  "approval-pending",
  "in-queue",
  "completed",
  "history",
];

/**
 * C-11: "print each tab's count in its label". One string, so the label and
 * its number can never be rendered from two different places -- which is how
 * a badge and a list stopped agreeing in the first place.
 */
export function countedTabLabel(label: string, count: number | undefined): string {
  return typeof count === "number" && Number.isFinite(count) ? `${label} (${count})` : label;
}

/** "Showing the newest 50 of 120." -- said in words when a page is not the whole list. */
export function pageNote(returned: number, total: number | null | undefined, truncated: boolean): string | null {
  if (!truncated) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= returned) {
    return `Showing the newest ${returned}.`;
  }
  return `Showing the newest ${returned} of ${total}.`;
}

export type TabView = {
  primaryLabel: string;
  primaryEmpty: string;
  primary: ProjexaTaskRow[];
  /**
   * R67 C-11: "The History tab lists past tasks ... grouped by day." Present
   * only on History; every other tab renders one flat list.
   */
  dayGroups?: { key: string; label: string; rows: ProjexaTaskRow[] }[];
  secondaryLabel?: string;
  secondaryEmpty?: string;
  secondary?: ProjexaTaskRow[];
  /**
   * R67 C-10: the System group -- rows nobody on site can act on. It is
   * rendered, because hiding a failure is how a write is silently lost, but
   * it is NOT part of `count`, so the Home badge means "things you can do".
   */
  systemLabel?: string;
  systemEmpty?: string;
  system?: ProjexaTaskRow[];
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
 * R67 C-13: "History = done older than 7 days". C-01 built this tab as
 * "anything completed before today"; C-13 is the later and more specific rule
 * and it wins, because with the earlier one History and Completed showed
 * almost the same rows the day after any work happened. Nothing disappears
 * either way -- Completed still lists every done row; History is a subset of
 * it.
 */
const HISTORY_AGE_DAYS = 7;

/**
 * R67 C-11: History, grouped by day, newest day first.
 *
 * The label is the day in this product's own pinned format (en-GB, UTC, the
 * same choice src/lib/format-date.ts makes) rather than a locale-dependent
 * string that renders differently for the reader and the tester.
 */
export function groupRowsByDay(rows: readonly ProjexaTaskRow[]): { key: string; label: string; rows: ProjexaTaskRow[] }[] {
  const byKey = new Map<string, { key: string; label: string; rows: ProjexaTaskRow[]; sortAt: number }>();
  for (const row of rows) {
    const at = row.createdAtMs;
    const key = at === null ? "unknown" : new Date(at).toISOString().slice(0, 10);
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.sortAt = Math.max(existing.sortAt, at ?? 0);
      continue;
    }
    byKey.set(key, {
      key,
      // A row with no usable timestamp is still shown, under a heading that
      // says so -- dropping it would lose a real finished task over a missing
      // field.
      label: at === null ? "Date not recorded" : formatDayLabel(at),
      rows: [row],
      sortAt: at ?? 0,
    });
  }
  return [...byKey.values()].sort((a, b) => b.sortAt - a.sortAt).map(({ key, label, rows: r }) => ({ key, label, rows: r }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Which rows a tab shows, what its heading says, and what it says when it is
 * empty. C-01: "each empty tab states its own purpose."
 */
export function tabView(groups: GroupedRows, tab: TaskTabId, now: number): TabView {
  // "Needs you" carries what is stuck on the user, blocked first, because a
  // blocked row is the only loud one and the one that costs time.
  //
  // R67 C-10: EXCEPT the ones nobody on site can act on. A pool timeout is
  // not a decision waiting on a foreman, and a needs-you count that includes
  // it is a count that cannot be worked down to zero.
  const all = [...groups.blocked, ...groups.needsYou];
  const needsYou = all.filter((r) => !r.isSystemFailure);
  const system = all.filter((r) => r.isSystemFailure);
  const historyBefore = startOfDay(now) - HISTORY_AGE_DAYS * DAY_MS;
  const isHistory = (r: ProjexaTaskRow) => r.createdAtMs !== null && r.createdAtMs < historyBefore;

  switch (tab) {
    case "approval-pending":
      return {
        primaryLabel: "Approval pending",
        primaryEmpty: "Nothing waiting for your approval",
        primary: needsYou,
        systemLabel: system.length > 0 ? "System" : undefined,
        systemEmpty: system.length > 0 ? "Nothing went wrong on our side." : undefined,
        system: system.length > 0 ? system : undefined,
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
      const past = groups.done.filter(isHistory);
      return {
        primaryLabel: "History",
        primaryEmpty: "Nothing finished more than a week ago",
        primary: past,
        dayGroups: groupRowsByDay(past),
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
        systemLabel: system.length > 0 ? "System" : undefined,
        systemEmpty: system.length > 0 ? "Nothing went wrong on our side." : undefined,
        system: system.length > 0 ? system : undefined,
        // The badge counts what a person can DO. System rows are shown but
        // never counted -- C-10: "so 'Needs you' contains only rows the user
        // can act on".
        count: needsYou.length + waiting.length,
      };
    }
  }
}
