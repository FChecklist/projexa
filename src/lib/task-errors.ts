// R67 -- THE ONE PLACE A PIPELINE FAILURE (OR A FAILED READ) BECOMES A
// SENTENCE A PERSON CAN READ. Merged from two independent builds of the same
// idea (WS-C: C-01/C-05/C-10/C-13/C-16, decision D-03; WS-B: B-06/B-08/B-10,
// decision D-03; D-65's read-error half), reconciled under R67 decision D-11
// -- see the merge note below the dictionary for exactly what was kept from
// each side and why.
//
// WHAT THIS EXISTS TO KILL. The Task Master pane used to render whatever
// string the backend happened to put in compliance.pipeline_tasks.error.
// Real rows captured in the R66 walkthrough:
//
//   "Review Leads > View - write CONNECT_TIMEOUT 3.109.171.244:6543"
//   "Record record_work_progress - itemCode is required"
//   "item code 01 not found in this project's BOQ"
//
// A pooler IP, a port, a camelCase parameter name and a function id, shown to
// a site engineer who can do nothing with any of them. D-03 closes the
// vocabulary: the server returns a CODE (plus the missing field), and the
// sentence a person reads is chosen HERE, in words that name the next action.
//
// THIS FILE ALSO CARRIES THE READ-ERROR VOCABULARY (D-65) -- see the second
// half, below the pipeline dictionary. One file, because D-65 is explicit:
// "extend that file, do not start a second dictionary".
//
// FOUR RULES THIS FILE ENFORCES (task-errors.test.ts proves all four, over
// EVERY code, not just the ones that happen to be interesting today):
//   1. A sentence is chosen by code, never copied from the backend's text.
//   2. Every pickable failure carries a VERB LABEL for its button -- "Pick
//      line", "Choose project", "Type value", "Retry" -- so a blocked row
//      always has a way out and never a dead end.
//   3. maskTechnical() is the LAST LINE OF DEFENCE for any string that still
//      reaches a screen: an IP:port, a host:port, an ECONN* or a
//      CONNECT_TIMEOUT is replaced with the words "service unavailable".
//   4. never a camelCase parameter name, never a function id, never a host,
//      an address or a port.

/**
 * D-03's closed vocabulary. THE UNION IS THE UNION OF BOTH BUILDS: every code
 * either side ever emitted a sentence for, plus UNKNOWN for the case neither
 * an explicit code, a missing-field name nor the legacy text resolves.
 *
 * Deliberately DUPLICATED from compliance-tracker's own PIPELINE_ERROR_CODES
 * rather than imported: the two repos deploy separately, so a code the server
 * starts sending before this dictionary knows it must render as the honest
 * fallback (unknownCodeMessage), not crash the shell.
 */
export const TASK_ERROR_CODES = [
  "PROJECT_REQUIRED",
  "BOQ_LINE_REQUIRED",
  "VALUE_REQUIRED",
  "DATE_REQUIRED",
  "WORKER_REQUIRED",
  "TITLE_REQUIRED",
  "TASK_REQUIRED",
  "ACTIVITY_REQUIRED",
  "HOURS_REQUIRED",
  "MATERIAL_REQUIRED",
  "QUANTITY_REQUIRED",
  "CATEGORY_REQUIRED",
  "LINK_REQUIRED",
  "BOQ_VERSION_REQUIRED",
  "BOQ_LINE_NOT_FOUND",
  "BOQ_LINE_IS_PARENT",
  "PROJECT_NOT_REACHABLE",
  "VALUE_OUT_OF_RANGE",
  "RECORD_NOT_FOUND",
  "ALREADY_RECORDED",
  "REQUEST_REJECTED",
  "FUNCTION_NOT_AVAILABLE",
  "NOT_PERMITTED",
  "READ_AS_QUESTION",
  "DEPENDENCY_FAILED",
  "BACKEND_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
  // R67 merge (D-11): WS-C's own fallback code. Nothing outside this file
  // ever names it by string literal (checked: no other src/ file references
  // "UNKNOWN"), so adding it is additive and cannot collide with anything WS-B
  // built. resolveTaskError()'s own fallback needs it to type-check.
  "UNKNOWN",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/**
 * What the row's button does.
 *   "fix"   -- load the chain with the missing step's picker open, AND STOP.
 *              It must never re-execute (M24's load-never-execute rule).
 *   "retry" -- re-submit the identical body. Only for transport failures,
 *              where nothing was written and repeating is safe.
 *   "open"  -- the pipeline cannot run this at all (or the write is already
 *              done, or refused outright), so the only honest move is the
 *              screen that can help. It executes nothing and retries nothing.
 */
export type TaskErrorAction = "fix" | "retry" | "open";

/**
 * The chain step a failure is missing -- the KEY into src/lib/chain-walk.ts's
 * level table ("which question does band 2 open to answer this?"). Kept at
 * WS-C's original five: every one of the newer codes this merge adds either
 * maps onto one of these five real pickers, or -- where the product has no
 * composer picker for the field yet (a BOQ version, a date, a material) --
 * carries `missingStep: null`. That is an honest gap, not a guess: inventing
 * a sixth step name here would be a step chain-walk.ts has never heard of,
 * which is the exact defect this union exists to make impossible.
 */
export type MissingStep = "boqLine" | "project" | "value" | "task" | "worker";

export type TaskErrorEntry = {
  code: TaskErrorCode;
  /** The words a person reads, worst case (no context filled in). Real
   *  interpolated sentences are built by resolveTaskError() -> fillTemplate(). */
  template: string;
  /** The button beside the sentence. A word, never an icon. */
  verbLabel: string;
  action: TaskErrorAction;
  /** Null when the failure is not about a missing value this build can point
   *  a picker at. */
  missingStep: MissingStep | null;
};

/** The business values a sentence interpolates. Never an internal identifier. */
export type TaskErrorParams = Record<string, string | number | null | undefined>;

/**
 * The word-button that follows the sentence, in WS-B's own shape (kept
 * because lib/use-submit.ts, pane-state.ts and CreateRouteError.tsx are
 * already built against messageFor/isTaskErrorCode and are not part of this
 * lane's change).
 *
 *   pick-param -- load the chain and stop at `param`'s picker
 *   route      -- go to `route`, which already does the thing
 *   retry      -- re-send the same submission; nothing was saved
 */
export type NextStepKind = "pick-param" | "route" | "retry";
export type NextStep = { label: string; kind: NextStepKind; param?: string; route?: string };

/**
 * The D-03 field vocabulary WS-B's Fix button reads `param` from -- a
 * superset of MissingStep (this file's own picker union) because not every
 * field WS-B's dictionary can name has a composer picker wired to it yet.
 */
export const FIX_PARAMS = ["project", "boqLine", "boqVersion", "value", "date", "worker", "material", "task"] as const;
export type FixParam = (typeof FIX_PARAMS)[number];

// ---------------------------------------------------------------------------
// THE MERGED DICTIONARY -- ONE TABLE, TWO READING SHAPES
// ---------------------------------------------------------------------------
//
// R67 MERGE NOTE (decision D-11; lane A / WS-B is canonical, lane C / WS-C's
// distinct capability is folded in, verbatim where the two agree):
//
//  - The CODE SET is WS-B's, in full (28 codes), plus UNKNOWN (see above).
//  - For the eight codes BOTH sides gave a sentence to (BOQ_LINE_REQUIRED,
//    BOQ_LINE_NOT_FOUND, PROJECT_REQUIRED, VALUE_REQUIRED, TASK_REQUIRED,
//    WORKER_REQUIRED, FUNCTION_NOT_AVAILABLE, BACKEND_UNAVAILABLE) this merge
//    keeps WS-C's wording and behaviour, not WS-B's: WS-C's fix-pass history
//    (see maskTechnical below) shows these eight were reproduced against real
//    captured rows and debugged twice, and WS-C's FUNCTION_NOT_AVAILABLE is
//    -- see task-row.ts -- the more honest of the two: it offers a button only
//    when a real destination exists, where WS-B always pointed at /dashboard
//    whether or not that was true for the function in question.
//  - Every other code is WS-B's, ported into this shape with its own message
//    and next step.
//  - ONE table (ENTRIES, below) is the source for BOTH reading shapes, so the
//    two APIs (WS-C's TASK_ERROR_DICTIONARY / resolveTaskError, WS-B's
//    DICTIONARY / messageFor / nextStepFor) can never drift apart the way two
//    separately-maintained dictionaries would.

type Entry = {
  message: (p: TaskErrorParams) => string;
  verbLabel: string;
  action: TaskErrorAction;
  missingStep: MissingStep | null;
  nextStepKind: NextStepKind;
  fixParam?: FixParam;
  route?: string;
};

function pick(verbLabel: string, fixParam: FixParam, missingStep: MissingStep | null): Pick<Entry, "verbLabel" | "action" | "missingStep" | "nextStepKind" | "fixParam"> {
  return { verbLabel, action: "fix", missingStep, nextStepKind: "pick-param", fixParam };
}
const RETRY_STEP: Pick<Entry, "verbLabel" | "action" | "missingStep" | "nextStepKind"> = {
  verbLabel: "Retry",
  action: "retry",
  missingStep: null,
  nextStepKind: "retry",
};
function openRoute(verbLabel: string, route: string): Pick<Entry, "verbLabel" | "action" | "missingStep" | "nextStepKind" | "route"> {
  return { verbLabel, action: "open", missingStep: null, nextStepKind: "route", route };
}

function text(p: TaskErrorParams, ...keys: string[]): string {
  for (const key of keys) {
    const v = p[key];
    if (v !== undefined && v !== null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

const ENTRIES: Readonly<Record<TaskErrorCode, Entry>> = {
  // ---- the request is missing something the user can supply --------------
  PROJECT_REQUIRED: { message: () => "Pick a project", ...pick("Choose project", "project", "project") },
  BOQ_LINE_REQUIRED: { message: () => "Pick a BOQ line", ...pick("Pick line", "boqLine", "boqLine") },
  VALUE_REQUIRED: { message: () => "Type quantity or %", ...pick("Type value", "value", "value") },
  DATE_REQUIRED: { message: () => "Pick a date", ...pick("Pick date", "date", null) },
  WORKER_REQUIRED: { message: () => "Pick a worker", ...pick("Pick worker", "worker", "worker") },
  TITLE_REQUIRED: { message: () => "Type a title", ...pick("Type title", "value", "value") },
  TASK_REQUIRED: { message: () => "Pick a task", ...pick("Pick task", "task", "task") },
  ACTIVITY_REQUIRED: { message: () => "Pick an activity", ...pick("Pick activity", "task", "task") },
  HOURS_REQUIRED: { message: () => "Type the hours", ...pick("Type hours", "value", "value") },
  MATERIAL_REQUIRED: { message: () => "Pick a material", ...pick("Pick material", "material", null) },
  QUANTITY_REQUIRED: { message: () => "Type a quantity", ...pick("Type quantity", "value", "value") },
  CATEGORY_REQUIRED: { message: () => "Pick a category", ...pick("Pick category", "value", "value") },
  LINK_REQUIRED: { message: () => "Paste the link", ...pick("Paste link", "value", "value") },
  BOQ_VERSION_REQUIRED: { message: () => "Pick a BOQ version", ...pick("Pick version", "boqVersion", null) },

  // ---- the request named something that is not there / not usable --------
  BOQ_LINE_NOT_FOUND: {
    // WS-C's own algorithm (kept verbatim, em-dash and all -- see the merge
    // note above): the fix-pass history on this exact code (dangling "on",
    // then a bare version number standing where the project's name belongs)
    // was reproduced and re-tested twice, which is why this merge keeps its
    // wording over WS-B's plainer `onClause` for the no-project/no-version
    // cases -- WS-B's own equivalent tests are restated to match, below.
    message: (p) => {
      const code = text(p, "itemCode", "code");
      const where = [text(p, "project", "projectName"), text(p, "version", "boqVersion")].filter(Boolean).join(" ");
      if (code && where) return `There is no line ${code} on ${where} — pick a line`;
      if (code) return `There is no line ${code} on this BOQ — pick a line`;
      if (where) return `That line is not on ${where} — pick a line`;
      return "That line is not on this BOQ — pick a line";
    },
    ...pick("Pick line", "boqLine", "boqLine"),
  },
  // Both real quotes ship: the first whenever the server knew WHICH line was
  // the parent, the second when it did not.
  BOQ_LINE_IS_PARENT: {
    message: (p) => {
      const code = text(p, "itemCode", "code");
      return code ? `${code} is a parent line — pick one of its child lines` : "Progress goes on a child line, not the parent";
    },
    ...pick("Pick line", "boqLine", "boqLine"),
  },
  PROJECT_NOT_REACHABLE: {
    message: () => "You do not have access to that project — pick another",
    ...pick("Choose project", "project", "project"),
  },
  VALUE_OUT_OF_RANGE: { message: () => "Type a number between 0 and 100", ...pick("Type value", "value", "value") },

  // ---- what a SERVICE refused, in its own 4xx vocabulary ------------------
  // None of these three is a Retry: sending the same request again cannot
  // change a 4xx.
  RECORD_NOT_FOUND: { message: () => "That record is not on this project — pick another", ...openRoute("Open Home", "/dashboard") },
  ALREADY_RECORDED: {
    // The one code, several real conditions -- `functionId` travels in the
    // failure context purely so this branch can pick the true sentence; it is
    // never printed (task-errors.test.ts's three-rules test runs over every
    // code with a sample functionId and asserts none of them leak it).
    message: (p) => {
      const fn = text(p, "functionId");
      if (fn === "record_attendance") return "Attendance is already recorded for that worker on that date";
      if (fn === "create_boq_revision") return "That BOQ has already been revised — open the latest revision";
      return "That is already recorded — nothing new was saved";
    },
    ...openRoute("Open Home", "/dashboard"),
  },
  REQUEST_REJECTED: {
    message: () => "That was not accepted as entered — check the values and try again",
    ...openRoute("Open Home", "/dashboard"),
  },

  // ---- what this workspace or this role may not do ------------------------
  FUNCTION_NOT_AVAILABLE: {
    // WS-C's own wording and its own "open" semantics: task-row.ts only
    // renders a button for an "open" action when a real destination exists
    // (OBJECT_ROUTES has an entry for the function), so a function with
    // nowhere to send the user gets the sentence and no dead-end control.
    message: () => "PROJEXA can't do that from the composer yet",
    verbLabel: "Open the screen",
    action: "open",
    missingStep: null,
    nextStepKind: "route",
    route: undefined,
  },
  NOT_PERMITTED: { message: () => "Your role does not allow that", ...openRoute("Open Home", "/dashboard") },
  READ_AS_QUESTION: { message: () => "That reads as a question, so nothing was saved", ...openRoute("Open Home", "/dashboard") },
  DEPENDENCY_FAILED: { message: () => "The step before this one did not finish, so nothing was saved", ...RETRY_STEP },

  // ---- our side, never the user's fault -----------------------------------
  BACKEND_UNAVAILABLE: { message: () => "The construction data service didn't answer — nothing was saved", ...RETRY_STEP },
  UPSTREAM_TIMEOUT: { message: () => "The construction data service took too long — nothing was saved", ...RETRY_STEP },
  INTERNAL_ERROR: { message: () => "Something went wrong on our side — nothing was saved", ...RETRY_STEP },

  // ---- WS-C's own fallback, kept for resolveTaskError() ------------------
  UNKNOWN: { message: () => "Something went wrong", ...RETRY_STEP },
};

export const TASK_ERROR_DICTIONARY: Readonly<Record<TaskErrorCode, TaskErrorEntry>> = Object.fromEntries(
  (TASK_ERROR_CODES as readonly TaskErrorCode[]).map((code) => {
    const e = ENTRIES[code];
    return [
      code,
      { code, template: e.message({}), verbLabel: e.verbLabel, action: e.action, missingStep: e.missingStep },
    ];
  })
) as Readonly<Record<TaskErrorCode, TaskErrorEntry>>;

const FIX_CHAIN_BY_PARAM: Readonly<Record<FixParam, Omit<FixChain, "missing">>> = {
  project: { module: "dashboard", verb: "open", route: "/dashboard" },
  boqLine: { module: "work-progress", verb: "record", route: "/work-progress" },
  boqVersion: { module: "scope", verb: "revise", route: "/scope" },
  value: { module: "work-progress", verb: "record", route: "/work-progress" },
  date: { module: "work-progress", verb: "record", route: "/work-progress" },
  worker: { module: "manpower", verb: "mark", route: "/labour" },
  material: { module: "materials", verb: "record", route: "/materials" },
  task: { module: "schedule", verb: "log", route: "/schedule" },
};

const CODE_SET: ReadonlySet<string> = new Set(TASK_ERROR_CODES);

export function isTaskErrorCode(code: string | null | undefined): code is TaskErrorCode {
  return typeof code === "string" && CODE_SET.has(code);
}

/**
 * The fallback for a code this build has never heard of -- a newer server, a
 * partial deploy. HONEST rather than reassuring: it says something went
 * wrong, and it carries the code so support can act on a screenshot.
 */
export function unknownCodeMessage(code: string): string {
  return `Something went wrong (code ${code})`;
}

/** WS-B's entry point: `messageFor('BOQ_LINE_NOT_FOUND', {itemCode, project, version})`. */
export function messageFor(code: string | null | undefined, params: TaskErrorParams = {}): string {
  if (!isTaskErrorCode(code)) return unknownCodeMessage(String(code ?? "unknown"));
  return ENTRIES[code].message(params);
}

/** The same dictionary, addressed as one object. */
export function taskErrorFor(failure: { code: string | null | undefined; params?: TaskErrorParams }): string {
  return messageFor(failure.code, failure.params ?? {});
}

export function nextStepFor(code: string | null | undefined): NextStep {
  if (!isTaskErrorCode(code)) return { label: "Retry", kind: "retry" };
  const e = ENTRIES[code];
  if (e.nextStepKind === "pick-param") return { label: e.verbLabel, kind: "pick-param", param: e.fixParam };
  if (e.nextStepKind === "route") return { label: e.verbLabel, kind: "route", route: e.route ?? "/dashboard" };
  return { label: "Retry", kind: "retry" };
}

/** Every code with its sentence, for the test that proves the three rules. */
export function allMessages(sample: TaskErrorParams = {}): { code: TaskErrorCode; message: string }[] {
  return (TASK_ERROR_CODES as readonly TaskErrorCode[]).map((code) => ({ code, message: ENTRIES[code].message(sample) }));
}

/**
 * The chain to load for a code, or null when there is nothing to pick -- a
 * transport failure is a Retry, and a capability that is not wired is a
 * destination, neither of which is a chain.
 */
export function fixChainFor(code: string | null | undefined): FixChain | null {
  const step = nextStepFor(code);
  if (step.kind !== "pick-param" || !step.param) return null;
  const chain = FIX_CHAIN_BY_PARAM[step.param as FixParam];
  if (!chain) return null;
  return { ...chain, missing: step.param as FixParam };
}

/**
 * Line 2 of a Task Master row: the sentence, plus the word-button that acts
 * on it. Every retry-kind code gets its own "[Retry]" appended HERE, rather
 * than baked into the message string, so the bracket cannot drift out of sync
 * with a wording change the way a copy-pasted suffix can.
 */
export function rowDetailFor(code: string | null | undefined, params: TaskErrorParams = {}): string {
  const sentence = messageFor(code, params);
  const step = nextStepFor(code);
  if (step.kind === "pick-param") return `${sentence} [Fix]`;
  if (step.kind === "route") return `${sentence} [${step.label}]`;
  return `${sentence} [Retry]`;
}

export type FixChain = {
  /** the module segment, as the composer's chain spells it */
  module: string;
  /** the verb segment */
  verb: string;
  /** the D-03 field the chain stops at */
  missing: FixParam;
  /** the screen that answers the same question with a form */
  route: string;
};

// ---------------------------------------------------------------------------
// THE LAST LINE OF DEFENCE
// ---------------------------------------------------------------------------

/**
 * An IPv4 address WITH A PORT: "3.109.171.244:6543" (the real captured row).
 *
 * *** FIX PASS -- THE PORT IS MANDATORY, AND THAT IS THE WHOLE FIX. ***
 *
 * It used to be optional -- `(?::\d{1,5})?` -- which made this pattern match a
 * four-segment dotted BOQ ITEM CODE. A bare dotted quad is far more likely to
 * be a BOQ code than a leaked host, and masking a real item code is the worse
 * failure: it destroys the one fact the user needs.
 */
const IP_PORT = /\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b/g;
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
 * *** FIX PASS -- THE STUTTER COLLAPSE WAS EATING THE FOLLOWING SEPARATOR. ***
 * It was /(?:service unavailable[\s,]*)+/g, and that trailing `[\s,]*`
 * consumed the space AFTER the last replacement too. The collapse now matches
 * only the repeats themselves, so exactly one separator survives where one was.
 */
export function maskTechnical(text: string): string {
  if (!text) return text;
  return text
    .replace(IP_PORT, SERVICE_UNAVAILABLE)
    .replace(TRANSPORT_CODE, SERVICE_UNAVAILABLE)
    .replace(HOST_PORT, SERVICE_UNAVAILABLE)
    .replace(/(?:service unavailable)(?:[ ,]+service unavailable)+/g, SERVICE_UNAVAILABLE)
    .replace(/ {2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// READING A CODE OUT OF A LEGACY ROW
// ---------------------------------------------------------------------------

// Until every row carries a code -- and for the rows already in
// compliance.pipeline_tasks, which never will -- these patterns recover the
// code from the backend's own historic wording. ORDER MATTERS: the transport
// patterns are checked FIRST, because a driver message is the one legacy
// string that must never be shown under any circumstances, and some of them
// also contain the word "required".
const LEGACY_PATTERNS: ReadonlyArray<{ match: RegExp; code: TaskErrorCode }> = [
  { match: /CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE/i, code: "BACKEND_UNAVAILABLE" },
  { match: /canceling statement due to|statement timeout/i, code: "UPSTREAM_TIMEOUT" },
  // *** FIX PASS -- AN HTTP STATUS NEEDS AN HTTP CONTEXT. ***
  // A BARE three-digit number matched anywhere used to claim ordinary BOQ item
  // codes numbered 501-504 as an outage. The number now has to be wearing its
  // status.
  {
    match: /\b(?:HTTP|status)\s*(?:502|503|504)\b|\b(?:502|503|504)\s+(?:bad gateway|service unavailable|gateway time-?out)\b/i,
    code: "BACKEND_UNAVAILABLE",
  },
  { match: /parent (BOQ )?line|progress cannot be recorded directly against a parent/i, code: "BOQ_LINE_IS_PARENT" },
  // *** FIX PASS -- "no construction activity exists ... create one first" no
  // longer claims ACTIVITY_REQUIRED: the picker it offered leads nowhere,
  // because the activity has to be CREATED first, not picked. That string now
  // falls through to the honest fallback instead.
  { match: /\bnot found in this project'?s boq\b/i, code: "BOQ_LINE_NOT_FOUND" },
  { match: /\bdoes not exist in this boq\b/i, code: "BOQ_LINE_NOT_FOUND" },
  { match: /\bno boq found for project\b/i, code: "BOQ_LINE_NOT_FOUND" },
  { match: /\bitem\s*code is required\b/i, code: "BOQ_LINE_REQUIRED" },
  { match: /\bboq[_ ]?line[_ ]?item[_ ]?id\b.*\brequired\b/i, code: "BOQ_LINE_REQUIRED" },
  { match: /\bno project resolved\b/i, code: "PROJECT_REQUIRED" },
  { match: /\bproject .* is not reachable\b/i, code: "PROJECT_REQUIRED" },
  // The date pattern is checked BEFORE the percent/quantity one below, so
  // "percentComplete recorded, but entryDate is required" reads as a missing
  // date, which is the field actually missing.
  // No leading \b: the real string is "entryDate is required", where "Date"
  // has no word boundary before it.
  { match: /date is required\b/i, code: "DATE_REQUIRED" },
  { match: /\b(?:percent|quantity|hours)(?:complete|done)? is required\b/i, code: "VALUE_REQUIRED" },
  { match: /\bmust be a number between 0 and 100\b/i, code: "VALUE_REQUIRED" },
  { match: /\bactivity ?id is required\b|\bactivity is required\b/i, code: "ACTIVITY_REQUIRED" },
  { match: /\bno task on this project matches\b/i, code: "TASK_REQUIRED" },
  { match: /\bmatches \d+ tasks on this project\b/i, code: "TASK_REQUIRED" },
  { match: /\bno executor is registered\b/i, code: "FUNCTION_NOT_AVAILABLE" },
  { match: /\bnot in this module's candidate set\b/i, code: "FUNCTION_NOT_AVAILABLE" },
  { match: /\bis not permitted to execute\b/i, code: "FUNCTION_NOT_AVAILABLE" },
  { match: /\bpermission|not permitted|forbidden\b/i, code: "NOT_PERMITTED" },
  { match: /\b(?:timed? ?out|unavailable|internal error)\b/i, code: "BACKEND_UNAVAILABLE" },
];

/** The D-03 code a legacy `pipeline_tasks.error` string stands for, or null. */
export function inferTaskErrorCode(raw: string | null | undefined): TaskErrorCode | null {
  if (!raw || !raw.trim()) return null;
  for (const { match, code } of LEGACY_PATTERNS) {
    if (match.test(raw)) return code;
  }
  return null;
}

/** WS-B's own name for the same function, over the same closed vocabulary. */
export function legacyToCode(stored: string | null | undefined): TaskErrorCode | null {
  return inferTaskErrorCode(stored);
}

/** Everything else. HONEST, and it still offers a way forward. */
export const LEGACY_FALLBACK_MESSAGE = "This task needs your input - [Fix]";

/**
 * R67 C-10: the server has its own names for the same infrastructure
 * failure. Most are ALIASES of BACKEND_UNAVAILABLE; asTaskErrorCode() checks
 * the real code set FIRST, so a server code that is now first-class here
 * (UPSTREAM_TIMEOUT) resolves to itself rather than being collapsed.
 */
const SERVER_CODE_ALIASES: Readonly<Record<string, TaskErrorCode>> = {
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
 * R67 C-10: is this a failure the USER can do nothing about? It decides which
 * rows leave the needs-you list -- a site engineer cannot fix a pool timeout,
 * and a list that mixes those with "Pick a BOQ line" is a list whose badge
 * count means nothing. Widened (merge decision) to every RETRY-kind code: all
 * four ("our side, never the user's fault" per WS-B's own dictionary comment)
 * share the same property C-10 was written for.
 */
export function isSystemFailureCode(code: TaskErrorCode | null | undefined): boolean {
  return code === "BACKEND_UNAVAILABLE" || code === "UPSTREAM_TIMEOUT" || code === "INTERNAL_ERROR" || code === "DEPENDENCY_FAILED";
}

// ---------------------------------------------------------------------------
// THE ONE ENTRY POINT (WS-C's shape -- resolveTaskError)
// ---------------------------------------------------------------------------

export type TaskErrorInput = {
  /** WS-B's `{ code, missing }` payload. Preferred over everything else. */
  code?: unknown;
  /** The field the server says is missing, when it names one. */
  missing?: readonly string[] | null;
  /** The legacy `pipeline_tasks.error` string. Used ONLY to infer a code. */
  raw?: string | null;
  /** Facts for the BOQ_LINE_NOT_FOUND / BOQ_LINE_IS_PARENT sentences. */
  itemCode?: string | null;
  projectName?: string | null;
  boqVersion?: string | null;
  /** R67 merge: threads through to ALREADY_RECORDED's per-write sentence.
   *  Optional and additive -- no existing caller passes it, and omitting it
   *  still renders the honest generic sentence. */
  functionId?: string | null;
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
  date: "DATE_REQUIRED",
  activityid: "ACTIVITY_REQUIRED",
  activity: "ACTIVITY_REQUIRED",
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
  const sentence = maskTechnical(
    ENTRIES[code].message({
      itemCode: input.itemCode,
      project: input.projectName,
      projectName: input.projectName,
      version: input.boqVersion,
      boqVersion: input.boqVersion,
      functionId: input.functionId,
    })
  );

  return { ...entry, sentence, inferred: !explicit };
}

// ---------------------------------------------------------------------------
// R67 D-65: THE READ-ERROR HALF OF THE SAME DICTIONARY
// ---------------------------------------------------------------------------
//
// Everything above is a PIPELINE failure: a task the backend refused, with a
// code and a Fix chain. What follows is the other way a screen fails -- a GET
// that did not come back. The two halves share the sanitiser below and
// nothing else: a read failure has no Fix chain (there is no field to fill
// in) and a task failure has no Retry-worthiness question (the row is
// already blocked).

const UNSAFE_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // an IP address
  /\bhttps?:\/\//i, // a URL
  /[A-Za-z0-9.-]+:\d{2,5}\b/, // host:port
  /\b[a-z]+[A-Z][A-Za-z]*\b/, // a camelCase parameter name (itemCode, projectId)
  /"[a-z0-9]+(?:_[a-z0-9]+)+"/, // a quoted snake_case function id
  /\bfunction_id\b/i,
];

const GENERIC_FAILURE = "That didn't run. Nothing was saved.";

/**
 * The backend's own words, but only when they are safe to show. D-03's rule
 * is absolute: no camelCase parameter name, no function id, no host:port.
 * Everything else the server writes is human prose authored in this project
 * and is passed through unchanged.
 */
export function sanitiseBackendMessage(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return GENERIC_FAILURE;
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(t)) ? GENERIC_FAILURE : t;
}

export const READ_ERROR_CODES = [
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_ERROR",
  "STORAGE_UNAVAILABLE",
  "NOT_AUTHORISED",
  "NOT_FOUND",
] as const;

export type ReadErrorCode = (typeof READ_ERROR_CODES)[number];

const STORAGE_MESSAGE = /supabasekey is required|supabase_?key/i;
const TIMEOUT_MESSAGE = /did not respond in time|timed out|timeout|ETIMEDOUT|ECONNRESET/i;

/**
 * What kind of read failure this was, from what the transport actually told
 * us. Never a guess: with neither a recognised status nor a recognised
 * message, the answer is the generic UPSTREAM_ERROR.
 */
export function classifyReadError(input: { status?: number | null; message?: string | null }): ReadErrorCode {
  const message = (input.message ?? "").trim();
  if (STORAGE_MESSAGE.test(message)) return "STORAGE_UNAVAILABLE";
  if (input.status === 401 || input.status === 403) return "NOT_AUTHORISED";
  if (input.status === 404) return "NOT_FOUND";
  if (input.status === 504 || input.status === 408 || TIMEOUT_MESSAGE.test(message)) return "UPSTREAM_TIMEOUT";
  return "UPSTREAM_ERROR";
}

const READ_ERROR_REASON: Record<ReadErrorCode, string> = {
  UPSTREAM_TIMEOUT: "the construction data service didn't answer",
  UPSTREAM_ERROR: "the construction data service returned an error",
  STORAGE_UNAVAILABLE: "file storage is not configured for this environment",
  NOT_AUTHORISED: "you don't have access to it",
  NOT_FOUND: "it isn't there any more",
};

export type ReadErrorDescription = {
  /** "Couldn't load permits — the construction data service didn't answer (UPSTREAM_TIMEOUT)." */
  sentence: string;
  /** The backend's own words, kept when they are safe to show. */
  detail: string | null;
  /** Whether Retry is worth offering: a 401 or a 404 will not fix itself. */
  retryable: boolean;
  /** The persistent footer band's line. */
  footer: string;
  code: ReadErrorCode;
};

/** The one sentence a failed pane shows. */
export function describeReadError(
  entity: string,
  input: { status?: number | null; message?: string | null }
): ReadErrorDescription {
  const code = classifyReadError(input);
  const detail = input.message?.trim() ? sanitiseBackendMessage(input.message) : null;
  return {
    sentence: `Couldn't load ${entity} — ${READ_ERROR_REASON[code]} (${code}).`,
    detail: detail && detail !== GENERIC_FAILURE ? detail : null,
    retryable: code !== "NOT_AUTHORISED" && code !== "NOT_FOUND",
    footer: "1 error on this screen",
    code,
  };
}
