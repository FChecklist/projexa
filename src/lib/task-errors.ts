// R67 lane B (B-06 / B-08 / B-10, programme decision D-03) -- THE ONE PLACE
// A PIPELINE FAILURE BECOMES A SENTENCE.
//
// Before this file, compliance-tracker composed the English and PROJEXA
// rendered it verbatim. The R66 walkthrough shows exactly what that produced
// on a real screen: "itemCode is required", "no project resolved for this
// task", and -- the worst of them -- a Postgres driver string carrying an
// internal address, "write CONNECT_TIMEOUT 3.109.171.244:6543", printed on a
// site engineer's Task Master row.
//
// D-03 splits it: THE SERVER RETURNS A CODE, THE CLIENT OWNS THE WORDING.
// compliance-tracker's src/lib/pipeline/error-codes.ts holds the closed
// vocabulary and returns {code, missing, context, picker}; this file is the
// only place in the product where a human sentence for one of those codes
// exists. Nothing here fetches, imports a component, or reaches the network:
// it is pure data plus two pure functions, so every sentence is exhaustively
// testable and none of them can drift into a component's JSX.
//
// THE THREE RULES A SENTENCE HERE MUST OBEY (all three are enforced by
// task-errors.test.ts, not merely asked for):
//   1. never a camelCase parameter name  ("itemCode")
//   2. never a function id                ("record_work_progress")
//   3. never a host, an address or a port ("3.109.171.244:6543")

/**
 * The closed set, mirroring compliance-tracker's PIPELINE_ERROR_CODES. It is
 * deliberately DUPLICATED rather than imported: the two repos deploy
 * separately, so a code the server starts sending before this dictionary
 * knows it must render as the honest fallback below, not crash the shell.
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
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/** The business values a sentence interpolates. Never an internal identifier. */
export type TaskErrorParams = Record<string, string | number | null | undefined>;

/**
 * The word-button that follows the sentence. Task Master's row and the
 * composer card both render this, which is why it lives beside the sentence
 * rather than being re-decided at each call site.
 *
 *   pick-param -- load the chain and stop at `param`'s picker
 *   route      -- go to `route`, which already does the thing
 *   retry      -- re-send the same submission; nothing was saved
 */
export type NextStepKind = "pick-param" | "route" | "retry";
export type NextStep = { label: string; kind: NextStepKind; param?: string; route?: string };

/**
 * The D-03 field vocabulary. `param` above is always one of these, never a
 * camelCase parameter name -- that is what stops "itemCode" reaching a screen
 * through the back door of a Fix button's label.
 */
export const FIX_PARAMS = ["project", "boqLine", "boqVersion", "value", "date", "worker", "material", "task"] as const;
export type FixParam = (typeof FIX_PARAMS)[number];

type Entry = {
  /** Given the failure's context, the sentence. Pure. */
  message: (p: TaskErrorParams) => string;
  nextStep: NextStep;
};

function pick(label: string, param: FixParam): NextStep {
  return { label, kind: "pick-param", param };
}

const RETRY: NextStep = { label: "Retry", kind: "retry" };
const OPEN_HOME: NextStep = { label: "Open Home", kind: "route", route: "/dashboard" };

/** Squeezes the gaps an absent {project}/{version} leaves behind. */
function tidy(sentence: string): string {
  return sentence.replace(/\s{2,}/g, " ").trim();
}

/**
 * R67 FIX PASS -- "on Cedar Heights Villa - Phase 1 v2", or NOTHING AT ALL.
 *
 * D-03's template is "There is no line {code} on {project} {version} - pick a
 * line", and interpolating an absent {project} used to leave the word "on"
 * dangling: the executor's own copy of this failure carried {itemCode,
 * version} and no project, so the row read "There is no line EX-01 on
 * - pick a line", and once a BOQ existed it read "... on 1 - pick a line",
 * with the bare version number standing exactly where the project's name
 * belongs. tidy() could not see that, because collapsing double spaces is not
 * the same as removing a clause.
 *
 * So the clause is BUILT, not interpolated: present only when there is
 * something real to put in it, in the project-then-version order the sentence
 * reads in. (The server half now supplies both, but a sentence must be true
 * for the context it is actually given, not only for the best case.)
 */
function onClause(p: TaskErrorParams): string {
  const parts = [text(p, "project"), text(p, "version")].filter((s) => s.length > 0);
  return parts.length > 0 ? ` on ${parts.join(" ")}` : "";
}

function text(p: TaskErrorParams, ...keys: string[]): string {
  for (const key of keys) {
    const v = p[key];
    if (v !== undefined && v !== null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

const DICTIONARY: Readonly<Record<TaskErrorCode, Entry>> = {
  // ---- the request is missing something the user can supply --------------
  PROJECT_REQUIRED: { message: () => "Pick a project", nextStep: pick("Pick a project", "project") },
  BOQ_LINE_REQUIRED: { message: () => "Pick a BOQ line", nextStep: pick("Pick a BOQ line", "boqLine") },
  VALUE_REQUIRED: { message: () => "Type quantity or %", nextStep: pick("Type quantity or %", "value") },
  DATE_REQUIRED: { message: () => "Pick a date", nextStep: pick("Pick a date", "date") },
  WORKER_REQUIRED: { message: () => "Pick a worker", nextStep: pick("Pick a worker", "worker") },
  TITLE_REQUIRED: { message: () => "Type a title", nextStep: pick("Type a title", "value") },
  TASK_REQUIRED: { message: () => "Pick a task", nextStep: pick("Pick a task", "task") },
  ACTIVITY_REQUIRED: { message: () => "Pick an activity", nextStep: pick("Pick an activity", "task") },
  HOURS_REQUIRED: { message: () => "Type the hours", nextStep: pick("Type the hours", "value") },
  MATERIAL_REQUIRED: { message: () => "Pick a material", nextStep: pick("Pick a material", "material") },
  QUANTITY_REQUIRED: { message: () => "Type a quantity", nextStep: pick("Type a quantity", "value") },
  CATEGORY_REQUIRED: { message: () => "Pick a category", nextStep: pick("Pick a category", "value") },
  LINK_REQUIRED: { message: () => "Paste the link", nextStep: pick("Paste the link", "value") },
  BOQ_VERSION_REQUIRED: { message: () => "Pick a BOQ version", nextStep: pick("Pick a BOQ version", "boqVersion") },

  // ---- the request named something that is not there / not usable --------
  // D-03's exact template. {project} and {version} are dropped cleanly when
  // the server could not resolve them -- a project with no BOQ at all and a
  // project whose BOQ lacks the line are the same fact to the person typing.
  BOQ_LINE_NOT_FOUND: {
    message: (p) => tidy(`There is no line ${text(p, "code", "itemCode")}${onClause(p)} - pick a line`),
    nextStep: pick("Pick a BOQ line", "boqLine"),
  },
  // B-06 quotes this as "EX-00 is a parent line - pick one of its child
  // lines"; B-08 quotes it as "Progress goes on a child line, not the
  // parent". Both are true and both ship: the first whenever the server knew
  // WHICH line was the parent, the second when it did not.
  BOQ_LINE_IS_PARENT: {
    message: (p) => {
      const code = text(p, "code", "itemCode");
      return code ? `${code} is a parent line - pick one of its child lines` : "Progress goes on a child line, not the parent";
    },
    nextStep: pick("Pick a BOQ line", "boqLine"),
  },
  PROJECT_NOT_REACHABLE: {
    message: () => "You do not have access to that project - pick another",
    nextStep: pick("Pick a project", "project"),
  },
  VALUE_OUT_OF_RANGE: {
    message: () => "Type a number between 0 and 100",
    nextStep: pick("Type quantity or %", "value"),
  },

  // ---- R67 FIX PASS: what a SERVICE refused, in its own 4xx vocabulary ---
  //
  // These three exist because compliance-tracker's executor used to send every
  // service-level 4xx through its TRANSPORT normaliser, so a duplicate the
  // user can never fix by retrying arrived here as INTERNAL_ERROR and this
  // dictionary honestly rendered "Something went wrong on our side - nothing
  // was saved [Retry]". The service's own answer was both truer and safer.
  // None of them is a Retry: sending the same request again cannot change a
  // 4xx.
  RECORD_NOT_FOUND: {
    message: () => "That record is not on this project - pick another",
    nextStep: OPEN_HOME,
  },
  ALREADY_RECORDED: {
    // The one code, two real conditions. `functionId` travels in the failure
    // CONTEXT purely so this branch can pick the true sentence -- it is never
    // printed, which the three-rules test asserts over every entry here.
    message: (p) => {
      const fn = text(p, "functionId");
      if (fn === "record_attendance") return "Attendance is already recorded for that worker on that date";
      if (fn === "create_boq_revision") return "That BOQ has already been revised - open the latest revision";
      return "That is already recorded - nothing new was saved";
    },
    nextStep: OPEN_HOME,
  },
  REQUEST_REJECTED: {
    message: () => "That was not accepted as entered - check the values and try again",
    nextStep: OPEN_HOME,
  },

  // ---- what this workspace or this role may not do -----------------------
  FUNCTION_NOT_AVAILABLE: { message: () => "That is not enabled for this workspace yet", nextStep: OPEN_HOME },
  NOT_PERMITTED: { message: () => "Your role does not allow that", nextStep: OPEN_HOME },
  READ_AS_QUESTION: { message: () => "That reads as a question, so nothing was saved", nextStep: OPEN_HOME },
  DEPENDENCY_FAILED: { message: () => "The step before this one did not finish, so nothing was saved", nextStep: RETRY },

  // ---- our side, never the user's fault ---------------------------------
  // D-03's exact sentence, including the word-button it names.
  BACKEND_UNAVAILABLE: {
    message: () => "The construction data service didn't answer - nothing was saved [Retry]",
    nextStep: RETRY,
  },
  UPSTREAM_TIMEOUT: {
    message: () => "The construction data service took too long - nothing was saved [Retry]",
    nextStep: RETRY,
  },
  INTERNAL_ERROR: { message: () => "Something went wrong on our side - nothing was saved [Retry]", nextStep: RETRY },
};

const CODE_SET: ReadonlySet<string> = new Set(TASK_ERROR_CODES);

export function isTaskErrorCode(code: string | null | undefined): code is TaskErrorCode {
  return typeof code === "string" && CODE_SET.has(code);
}

/**
 * The fallback for a code this build has never heard of -- a newer server, a
 * partial deploy. HONEST rather than reassuring: it says something went
 * wrong, and it carries the code so support can act on a screenshot. It is
 * still not a driver message and still not a parameter name.
 */
export function unknownCodeMessage(code: string): string {
  return `Something went wrong (code ${code})`;
}

/**
 * THE ONE ENTRY POINT. B-08's signature.
 *
 *   messageFor('BOQ_LINE_NOT_FOUND', {code:'1', project:'Cedar Heights Villa - Phase 1', version:'v1'})
 *     -> 'There is no line 1 on Cedar Heights Villa - Phase 1 v1 - pick a line'
 */
export function messageFor(code: string | null | undefined, params: TaskErrorParams = {}): string {
  if (!isTaskErrorCode(code)) return unknownCodeMessage(String(code ?? "unknown"));
  return DICTIONARY[code].message(params);
}

/** B-06's signature. The same dictionary, addressed as one object. */
export function taskErrorFor(failure: { code: string | null | undefined; params?: TaskErrorParams }): string {
  return messageFor(failure.code, failure.params ?? {});
}

export function nextStepFor(code: string | null | undefined): NextStep {
  if (!isTaskErrorCode(code)) return RETRY;
  return DICTIONARY[code].nextStep;
}

// ─── R67 B-10: THE FIX CHAIN ──────────────────────────────────────────────
//
// A sentence that names what is wrong and offers no way to put it right is
// half an answer. Every code whose nextStep is `pick-param` therefore also
// carries the CHAIN to load in the composer -- the module and verb the user
// was already doing, stopped at the level that is missing -- so one click
// puts them in front of the choices instead of back at an empty box.
//
// The route is the screen that can also answer it, for the case where the
// user would rather use the form than the composer. M24's rule, applied:
// THE SAME NAME MUST REACH THE SAME DESTINATION whichever path you took.

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

/**
 * The chain to load for a code, or null when there is nothing to pick --
 * a transport failure is a Retry, and a capability that is not wired is a
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
 * on it. BACKEND_UNAVAILABLE already ends in "[Retry]" because D-03 words it
 * that way; everything a user can actually pick gets "[Fix]", so the row
 * shows an affordance rather than only a complaint.
 */
export function rowDetailFor(code: string | null | undefined, params: TaskErrorParams = {}): string {
  const sentence = messageFor(code, params);
  const step = nextStepFor(code);
  if (step.kind === "pick-param") return `${sentence} [Fix]`;
  if (step.kind === "route") return `${sentence} [${step.label}]`;
  // `retry` sentences already carry their own [Retry] from the dictionary.
  return sentence;
}

// ─── R67 B-10: THE LEGACY ROWS ────────────────────────────────────────────
//
// compliance.pipeline_tasks holds rows written long before the pipeline
// returned codes, and their `error` column holds the exact English the R66
// walkthrough photographed. Those rows are still in Task Master, so mapping
// them here is the difference between the dictionary covering the product
// and covering only what is written from today onwards.
//
// The alternative -- a one-off UPDATE over the production table -- is an
// owner-gated data change, and it would still leave any row written by a
// not-yet-deployed server unmapped. This does the job at render time, for
// every row, with nothing to run against a live database.
//
// ORDER MATTERS: the transport patterns are checked FIRST, because a driver
// message is the one legacy string that must never be shown under any
// circumstances, and some of them also contain the word "required".
const LEGACY_PATTERNS: ReadonlyArray<{ match: RegExp; code: TaskErrorCode }> = [
  { match: /CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE/i, code: "BACKEND_UNAVAILABLE" },
  { match: /canceling statement due to|statement timeout/i, code: "UPSTREAM_TIMEOUT" },
  { match: /parent (BOQ )?line/i, code: "BOQ_LINE_IS_PARENT" },
  { match: /not found in this project|no BOQ found|BOQ line item not found/i, code: "BOQ_LINE_NOT_FOUND" },
  { match: /item ?code is required|boq ?line ?item ?id is required|pick a BOQ line/i, code: "BOQ_LINE_REQUIRED" },
  { match: /no project resolved|project ?id is required|Project not found/i, code: "PROJECT_REQUIRED" },
  // R67 FIX PASS -- both of these were too broad, and both had a real stored
  // string that they claimed wrongly.
  //
  // `/percent|quantity/i` claimed ANY legacy string containing either word,
  // whatever had actually failed, and it sat ahead of the date pattern -- so
  // "percentComplete recorded, but entryDate is required" came out as "Type
  // quantity or %". Narrowed to the required-shape only.
  { match: /percent(\s*complete)? is required|quantity(\s*done)? is required/i, code: "VALUE_REQUIRED" },
  { match: /date is required/i, code: "DATE_REQUIRED" },
  // `/activity/i` claimed the pipeline's own "no construction activity exists
  // yet for project "X" -- create one before recording progress", which
  // rendered "Pick an activity" and a Fix chain into /schedule -- where there
  // is nothing to pick, because the activity has to be CREATED first. An
  // affordance that leads nowhere is worse than none, so that string now
  // falls through to LEGACY_FALLBACK_MESSAGE and its generic [Fix].
  { match: /activity ?id is required|activity is required/i, code: "ACTIVITY_REQUIRED" },
  { match: /not available for this account|not registered|no executor/i, code: "FUNCTION_NOT_AVAILABLE" },
  { match: /permission|not permitted|forbidden/i, code: "NOT_PERMITTED" },
];

/** Everything else. HONEST, and it still offers a way forward. */
export const LEGACY_FALLBACK_MESSAGE = "This task needs your input - [Fix]";

/**
 * Maps a stored English failure back into the closed vocabulary, so an old
 * row renders through the same dictionary as a new one. Returns null when
 * nothing matches -- the caller shows LEGACY_FALLBACK_MESSAGE rather than
 * the original text.
 */
export function legacyToCode(stored: string | null | undefined): TaskErrorCode | null {
  if (!stored || stored.trim().length === 0) return null;
  for (const { match, code } of LEGACY_PATTERNS) {
    if (match.test(stored)) return code;
  }
  return null;
}

/** Every code with its sentence, for the test that proves the three rules. */
export function allMessages(sample: TaskErrorParams = {}): { code: TaskErrorCode; message: string }[] {
  return TASK_ERROR_CODES.map((code) => ({ code, message: DICTIONARY[code].message(sample) }));
}
