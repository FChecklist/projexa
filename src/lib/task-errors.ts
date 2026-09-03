// Binding decision D-03 -- ONE error dictionary for this product.
//
// The rule it exists to enforce: a person is never shown a camelCase parameter
// name, a function id, a stack frame or a host:port. The pipeline answers with
// a CODE (and, for a missing input, which field is missing); this module is
// the single place that turns one into a sentence somebody can act on.
//
// It lives in projexa because it is a PRODUCT vocabulary, not a backend
// detail: the same code has to read the same way in the composer's Task Master
// row, on the Reports screen and anywhere else a run can fail.
//
// R67 E-10 (R-129/R-133/R-137) is the first consumer: a failed report run
// renders the backend's own sentence when it has one, and a mapped sentence
// when what came back is a code.

/** The closed vocabulary. Adding a code here is how a new failure becomes speakable. */
export const TASK_ERROR_MESSAGES: Record<string, string> = {
  // D-03's five, verbatim.
  BOQ_LINE_REQUIRED: "Pick a BOQ line",
  BOQ_LINE_NOT_FOUND: "There is no line {code} on {project} {version} — pick a line",
  PROJECT_REQUIRED: "Pick a project",
  VALUE_REQUIRED: "Type quantity or %",
  BACKEND_UNAVAILABLE: "The construction data service didn't answer — nothing was saved",
};

/** What a screen should offer next for a given code -- the "Fix" chain D-03 names. */
export const TASK_ERROR_FIX: Record<string, string> = {
  BOQ_LINE_REQUIRED: "Open the BOQ",
  BOQ_LINE_NOT_FOUND: "Open the BOQ",
  PROJECT_REQUIRED: "Pick a project in the top rail",
  VALUE_REQUIRED: "Type a quantity",
  BACKEND_UNAVAILABLE: "Retry",
};

export type TaskErrorPayload = {
  /** The pipeline's own code, e.g. "BOQ_LINE_REQUIRED". */
  code?: string | null;
  /** Which fields the server said were missing. Never rendered raw -- see missingFieldLabel. */
  missing?: string[] | null;
  /** A sentence the backend already wrote. Preferred over any mapping when it reads like one. */
  message?: string | null;
  /** Placeholder values for a templated message ({code}, {project}, {version}). */
  values?: Record<string, string> | null;
};

/**
 * A camelCase parameter name is exactly what D-03 forbids showing, so the few
 * fields that reach a person get real words. An unknown field is described by
 * its shape ("a value"), never printed.
 */
const FIELD_LABELS: Record<string, string> = {
  projectId: "a project",
  boqLineItemId: "a BOQ line",
  boqId: "a BOQ",
  quantity: "a quantity",
  percentComplete: "a percentage",
  entryDate: "a date",
  from: "a start date",
  to: "an end date",
  weekStart: "a week start",
  vendorId: "a vendor",
  category: "a category",
};

export function missingFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? "a value";
}

/** True when a string is a machine token rather than something a person wrote. */
export function looksLikeCode(value: string): boolean {
  const s = value.trim();
  if (s === "") return false;
  // SCREAMING_SNAKE, a bare function id, or anything carrying a host:port or a
  // file path -- none of which is a sentence.
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(s)) return true;
  if (/https?:\/\/|localhost:\d|:\d{4,5}\b/.test(s)) return true;
  if (/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9_.]*$/.test(s)) return true; // construction.record_work_progress
  return false;
}

function fill(template: string, values: Record<string, string> | null | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => values?.[key] ?? `the ${key}`);
}

/**
 * The one function a screen calls. It prefers, in order:
 *   1. a mapped sentence for a known code,
 *   2. the backend's own message when it reads like a sentence,
 *   3. a sentence built from the missing fields,
 *   4. a last-resort sentence that still says what happened.
 *
 * It never returns a code, a parameter name, a URL or an empty string.
 */
export function taskErrorSentence(payload: TaskErrorPayload | string | null | undefined, fallback = "That didn't run — nothing was saved"): string {
  if (payload === null || payload === undefined) return fallback;
  const p: TaskErrorPayload = typeof payload === "string" ? (looksLikeCode(payload) ? { code: payload } : { message: payload }) : payload;

  const code = p.code?.trim();
  if (code && TASK_ERROR_MESSAGES[code]) return fill(TASK_ERROR_MESSAGES[code], p.values);

  const message = p.message?.trim();
  if (message && !looksLikeCode(message)) return message;

  const missing = (p.missing ?? []).filter((f) => f && f.trim() !== "");
  if (missing.length > 0) {
    const labels = missing.map(missingFieldLabel);
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    return `This needs ${list} first`;
  }

  // A code nobody has taught us yet: say what happened and offer the retry,
  // rather than printing the token at a person.
  return fallback;
}

/** The action to offer beside the sentence, when the code names one. */
export function taskErrorFix(payload: TaskErrorPayload | string | null | undefined): string | null {
  if (payload === null || payload === undefined) return null;
  const code = typeof payload === "string" ? payload : payload.code;
  return code ? (TASK_ERROR_FIX[code.trim()] ?? null) : null;
}
