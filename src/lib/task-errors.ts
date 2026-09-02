// R67 D-03 -- THE Task Master error dictionary.
//
// DECISION D-03, verbatim: "One dictionary in the projexa repo
// (src/lib/task-errors.ts) maps executor/validation codes to closed-vocabulary
// sentences and a 'Fix' chain. Codes: BOQ_LINE_REQUIRED ('Pick a BOQ line'),
// BOQ_LINE_NOT_FOUND ('There is no line {code} on {project} {version} -- pick a
// line'), PROJECT_REQUIRED ('Pick a project'), VALUE_REQUIRED ('Type quantity
// or %'), BACKEND_UNAVAILABLE ('The construction data service didn't answer --
// nothing was saved [Retry]'). The server returns {code, missing: [field]} (the
// 'needs_input' payload); the client never shows a camelCase parameter name, a
// function id, or a host:port."
//
// ONE dictionary, so this file is also where every later screen's error text
// comes from -- item D-65 explicitly says "extend that file, do not start a
// second dictionary".
//
// WHAT WAS ON SCREEN BEFORE. M24Shell rendered pipeline_tasks.error verbatim on
// a blocked row (toTaskRow's `detail: t.error ?? t.rawInput`). That text is
// written by compliance-tracker's executor for developers, so a real user read
// "itemCode is required", "no project resolved for this task",
// "no executor is registered for function_id \"list_leads\" yet" -- and, until
// the R66 fix, "write CONNECT_TIMEOUT 3.109.171.244:6543". None of those tell a
// user what to do next; all of them leak the shape of the system.
//
// THE SERVER'S HALF is compliance-tracker's src/lib/pipeline/task-error-codes.ts
// (the same five codes, the structured failure persisted on a blocked task, and
// the classifier for rows written before it). GET /api/v1/projexa/tasks returns
// `code`, `missing` and `errorContext` alongside the unchanged `error`.

export const TASK_ERROR_CODES = [
  "PROJECT_REQUIRED",
  "BOQ_LINE_REQUIRED",
  "BOQ_LINE_NOT_FOUND",
  "VALUE_REQUIRED",
  "BACKEND_UNAVAILABLE",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/** What GET /api/tasks hands the Task Master for one row. */
export type TaskErrorPayload = {
  code?: string | null;
  missing?: string[] | null;
  errorContext?: { lineCode?: string; boqVersion?: number } | null;
  /** The backend's own text. Only ever shown after sanitiseBackendMessage. */
  error?: string | null;
  /** The project the task was minted against, for BOQ_LINE_NOT_FOUND's sentence. */
  projectName?: string | null;
};

export type TaskErrorDescription = {
  /** The one sentence the row shows. Closed vocabulary -- never the server's prose. */
  sentence: string;
  /**
   * The 'Fix' chain: the chain segments that take the user to where the missing
   * thing is chosen, in order. Empty when the fix is simply to try again.
   */
  fix: string[];
  /** Whether the row offers Retry rather than a chain to follow. */
  retryable: boolean;
  /**
   * The VISIBLE names of the parameters the server reported as missing --
   * "project", "BOQ line" -- for the row's own hover text. Never the raw keys.
   */
  missingLabels: string[];
};

// The user-facing label for each parameter the server can report as missing.
// A key with no entry here is DROPPED rather than printed -- that is the rule
// "the client never shows a camelCase parameter name", enforced by construction
// instead of by review.
const FIELD_LABELS: Record<string, string> = {
  projectId: "project",
  itemCode: "BOQ line",
  percent: "quantity or %",
  quantityDone: "quantity",
};

/** The visible names of the fields still missing, in the order the server gave. */
export function missingFieldLabels(missing: string[] | null | undefined): string[] {
  if (!missing) return [];
  return missing.map((key) => FIELD_LABELS[key]).filter((label): label is string => Boolean(label));
}

export function isTaskErrorCode(value: unknown): value is TaskErrorCode {
  return typeof value === "string" && (TASK_ERROR_CODES as readonly string[]).includes(value);
}

// Anything that would put the shape of the system in front of a user: an
// IP:port, a host:port, a URL, a bare camelCase identifier, or a quoted
// snake_case function id. A message matching any of these is REPLACED, never
// patched -- a half-redacted sentence reads worse than an honest generic one.
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
 * The backend's own words, but only when they are safe to show. Decision D-03's
 * rule is absolute: no camelCase parameter name, no function id, no host:port.
 * Everything else the server writes is human prose authored in this project and
 * is passed through unchanged, because the real reason is what a user can act on.
 */
export function sanitiseBackendMessage(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return GENERIC_FAILURE;
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(text)) ? GENERIC_FAILURE : text;
}

function boqLineSentence(payload: TaskErrorPayload): string {
  const lineCode = payload.errorContext?.lineCode;
  if (!lineCode) return "That BOQ line is not on this project's BOQ — pick a line";
  const project = payload.projectName?.trim();
  const version = payload.errorContext?.boqVersion;
  const where = [project, version ? `v${version}` : null].filter(Boolean).join(" ");
  return where
    ? `There is no line ${lineCode} on ${where} — pick a line`
    : `There is no line ${lineCode} on this project's BOQ — pick a line`;
}

/**
 * The one function every surface calls. Returns null when the task did not fail,
 * so a caller cannot accidentally render an error for a healthy row.
 */
export function describeTaskError(payload: TaskErrorPayload): TaskErrorDescription | null {
  const code = isTaskErrorCode(payload.code) ? payload.code : null;
  const missingLabels = missingFieldLabels(payload.missing);

  if (code === "PROJECT_REQUIRED") {
    return { sentence: "Pick a project", fix: ["Projects"], retryable: false, missingLabels };
  }
  if (code === "BOQ_LINE_REQUIRED") {
    return { sentence: "Pick a BOQ line", fix: ["Scope", "BOQ lines"], retryable: false, missingLabels };
  }
  if (code === "BOQ_LINE_NOT_FOUND") {
    return { sentence: boqLineSentence(payload), fix: ["Scope", "BOQ lines"], retryable: false, missingLabels };
  }
  if (code === "VALUE_REQUIRED") {
    return { sentence: "Type quantity or %", fix: ["Work Progress"], retryable: false, missingLabels };
  }
  if (code === "BACKEND_UNAVAILABLE") {
    return {
      sentence: "The construction data service didn't answer — nothing was saved",
      fix: [],
      retryable: true,
      missingLabels,
    };
  }

  // No code: the row failed for a reason outside the closed set. The server's
  // own words are shown when they are safe (they are human prose written in
  // this project), and replaced when they are not. This is the fallback, not a
  // sixth code -- it never invents a sentence about what went wrong.
  const text = (payload.error ?? "").trim();
  if (!text) return null;
  const sentence = sanitiseBackendMessage(text);
  return { sentence, fix: [], retryable: sentence === GENERIC_FAILURE, missingLabels };
}

/**
 * The single line a Task Master row shows under its title: the dictionary's
 * sentence when the task failed, otherwise what the user actually typed.
 */
export function taskRowDetail(
  payload: TaskErrorPayload,
  rawInput: string | null | undefined
): string | undefined {
  const described = describeTaskError(payload);
  if (described) {
    const suffix = described.retryable ? " [Retry]" : "";
    return `${described.sentence}${suffix}`;
  }
  return rawInput?.trim() || undefined;
}
