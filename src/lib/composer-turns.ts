// R67 WS-C (C-05) -- WHAT BAND 2 SAYS, AS PURE FUNCTIONS.
//
// The composer's conversation band is the product's only answer to "did that
// do anything?". Before R67 a Send left an empty box, a disabled Send and a
// blocked Task Master row reading "itemCode is required". This file owns the
// three sentences that replace it -- the UNDERSTOOD line, the RECEIPT line
// and the TIMING line -- so each one is asserted here rather than eyeballed
// in a screenshot, and so none of them can be written twice with two
// different wordings.
//
// PURE. No React, no fetch, no clock of its own: elapsed time is passed in.

// ---------------------------------------------------------------------------
// "Understood: ..."
// ---------------------------------------------------------------------------

/**
 * The line band 2 shows within 300 ms of a Send, before anything is written.
 *
 * It is the SERVER's reading of the sentence, echoed back in the strip's own
 * grammar, so the user checks a chain rather than trusting a spinner:
 *   "Understood: Cedar Heights > Work Progress > Record progress > Excavation"
 *
 * An empty chain is not "Understood:" with nothing after it -- that would be
 * a sentence that says less than silence. It says so plainly instead.
 */
export function understoodLine(steps: readonly string[]): string {
  const parts = steps.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "Understood, but I could not place it on a screen yet";
  return `Understood: ${parts.join(" > ")}`;
}

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

export type ProgressReceipt = {
  /** The BOQ line's description: "Excavation". */
  lineLabel: string;
  /** Its code: "R60SK-A". Omitted from the sentence when the row has none. */
  itemCode?: string | null;
  percent: number;
  /** ISO yyyy-mm-dd. Rendered dd-mm-yyyy, the form Sumeet's own screens use. */
  date: string;
  /** The created record's own id, when the write returned one. */
  recordId?: string | null;
};

/** "02-09-2026" from "2026-09-02". Returns the input unchanged if it is not a date. */
export function shortDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDate;
}

/**
 * C-05's receipt, verbatim where the facts exist:
 *   "✓ Progress saved: Excavation (R60SK-A) 50% on 02-09-2026 — WP-0412"
 *
 * A FACT THAT DOES NOT EXIST IS DROPPED, NEVER INVENTED. A row with no item
 * code and no returned id still produces a sentence a person can check
 * against the screen, which is the whole job of a receipt.
 */
export function progressReceiptLine(r: ProgressReceipt): string {
  const code = r.itemCode?.trim() ? ` (${r.itemCode.trim()})` : "";
  const id = r.recordId?.trim() ? ` — ${r.recordId.trim()}` : "";
  return `✓ Progress saved: ${r.lineLabel}${code} ${r.percent}% on ${shortDate(r.date)}${id}`;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type TimingPhase = "idle" | "working" | "elapsed" | "stalled";

export type TimingState = {
  phase: TimingPhase;
  /** Null while idle -- nothing is shown for a request that answers instantly. */
  text: string | null;
  /** Word buttons, in the order they are rendered. Never icons. */
  actions: ("stop" | "keep" | "cancel")[];
};

/** Below this a request has effectively answered instantly; showing a
 *  spinner for it is noise that makes the product feel slower, not faster. */
export const TIMING_QUIET_MS = 300;
/** After this the user has waited long enough to want a number, not a promise. */
export const TIMING_ELAPSED_MS = 5_000;
/** After this the honest thing to say is that we are still waiting, and to
 *  offer the choice rather than deciding for them. */
export const TIMING_STALLED_MS = 20_000;

/**
 * What band 2 says while a request is in flight. Mandatory states, C-05:
 * nothing for the first 300 ms, then "Working… (usually 3 s)" with a Stop,
 * then the elapsed seconds, then -- at 20 s -- naming the service we are
 * waiting on and offering Keep waiting or Cancel.
 */
export function timingState(elapsedMs: number): TimingState {
  if (elapsedMs < TIMING_QUIET_MS) return { phase: "idle", text: null, actions: [] };
  if (elapsedMs < TIMING_ELAPSED_MS) {
    return { phase: "working", text: "Working… (usually 3 s)", actions: ["stop"] };
  }
  if (elapsedMs < TIMING_STALLED_MS) {
    return { phase: "elapsed", text: `Working… ${Math.floor(elapsedMs / 1000)} s`, actions: ["stop"] };
  }
  return {
    phase: "stalled",
    text: "Still waiting on the construction data service",
    actions: ["keep", "cancel"],
  };
}

// ---------------------------------------------------------------------------
// The preview payload
// ---------------------------------------------------------------------------

/** One segment of VERIDIAN's classify-only response, narrowed to what band 2 reads. */
export type PreviewSegment = {
  verdict: "task" | "chat" | "gap";
  functionId: string | null;
  params: Record<string, unknown>;
  missingParams: string[];
  /** The derived chain, already in the strip's grammar. */
  chainSteps: string[];
  chainRoot: string | null;
  /** The pipeline's own sentence for a gap or a partial. */
  message: string | null;
};

/**
 * Narrow an untrusted /api/classify response. A malformed segment is dropped
 * rather than rendered as a turn with blank facts, and a response with no
 * usable segment returns an empty array -- which the caller must treat as
 * "the preview said nothing", not as "there is nothing to do".
 */
export function readPreviewSegments(raw: unknown): PreviewSegment[] {
  if (!raw || typeof raw !== "object") return [];
  const segments = (raw as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  const out: PreviewSegment[] = [];
  for (const s of segments) {
    if (!s || typeof s !== "object") continue;
    const seg = s as Record<string, unknown>;
    const verdict = seg.verdict;
    if (verdict !== "task" && verdict !== "chat" && verdict !== "gap") continue;
    const chain = (seg.derivedChain ?? null) as { root?: unknown; steps?: unknown } | null;
    out.push({
      verdict,
      functionId: typeof seg.functionId === "string" ? seg.functionId : null,
      params: seg.params && typeof seg.params === "object" ? (seg.params as Record<string, unknown>) : {},
      missingParams: Array.isArray(seg.missingParams)
        ? seg.missingParams.filter((m): m is string => typeof m === "string")
        : [],
      chainSteps: Array.isArray(chain?.steps) ? chain!.steps.filter((x): x is string => typeof x === "string") : [],
      chainRoot: typeof chain?.root === "string" ? chain.root : null,
      message: typeof seg.message === "string" ? seg.message : null,
    });
  }
  return out;
}

/** The steps the "Understood:" line reads, root first. */
export function previewSteps(seg: PreviewSegment): string[] {
  return [seg.chainRoot ?? "", ...seg.chainSteps].map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export type AnswerRowDto = { id: string; label: string; value?: string };

// The keys a row's WORDS live under, in preference order, across the real
// payloads this pipeline's read functions return (BOQ lines, activities,
// leads, customers, departments). Not a guess at a general JSON convention --
// a closed list, extended only when a real payload needs it.
const LABEL_KEYS = ["title", "name", "description", "label", "itemCode", "code", "projectName", "activityName"];
// The keys a row's FIGURE lives under. Rendered on the right, never parsed.
const VALUE_KEYS = ["percentComplete", "percent", "amount", "total", "value", "count", "quantity", "status", "dueDate"];

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Turn a read function's real result into rows, or into nothing.
 *
 * ROWS FIRST is only honest if the rows are real. This reads the shapes the
 * pipeline's own read functions actually return -- an array of objects, or an
 * object whose single array property holds them -- and returns [] for
 * anything else, so the caller shows the pipeline's own sentence rather than
 * a table invented from a shape nobody checked.
 */
export function answerRowsFrom(result: unknown, limit = 8): AnswerRowDto[] {
  let list: unknown[] | null = null;
  if (Array.isArray(result)) {
    list = result;
  } else if (result && typeof result === "object") {
    const arrays = Object.values(result as Record<string, unknown>).filter(Array.isArray);
    if (arrays.length === 1) list = arrays[0] as unknown[];
  }
  if (!list) return [];

  const rows: AnswerRowDto[] = [];
  for (const item of list.slice(0, limit)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = firstString(row, LABEL_KEYS);
    if (!label) continue;
    const value = firstString(row, VALUE_KEYS);
    rows.push({
      id: typeof row.id === "string" ? row.id : `${rows.length}-${label}`,
      label,
      value: value ?? undefined,
    });
  }
  return rows;
}
