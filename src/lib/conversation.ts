// R67 WS-C (C-09) -- BAND 2 AS A CONVERSATION, NOT A BOX THAT EMPTIES.
//
// R-218: the kit's Composer declares a CONVERSATION band and PROJEXA rendered
// nothing in it, so pressing Send produced an empty box, a disabled button and
// a Task Master row reading "itemCode is required". What the user said
// disappeared the instant they sent it.
//
// THIS FILE IS THE BAND'S VOCABULARY AND ITS MEMORY. Every sentence C-09
// quotes is built here, and the turns are serialised here, so both are
// asserted in conversation.test.ts rather than eyeballed on a screen.
//
// THREE RULES IT ENFORCES.
//
// 1. WHAT THE USER TYPED STAYS ON SCREEN. A turn is kept, not replaced, so
//    "what did I just ask for" is answerable after the answer arrives.
// 2. THE BAND SURVIVES NAVIGATION. Opening the screen an answer points at is
//    a read; losing the conversation because of it would make every link a
//    choice between the answer and the question.
// 3. A CARD THAT PREDATES A PROJECT SWITCH IS GREYED AND SAYS SO. Silently
//    keeping "record 50% on excavation" live after the user moved to another
//    project is how the right sentence is written against the wrong project.
//
// PURE. No React, no fetch, no storage access -- the caller passes `now` and
// owns sessionStorage; this module only says what to write and how to read it.

import { TASK_ERROR_DICTIONARY, type TaskErrorCode } from "./task-errors";

// ---------------------------------------------------------------------------
// THE SENTENCES
// ---------------------------------------------------------------------------

/**
 * C-09's understood line, verbatim:
 * "I read this as: Record Work Progress > New entry - Cedar Heights Villa -
 *  Phase 1 - today - 50% - Excavation"
 *
 * It is deliberately NOT the same sentence as C-03's confirmation-card title
 * (composer-turns.ts's understoodLine, "Understood: …"), because the two are
 * different acts: that one titles a card the user is about to fill in, this
 * one is the shell repeating a sentence back before anything is proposed.
 */
export function readAsLine(steps: readonly string[]): string {
  const said = steps.map((s) => s.trim()).filter(Boolean);
  return said.length === 0 ? "I read this as: nothing I can act on yet" : `I read this as: ${said.join(" > ")}`;
}

/**
 * C-09's primary button: "Record", or "Record (1 missing)" while anything is
 * missing -- and disabled in that state, so the count is a reason and not a
 * decoration.
 */
export function recordLabel(missingCount: number): string {
  if (missingCount <= 0) return "Record";
  return `Record (${missingCount} missing)`;
}

/**
 * C-09's receipt, verbatim:
 * "Recorded. WP-000123 - 50% on R60SK-A, 02 Sep 2026."
 *
 * WITH ONE HONEST DEPARTURE: the id clause is dropped when the write did not
 * come back with a short, human id. compliance's own progress rows are keyed
 * by cuid, and printing a 25-character opaque string -- or inventing a
 * "WP-000123" that no row carries -- would be worse than a receipt that names
 * the line, the value and the day.
 */
export function recordedReceiptLine(input: {
  recordId?: string | null;
  percent?: number | null;
  lineCode?: string | null;
  date: string;
}): string {
  const parts: string[] = ["Recorded."];
  const id = (input.recordId ?? "").trim();
  // A readable id is short and has no lower-case cuid tail; anything else is
  // a database key, not something to show a site engineer.
  if (id && id.length <= 12) parts.push(`${id} -`);
  const what: string[] = [];
  if (input.percent !== null && input.percent !== undefined && Number.isFinite(input.percent)) {
    what.push(`${input.percent}%`);
  }
  const code = (input.lineCode ?? "").trim();
  if (code) what.push(`on ${code}`);
  const body = what.join(" ");
  return `${parts.join(" ")}${body ? ` ${body},` : ""} ${readableDate(input.date)}.`.replace(/\s+/g, " ").trim();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "02 Sep 2026" from an ISO date. Fixed table, so no ICU build can change it. */
export function readableDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${m[3]} ${month} ${m[1]}` : isoDate;
}

/** C-09: a card from before a project switch says which project it was for. */
export function staleNote(projectName: string | null | undefined): string {
  const name = (projectName ?? "").trim();
  return name ? `was for ${name}` : "was for another project";
}

/**
 * The chip row's own question, from D-03's closed vocabulary. C-09 builds the
 * chips "from missing[].options"; the LABEL over them still comes from the
 * dictionary, so the words on a row and the words over a picker cannot drift.
 */
const MISSING_FIELD_CODES: Readonly<Record<string, TaskErrorCode>> = {
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

export function missingFieldLabel(field: string): string {
  const key = field.toLowerCase().replace(/[^a-z]/g, "");
  const code = MISSING_FIELD_CODES[key];
  // NEVER the raw camelCase parameter name. An unmapped slot still gets a
  // sentence a person can act on rather than "itemCode".
  return code ? TASK_ERROR_DICTIONARY[code].template : "Answer the question above";
}

/**
 * The word beside a value on the confirmation card. NEVER the parameter name:
 * "itemCode" is a column, not a question, and C-09's rule is that band 2
 * never shows a camelCase parameter or a function id.
 */
const PARAM_LABELS: Readonly<Record<string, string>> = {
  itemcode: "BOQ line",
  boqlineitemid: "BOQ line",
  percent: "Percent complete",
  quantity: "Quantity",
  quantitydone: "Quantity done",
  projectid: "Project",
  spenton: "Date",
  entrydate: "Date",
  hours: "Hours",
  activitytype: "Category",
  task: "Task",
  report: "Report",
  from: "From",
  to: "To",
};

export function paramLabel(field: string): string {
  const key = field.toLowerCase().replace(/[^a-z]/g, "");
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  // A slot nobody has named yet still reads as words: "someNewSlot" ->
  // "Some new slot", never the identifier itself.
  const spaced = field.replace(/[_.]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : field;
}

/**
 * C-09's "Edit in form" link: the module screen that owns this write, so a
 * user who wants every field rather than the card's few has somewhere real to
 * go. Null for a function with no screen -- an "Edit in form" link that leads
 * nowhere is worse than no link.
 */
const FORM_ROUTES: Readonly<Record<string, string>> = {
  record_work_progress: "/work-progress",
  record_timesheet: "/schedule/log-time",
  "reports.report": "/reports",
};

export function editInFormRoute(functionId: string | null | undefined, projectId: string | null): string | null {
  const base = functionId ? FORM_ROUTES[functionId] : undefined;
  if (!base) return null;
  return projectId ? base + "?projectId=" + encodeURIComponent(projectId) : base;
}

// ---------------------------------------------------------------------------
// THE TURNS
// ---------------------------------------------------------------------------

export type ConversationTurn =
  /** What the user typed. Rendered as a right-hand bubble. */
  | { kind: "said"; id: string; at: number; projectId: string | null; text: string }
  /** A completed write, with the object it produced. */
  | { kind: "receipt"; id: string; at: number; projectId: string | null; text: string; href: string }
  /** A read the product answered in words: rows live in the live state, not here. */
  | { kind: "note"; id: string; at: number; projectId: string | null; text: string }
  /** Something the product cannot do, with the nearest screen. */
  | { kind: "gap"; id: string; at: number; projectId: string | null; text: string; href?: string; hrefLabel?: string };

/**
 * A turn before the shell stamps it. DISTRIBUTIVE, deliberately: a plain
 * Omit<ConversationTurn, "id" | "at"> collapses the union to its common
 * members and would reject a receipt's own href.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewConversationTurn = DistributiveOmit<ConversationTurn, "id" | "at">;

/** Enough to be a conversation, few enough that band 2 stays a band. */
export const MAX_TURNS = 12;

export function appendTurn(turns: readonly ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  const next = [...turns, turn];
  return next.length <= MAX_TURNS ? next : next.slice(next.length - MAX_TURNS);
}

/** The sessionStorage key. Per USER, because the turns are that person's. */
export function conversationKey(userEmail: string | null | undefined): string {
  const who = (userEmail ?? "").trim().toLowerCase() || "anonymous";
  return `veri.band2.${who}`;
}

type StoredShape = { v: 1; turns: ConversationTurn[] };

export function serialiseTurns(turns: readonly ConversationTurn[]): string {
  return JSON.stringify({ v: 1, turns: turns.slice(-MAX_TURNS) } satisfies StoredShape);
}

/**
 * Read back what was stored, narrowed to the contract.
 *
 * A stored blob is untrusted input: it survives a deploy, so it can have been
 * written by an older version of this file. Anything that does not match is
 * dropped rather than rendered, because a half-parsed turn on screen is worse
 * than a band that starts empty.
 */
export function parseTurns(raw: string | null | undefined): ConversationTurn[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const shape = parsed as Record<string, unknown>;
  if (shape.v !== 1 || !Array.isArray(shape.turns)) return [];
  const out: ConversationTurn[] = [];
  for (const item of shape.turns) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.text !== "string" || typeof t.at !== "number") continue;
    const projectId = typeof t.projectId === "string" ? t.projectId : null;
    if (t.kind === "said" || t.kind === "note") {
      out.push({ kind: t.kind, id: t.id, at: t.at, projectId, text: t.text });
    } else if (t.kind === "receipt" && typeof t.href === "string") {
      out.push({ kind: "receipt", id: t.id, at: t.at, projectId, text: t.text, href: t.href });
    } else if (t.kind === "gap") {
      out.push({
        kind: "gap",
        id: t.id,
        at: t.at,
        projectId,
        text: t.text,
        href: typeof t.href === "string" ? t.href : undefined,
        hrefLabel: typeof t.hrefLabel === "string" ? t.hrefLabel : undefined,
      });
    }
  }
  return out.slice(-MAX_TURNS);
}

/** True when this turn was made against a different project than the one now. */
export function isStale(turn: ConversationTurn, currentProjectId: string | null): boolean {
  if (turn.projectId === null) return false;
  return turn.projectId !== currentProjectId;
}
