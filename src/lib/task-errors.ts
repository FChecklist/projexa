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
    message: (p) =>
      tidy(`There is no line ${text(p, "code", "itemCode")} on ${text(p, "project")} ${text(p, "version")} - pick a line`),
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

/** Every code with its sentence, for the test that proves the three rules. */
export function allMessages(sample: TaskErrorParams = {}): { code: TaskErrorCode; message: string }[] {
  return TASK_ERROR_CODES.map((code) => ({ code, message: DICTIONARY[code].message(sample) }));
}
