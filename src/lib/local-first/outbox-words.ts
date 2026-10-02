// LOCAL-FIRST: the outbox's own vocabulary and its two size rules, kept apart from outbox.ts so they are plain, pure and tested.
//
// 1. SENTENCES for the codes the SYNC service itself answers with (the pipeline's codes live in @/lib/task-errors and are
//    resolved there). Each names what happened and what the person can do; none shows a code, an id or a host. A code
//    neither dictionary knows falls back to task-errors' honest generic sentence (outbox.ts rejectionMessage).
//
// 2. THE TEXT RULE the server applies to anything written through the AI work link (compliance-tracker
//    src/lib/pipeline/ai-link-text.ts): control / zero-width / bidi characters are removed, a run of 3+ backticks becomes two
//    apostrophes, and a free-text value with more than 2,000 characters LEFT is refused (TEXT_TOO_LONG). The laptop applies
//    the same count BEFORE an edit is queued, so a long text is never accepted here only to be refused and undone later
//    (review finding data:F4). The person's text is never shortened: the screen keeps it and says what the limit is.
//
// 3. THE PER-OP CEILING (compliance-tracker drizzle/0681: `length(p_op::text) > 65536` -> BAD_OP). Postgres prints jsonb with
//    ", " and ": " separators, so the length is estimated the way Postgres prints it (wire-conformance F12).

/** Spec 5.4 / 9.11 (ai-link-text.ts AI_LINK_TEXT_MAX). */
export const MAX_TEXT_CHARS = 2000;
/** 0681's per-op ceiling, as Postgres counts it (characters of the op's jsonb text). */
export const MAX_OP_CHARS = 65_536;

/** The parameter names the server treats as free text: ai-link-text.ts FREE_TEXT_PARAMS plus the registry's text_params of the wired writes. */
const FREE_TEXT_PARAMS: ReadonlySet<string> = new Set([
  "note", "notes", "title", "name", "description", "remarks", "comment", "label", "fileLabel",
  "subject", "question", "answer",
]);

const REMOVED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008], [0x000b, 0x001f], [0x007f, 0x009f], [0x061c, 0x061c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x2029],
  [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xe0000, 0xe007f],
];

/** The length the server counts: the text after its own cleaning (ai-link-text.ts cleanText), in UTF-16 units like JS `.length`. */
export function cleanedLength(text: string): number {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (!REMOVED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) out += ch;
  }
  return out.replace(/\x60{3,}/g, "''").length;
}

export type TextProblem = { field: string; length: number; limit: number };

/** The first free-text parameter the server would refuse as too long, or null. */
export function textLimitProblem(params: Record<string, unknown>): TextProblem | null {
  for (const [field, value] of Object.entries(params)) {
    if (typeof value !== "string" || !FREE_TEXT_PARAMS.has(field)) continue;
    const length = cleanedLength(value);
    if (length > MAX_TEXT_CHARS) return { field, length, limit: MAX_TEXT_CHARS };
  }
  return null;
}

const FIELD_WORDS: Record<string, string> = {
  title: "title", description: "description", subject: "subject", question: "question", answer: "answer",
  note: "note", notes: "notes", remarks: "remarks", comment: "comment", name: "name", label: "label", fileLabel: "file label",
};

/** The sentence for a text that is too long, naming the field and the limit (never the parameter's code name). */
export function textTooLongMessage(problem: TextProblem): string {
  const field = FIELD_WORDS[problem.field] ?? "text";
  return `The ${field} has ${problem.length.toLocaleString("en-GB")} characters; the most that can be sent from this laptop is ${problem.limit.toLocaleString("en-GB")}. Your text is kept: shorten it and save again.`;
}

/** Characters of `value` as Postgres prints it as jsonb text (", " and ": " separators). */
export function pgJsonLength(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (Array.isArray(value)) {
    const parts = value.map((v) => pgJsonLength(v));
    return 2 + parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 2;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    const parts = entries.map(([k, v]) => JSON.stringify(k).length + 2 + pgJsonLength(v));
    return 2 + parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 2;
  }
  return (JSON.stringify(value) ?? "null").length;
}

/** True when one op is above the server's per-op ceiling (it would be refused BAD_OP whatever it says). */
export const opTooLarge = (wireOp: unknown) => pgJsonLength(wireOp) > MAX_OP_CHARS;

/** Sentences for the codes the SYNC service answers with (handler.ts / 0681), not the pipeline's. */
const SYNC_SENTENCES: Record<string, string> = {
  TEXT_TOO_LONG: `A text in it is longer than ${MAX_TEXT_CHARS.toLocaleString("en-GB")} characters, the most that can be sent from this laptop. Shorten it and send it again`,
  ROLE_TOO_LOW: "Your role in this organisation does not allow this change. Ask someone with a higher role to make it",
  FUNCTION_NOT_ALLOWED: "This kind of change cannot be sent from this laptop. Make it on the online screen",
  PROJECT_NOT_READABLE: "You no longer have access to that project",
  OP_ID_REUSED: "The server already holds a different change under the same reference. Send it again as a new change",
  BAD_OP: "The server could not read it (it may be too large). Make it smaller and send it again",
  CAP_DAY: "Today's limit of changes sent from this laptop has been reached. Send it again tomorrow",
  RECORD_DELETED: "It was deleted by someone else",
  EXECUTION_UNCERTAIN: "The server could not confirm whether it was saved",
};

/** The sync service's own sentence for a code, or null when the code is not one of its own. */
export function syncCodeSentence(code: string | null | undefined): string | null {
  return code ? SYNC_SENTENCES[code] ?? null : null;
}

/** The sentence a draft's card leads with when an edit was turned down: what was not saved and why, and that the text is kept. */
export function keptLine(label: string | undefined): string {
  return label ? `${label} was not saved.` : "A change you made on this laptop was not saved.";
}
