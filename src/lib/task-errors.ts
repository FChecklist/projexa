// R67 WS-C (C-01 / C-05 / C-10), programme decision D-03 -- THE ONLY COPY OF
// THE FAILURE SENTENCES A PERSON IS ALLOWED TO READ.
//
// WHAT THIS EXISTS TO KILL. The Task Master pane renders whatever string the
// backend happened to put in compliance.pipeline_tasks.error. Real rows
// captured in the R66 walkthrough:
//
//   "Review Leads > View - write CONNECT_TIMEOUT 3.109.171.244:6543"
//   "Record record_work_progress - itemCode is required"
//   "item code 01 not found in this project's BOQ"
//
// A pooler IP, a port, a camelCase parameter name and a function id, shown to
// a site engineer who can do nothing with any of them. D-03 closes the
// vocabulary: the server returns a CODE (plus the missing field), and the
// sentence a person reads is chosen HERE, from the list below, in words that
// name the next action.
//
// THREE RULES THIS FILE ENFORCES:
//   1. A sentence is chosen by code, never copied from the backend's text.
//   2. Every sentence carries a VERB LABEL for its button -- "Pick line",
//      "Choose project", "Type value", "Retry" -- so a blocked row always has
//      a way out and never a dead end.
//   3. maskTechnical() is the LAST LINE OF DEFENCE for any string that still
//      reaches a screen: an IP:port, a host:port, an ECONN* or a
//      CONNECT_TIMEOUT is replaced with the words "service unavailable".
//
// The codes are D-03's, verbatim, and the sentences are D-03's, verbatim.

/** D-03's closed vocabulary, plus the one fallback every unknown code takes. */
export const TASK_ERROR_CODES = [
  "BOQ_LINE_REQUIRED",
  "BOQ_LINE_NOT_FOUND",
  "PROJECT_REQUIRED",
  "VALUE_REQUIRED",
  // R67 C-13: the two codes VERIDIAN's own pipeline already emits and this
  // dictionary had no sentence for. src/lib/pipeline/function-slots.ts has
  // declared them since C-03 with the note "every value here has a matching
  // sentence in PROJEXA's src/lib/task-errors.ts" -- which was not yet true,
  // so a timesheet short of a task read "Something went wrong" and an
  // unregistered function offered a Retry that could only fail again.
  "TASK_REQUIRED",
  // R67 C-16 quotes three question labels as D-03 vocabulary -- "Pick a BOQ
  // line", "Pick a worker", "Type quantity or %" -- and the middle one had no
  // sentence here. The picker behind it is real and shipped (C-08's roster
  // grid, level ["manpower","mark_attendance"]), so the sentence is what was
  // missing, not the answer.
  "WORKER_REQUIRED",
  "FUNCTION_NOT_AVAILABLE",
  "BACKEND_UNAVAILABLE",
  "UNKNOWN",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/**
 * What the row's button does.
 *   "fix"   -- load the chain with the missing step's picker open, AND STOP.
 *              It must never re-execute (M24's load-never-execute rule).
 *   "retry" -- re-submit the identical body. Only for transport failures,
 *              where nothing was written and repeating is safe.
 */
/**
 * R67 C-13 adds the third: "open".
 *   "open"  -- the pipeline cannot run this at all, so the only honest move is
 *              the screen that can. It executes nothing and retries nothing;
 *              offering a Retry for a function that is not registered is an
 *              invitation to fail twice.
 */
export type TaskErrorAction = "fix" | "retry" | "open";

/**
 * The chain step a failure is missing.
 *
 * R67 C-16 gives this its own exported name because it is now the KEY into
 * src/lib/chain-walk.ts's level table -- "which question does band 2 open to
 * answer this?" -- rather than only a hint for a Fix button. Three modules
 * used to spell the union out by hand, which is three places to forget a new
 * step in.
 */
export type MissingStep = "boqLine" | "project" | "value" | "task" | "worker";

export type TaskErrorEntry = {
  code: TaskErrorCode;
  /** The words a person reads. `{code}`, `{project}` and `{version}` are filled from context. */
  template: string;
  /** The button beside the sentence. A word, never an icon. */
  verbLabel: string;
  action: TaskErrorAction;
  /**
   * The chain step this failure is missing, so a "Fix" click knows which
   * picker to open. Null when the failure is not about a missing value.
   */
  missingStep: MissingStep | null;
};

export const TASK_ERROR_DICTIONARY: Readonly<Record<TaskErrorCode, TaskErrorEntry>> = {
  BOQ_LINE_REQUIRED: {
    code: "BOQ_LINE_REQUIRED",
    template: "Pick a BOQ line",
    verbLabel: "Pick line",
    action: "fix",
    missingStep: "boqLine",
  },
  BOQ_LINE_NOT_FOUND: {
    // D-03, verbatim. The placeholders are filled from the task's own context
    // when it carries one; an unfilled placeholder is dropped rather than
    // rendered, so a person never reads a literal "{project}".
    code: "BOQ_LINE_NOT_FOUND",
    template: "There is no line {code} on {project} {version} — pick a line",
    verbLabel: "Pick line",
    action: "fix",
    missingStep: "boqLine",
  },
  PROJECT_REQUIRED: {
    code: "PROJECT_REQUIRED",
    template: "Pick a project",
    verbLabel: "Choose project",
    action: "fix",
    missingStep: "project",
  },
  VALUE_REQUIRED: {
    code: "VALUE_REQUIRED",
    template: "Type quantity or %",
    verbLabel: "Type value",
    action: "fix",
    missingStep: "value",
  },
  TASK_REQUIRED: {
    code: "TASK_REQUIRED",
    template: "Pick a task",
    verbLabel: "Pick task",
    action: "fix",
    missingStep: "task",
  },
  WORKER_REQUIRED: {
    // R67 C-16, verbatim from the item's own list of question labels.
    code: "WORKER_REQUIRED",
    template: "Pick a worker",
    verbLabel: "Pick worker",
    action: "fix",
    missingStep: "worker",
  },
  FUNCTION_NOT_AVAILABLE: {
    code: "FUNCTION_NOT_AVAILABLE",
    // Not "something went wrong": nothing went wrong. The product does not do
    // this from here yet, and the sentence says so and points somewhere real.
    template: "PROJEXA can't do that from the composer yet",
    verbLabel: "Open the screen",
    action: "open",
    missingStep: null,
  },
  BACKEND_UNAVAILABLE: {
    code: "BACKEND_UNAVAILABLE",
    template: "The construction data service didn't answer — nothing was saved",
    verbLabel: "Retry",
    action: "retry",
    missingStep: null,
  },
  UNKNOWN: {
    // C-01: "unknown codes fall back to 'Something went wrong - Retry'". The
    // verb is the button, so the sentence itself stops before it.
    code: "UNKNOWN",
    template: "Something went wrong",
    verbLabel: "Retry",
    action: "retry",
    missingStep: null,
  },
};

// ---------------------------------------------------------------------------
// THE LAST LINE OF DEFENCE
// ---------------------------------------------------------------------------

/** An IPv4 address with a port: "3.109.171.244:6543" (the real captured row). */
const IP_PORT = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
/** A hostname with a port: "db.abcdef.supabase.co:5432", "localhost:3100". */
const HOST_PORT = /\b(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{2,5})\b/gi;
/** Node/Postgres transport codes that mean exactly one thing to a person: nothing. */
const TRANSPORT_CODE = /\b(?:ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|CONNECT_TIMEOUT|POOL_TIMEOUT)\b/g;

const SERVICE_UNAVAILABLE = "service unavailable";

/**
 * Replace anything that identifies infrastructure with the words "service
 * unavailable". Applied to every string this module returns AND, per C-01, to
 * any residual row text before it is rendered.
 *
 * Deliberately not a validator: it never throws and never blanks the string.
 * A sentence that survives it unchanged is a sentence that was already safe.
 */
export function maskTechnical(text: string): string {
  if (!text) return text;
  return text
    .replace(IP_PORT, SERVICE_UNAVAILABLE)
    .replace(TRANSPORT_CODE, SERVICE_UNAVAILABLE)
    .replace(HOST_PORT, SERVICE_UNAVAILABLE)
    // "service unavailable service unavailable" reads as a stutter; collapse.
    .replace(/(?:service unavailable[\s,]*)+/g, SERVICE_UNAVAILABLE)
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// READING A CODE OUT OF A LEGACY ROW
// ---------------------------------------------------------------------------

// WS-B adds `errorCode` to GET /api/v1/projexa/tasks. Until every row carries
// one -- and for the rows already in compliance.pipeline_tasks, which never
// will -- these patterns recover the code from the backend's own historic
// wording. Each pattern cites the executor line that produces it, so this is
// a translation of real strings rather than a guess.
const RAW_PATTERNS: ReadonlyArray<[RegExp, TaskErrorCode]> = [
  // executor.ts:47  -> `itemCode is required`
  [/\bitem\s*code is required\b/i, "BOQ_LINE_REQUIRED"],
  [/\bboq[_ ]?line[_ ]?item[_ ]?id\b.*\brequired\b/i, "BOQ_LINE_REQUIRED"],
  // executor.ts:65  -> `item code "01" not found in this project's BOQ`
  [/\bnot found in this project'?s boq\b/i, "BOQ_LINE_NOT_FOUND"],
  // validate.ts:71  -> `boq_line_item_id "x" does not exist in this BOQ`
  [/\bdoes not exist in this boq\b/i, "BOQ_LINE_NOT_FOUND"],
  // executor.ts:60  -> `no BOQ found for project "x"`
  [/\bno boq found for project\b/i, "BOQ_LINE_NOT_FOUND"],
  // executor.ts:49/99 -> `no project resolved for this task`
  [/\bno project resolved\b/i, "PROJECT_REQUIRED"],
  [/\bproject .* is not reachable\b/i, "PROJECT_REQUIRED"],
  // executor.ts:48  -> `percent is required`
  [/\b(?:percent|quantity|hours) is required\b/i, "VALUE_REQUIRED"],
  [/\bmust be a number between 0 and 100\b/i, "VALUE_REQUIRED"],
  // executor.ts executeRecordTimesheet -> the fuzzy task match, both shapes
  [/\bno task on this project matches\b/i, "TASK_REQUIRED"],
  [/\bmatches \d+ tasks on this project\b/i, "TASK_REQUIRED"],
  // run-submission.ts / validate.ts -> the function itself is not available
  [/\bno executor is registered\b/i, "FUNCTION_NOT_AVAILABLE"],
  [/\bnot in this module's candidate set\b/i, "FUNCTION_NOT_AVAILABLE"],
  [/\bis not permitted to execute\b/i, "FUNCTION_NOT_AVAILABLE"],
  // executor.ts:243 / the raw transport failures it now catches
  [/\b(?:ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|POOL_TIMEOUT)\b/, "BACKEND_UNAVAILABLE"],
  [/\b(?:timed? ?out|timeout|unavailable|internal error|502|503|504)\b/i, "BACKEND_UNAVAILABLE"],
];

/** The D-03 code a legacy `pipeline_tasks.error` string stands for, or null. */
export function inferTaskErrorCode(raw: string | null | undefined): TaskErrorCode | null {
  if (!raw || !raw.trim()) return null;
  for (const [pattern, code] of RAW_PATTERNS) {
    if (pattern.test(raw)) return code;
  }
  return null;
}

/**
 * R67 C-10: the server has its own names for the same infrastructure
 * failure -- UPSTREAM_TIMEOUT, POOL_TIMEOUT, INFRA_UNAVAILABLE (the code
 * C-13's migration will backfill). They are ALIASES, not new sentences: D-03's
 * vocabulary stays closed at five, and every one of these resolves to the one
 * sentence a person can act on.
 */
const SERVER_CODE_ALIASES: Readonly<Record<string, TaskErrorCode>> = {
  UPSTREAM_TIMEOUT: "BACKEND_UNAVAILABLE",
  POOL_TIMEOUT: "BACKEND_UNAVAILABLE",
  INFRA_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  CONNECT_TIMEOUT: "BACKEND_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "BACKEND_UNAVAILABLE",
};

/** A code string from the server, narrowed to the closed set. */
export function asTaskErrorCode(value: unknown): TaskErrorCode | null {
  if (typeof value !== "string") return null;
  if ((TASK_ERROR_CODES as readonly string[]).includes(value)) return value as TaskErrorCode;
  return SERVER_CODE_ALIASES[value.toUpperCase()] ?? null;
}

/**
 * R67 C-10: is this a failure the USER can do nothing about?
 *
 * It decides which rows leave the needs-you list. A site engineer cannot fix
 * a pool timeout, and a list that mixes those with "Pick a BOQ line" is a
 * list whose badge count means nothing.
 */
export function isSystemFailureCode(code: TaskErrorCode | null | undefined): boolean {
  return code === "BACKEND_UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// THE ONE ENTRY POINT
// ---------------------------------------------------------------------------

export type TaskErrorInput = {
  /** WS-B's `{ code, missing }` payload. Preferred over everything else. */
  code?: unknown;
  /** The field the server says is missing, when it names one. */
  missing?: readonly string[] | null;
  /** The legacy `pipeline_tasks.error` string. Used ONLY to infer a code. */
  raw?: string | null;
  /** Facts for the BOQ_LINE_NOT_FOUND sentence, when the row carries them. */
  itemCode?: string | null;
  projectName?: string | null;
  boqVersion?: string | null;
};

export type ResolvedTaskError = TaskErrorEntry & {
  /** The finished sentence, placeholders filled and technical text masked. */
  sentence: string;
  /** True when no code was supplied or inferred -- the UNKNOWN fallback. */
  inferred: boolean;
};

const MISSING_FIELD_CODES: Readonly<Record<string, TaskErrorCode>> = {
  task: "TASK_REQUIRED",
  issueid: "TASK_REQUIRED",
  itemcode: "BOQ_LINE_REQUIRED",
  boqlineitemid: "BOQ_LINE_REQUIRED",
  boqline: "BOQ_LINE_REQUIRED",
  projectid: "PROJECT_REQUIRED",
  project: "PROJECT_REQUIRED",
  percent: "VALUE_REQUIRED",
  quantity: "VALUE_REQUIRED",
  quantitydone: "VALUE_REQUIRED",
  hours: "VALUE_REQUIRED",
};

/**
 * The sentence, the verb and the action for one failed task.
 *
 * Resolution order, first hit wins:
 *   1. an explicit code from the server (WS-B's `{ code, missing }`)
 *   2. the first `missing` field name, mapped to its code
 *   3. the legacy error string, pattern-matched
 *   4. UNKNOWN
 */
export function resolveTaskError(input: TaskErrorInput): ResolvedTaskError {
  const explicit = asTaskErrorCode(input.code);
  const fromMissing = !explicit && input.missing?.length
    ? (MISSING_FIELD_CODES[input.missing[0].toLowerCase().replace(/[^a-z]/g, "")] ?? null)
    : null;
  const fromRaw = !explicit && !fromMissing ? inferTaskErrorCode(input.raw) : null;
  const code = explicit ?? fromMissing ?? fromRaw ?? "UNKNOWN";
  const entry = TASK_ERROR_DICTIONARY[code];

  return { ...entry, sentence: maskTechnical(fillTemplate(entry, input)), inferred: !explicit };
}

/**
 * D-03's one templated sentence, filled from real context.
 *
 * A MISSING FACT IS DROPPED, NOT PRINTED. Rendering "There is no line
 * {project}" to a site engineer would be its own defect, and so would
 * "There is no line  on   — pick a line" with the holes left as whitespace.
 * The sentence therefore degrades a clause at a time and always ends in the
 * instruction, which is the part that tells the user what to do next.
 */
function fillTemplate(entry: TaskErrorEntry, input: TaskErrorInput): string {
  if (entry.code !== "BOQ_LINE_NOT_FOUND") return entry.template;

  const code = input.itemCode?.trim() || "";
  const where = [input.projectName?.trim() || "", input.boqVersion?.trim() || ""].filter(Boolean).join(" ");

  if (code && where) return `There is no line ${code} on ${where} — pick a line`;
  if (code) return `There is no line ${code} on this BOQ — pick a line`;
  if (where) return `That line is not on ${where} — pick a line`;
  return "That line is not on this BOQ — pick a line";
}
