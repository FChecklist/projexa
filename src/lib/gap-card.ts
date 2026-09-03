// R67 WS-C (C-12) -- WHAT BAND 2 SAYS BACK: THE ECHO, THE ONE QUESTION, AND
// THE HONEST REFUSAL.
//
// THE DEFECT. "Send leaves an empty box, a disabled Send and a Task Master row
// reading 'itemCode is required'." C-05 and C-09 built the band and the
// proposal card; this file is the three sentences those still could not say:
//
//   1. THE ECHO, FIELD BY FIELD. "Understood: Record Work Progress › New entry
//      — Project: Cedar Heights Villa - Phase 1 · Activity: excavation · 50 %
//      · Date: 02-09-2026". The understood LINE (C-09's "I read this as: …")
//      says which chain was read; this says which VALUES were read, which is
//      the half a person has to check before pressing Record.
//   2. THE ONE QUESTION. A gap gets a chip row for the FIRST missing slot with
//      the two best fuzzy matches first, "Show all 28 lines" for the rest, and
//      a primary button that says how many answers it is still waiting for.
//   3. THE REFUSAL. Where the pipeline cannot run something at all, the card
//      says so in words and names the screen that can -- rather than a
//      disabled button, an empty box, or a blocked Task Master row.
//
// PURE. No React, no fetch, no Date.now() -- every rule below is asserted in
// gap-card.test.ts.

import { paramLabel } from "@/lib/conversation";

// ---------------------------------------------------------------------------
// 1. THE ECHO
// ---------------------------------------------------------------------------

export type EchoField = { name: string; label: string; value: string };

/** Params the echo never prints: ids the user did not type and cannot read. */
const HIDDEN_PARAMS = new Set(["projectid", "boqlineitemid", "issueid", "orgid", "userid"]);

/**
 * One "Label: value" clause per resolved param, in the order the pipeline
 * resolved them.
 *
 * A PERCENTAGE PRINTS AS "50 %" WITH NO LABEL. C-12's own example does, and it
 * is right: "Percent complete: 50" is three words to say what "50 %" says in
 * two, and the unit is the label.
 */
export function echoFields(params: Record<string, unknown>): EchoField[] {
  const out: EchoField[] = [];
  for (const [name, raw] of Object.entries(params)) {
    if (HIDDEN_PARAMS.has(name.toLowerCase())) continue;
    if (raw === null || raw === undefined || raw === "") continue;
    const value = String(raw).trim();
    if (!value) continue;
    out.push({ name, label: paramLabel(name), value });
  }
  return out;
}

/** "Percent complete" + 50 -> "50 %"; everything else -> "Label: value". */
export function echoClause(field: EchoField): string {
  const key = field.name.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "percent" || key.endsWith("percent")) return `${field.value} %`;
  return `${field.label}: ${field.value}`;
}

/**
 * C-12's echo card title, verbatim in shape:
 *   "Understood: <title> — <clause> · <clause> · <clause>"
 *
 * With no resolved values at all it stops after the title rather than trailing
 * an empty dash, because "Understood: Record Work Progress —" reads as a
 * sentence that lost its end.
 */
export function echoLine(title: string, fields: readonly EchoField[]): string {
  const clauses = fields.map(echoClause);
  return clauses.length === 0 ? `Understood: ${title}` : `Understood: ${title} — ${clauses.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// 2. THE ONE QUESTION
// ---------------------------------------------------------------------------

/** "1 answer needed" / "2 answers needed" / null when nothing is missing. */
export function answersNeededLabel(missingCount: number): string | null {
  if (missingCount <= 0) return null;
  return `${missingCount} answer${missingCount === 1 ? "" : "s"} needed`;
}

/**
 * C-12: "the two best fuzzy matches first then 'Show all 28 lines'". The NOUN
 * is passed in because "Show all 28 options" is not what a BOQ list is called
 * on site.
 */
export function showAllLabel(total: number, noun = "options"): string {
  return `Show all ${total} ${noun}`;
}

export type RankableOption = { id: string; label: string; keywords?: string };

/**
 * Score one option against what the user actually typed. Higher is better; 0
 * means "no reason to prefer this one".
 *
 * Deliberately not a similarity library: the tiers below are the ones that
 * matter for a BOQ line or a worker's name, they are explainable to a user
 * ("it matched the code you typed"), and a tie keeps the server's own order --
 * which for a BOQ is the order of the bill, the order the foreman reads it in.
 */
export function scoreOption(option: RankableOption, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = option.label.toLowerCase();
  const keywords = (option.keywords ?? "").toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (keywords.includes(q)) return 50;

  // Every word the person said appears somewhere in this option. "excavation
  // works" finds "R60SK-A Excavation and earth works".
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const hay = `${label} ${keywords}`;
  const hits = words.filter((w) => hay.includes(w)).length;
  if (hits === words.length) return 40;
  return hits > 0 ? 10 + hits : 0;
}

export type RankedOptions<T extends RankableOption> = {
  /** The best matches, most likely first. Empty when nothing matched at all. */
  best: T[];
  /** Everything else, in the server's own order. */
  rest: T[];
};

/**
 * The two best matches first, the rest behind "Show all N".
 *
 * A ZERO-SCORING OPTION IS NEVER PROMOTED. Padding `best` to two entries with
 * options that match nothing would put a wrong answer in the position a user
 * reads first, which is worse than showing one chip.
 */
export function rankOptions<T extends RankableOption>(
  options: readonly T[],
  query: string,
  bestCount = 2
): RankedOptions<T> {
  const scored = options.map((option, index) => ({ option, index, score: scoreOption(option, query) }));
  const matched = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .slice(0, Math.max(0, bestCount));
  const bestIds = new Set(matched.map((m) => m.option.id));
  return {
    best: matched.map((m) => m.option),
    rest: options.filter((o) => !bestIds.has(o.id)),
  };
}

// ---------------------------------------------------------------------------
// 3. THE HONEST REFUSAL
// ---------------------------------------------------------------------------

export type Refusal = {
  /** The whole sentence, ending in what to do instead. */
  sentence: string;
  /** The screen that CAN do it. Null when this product has none. */
  href: string | null;
  /** The word on the link. Never "click here". */
  linkLabel: string | null;
};

/**
 * Where a thing the composer cannot run can actually be done.
 *
 * DISCLOSED DEVIATION FROM C-12'S WORDING. The item quotes "Customers can't be
 * created from PROJEXA yet — open Customers in VERIDIAN →". That was true when
 * the audit was written and is not true now: this repo ships
 * /customers/new, a real create screen with a real POST /api/customers behind
 * it. What the composer cannot do is run the write through the PIPELINE --
 * executor.ts registers list_customers (a read) and no create. Sending a user
 * to another product for something this one does would be a worse defect than
 * the wording drift, so the sentence names the screen that exists and says
 * which surface is the limitation.
 */
const CREATE_SCREENS: Readonly<Record<string, { noun: string; route: string; label: string }>> = {
  customers: { noun: "Customers", route: "/customers/new", label: "open the Customers form" },
  vendors: { noun: "Vendors", route: "/vendors/new", label: "open the Vendors form" },
  projects: { noun: "Projects", route: "/projects/new", label: "open the New Project form" },
};

export type RefusalInput = {
  /** The composer's mode: "projects" | "customers" | "vendors". */
  mode: string;
  /** The pipeline's verdict for this sentence. */
  verdict: "task" | "chat" | "gap";
  /** Whether the pipeline has an executor for the resolved function at all. */
  executable: boolean;
  /** The pipeline's own message, when it wrote one. */
  message?: string | null;
  /** The screen nearest to what was asked for, when the caller knows one. */
  nearestScreen?: { label: string; route: string } | null;
  /** Did the user's sentence ask to CREATE something? */
  creating?: boolean;
};

/**
 * The sentence for a thing this product will not do right now -- or null when
 * there is nothing to refuse.
 *
 * Three shapes, all ending in a way forward:
 *   - a create in a mode whose writes the pipeline does not carry
 *   - a question when chat is not switched on for this workspace
 *   - anything else the pipeline cannot execute, pointed at the nearest screen
 */
export function refusalFor(input: RefusalInput): Refusal | null {
  if (input.executable) return null;

  const mode = input.mode.trim().toLowerCase();
  const screen = CREATE_SCREENS[mode];
  if (input.creating && screen) {
    return {
      sentence: `${screen.noun} can't be created from the composer yet — ${screen.label} →`,
      href: screen.route,
      linkLabel: screen.label,
    };
  }

  if (input.verdict === "chat") {
    const near = input.nearestScreen;
    return {
      sentence: near
        ? `Questions aren't switched on for this workspace yet — here is the ${near.label} screen →`
        : "Questions aren't switched on for this workspace yet.",
      href: near?.route ?? null,
      linkLabel: near ? `Open ${near.label}` : null,
    };
  }

  const near = input.nearestScreen;
  return {
    sentence: near
      ? `PROJEXA can't do that from here yet — here is the ${near.label} screen →`
      : "PROJEXA can't do that yet.",
    href: near?.route ?? null,
    linkLabel: near ? `Open ${near.label}` : null,
  };
}

/**
 * Did the sentence ask to create something? A closed verb list, because
 * "create" is the one word this refusal turns on and guessing it from a model
 * would make the refusal itself unpredictable.
 */
const CREATE_VERBS = /\b(create|add|new|register|open|set up|onboard)\b/i;

export function looksLikeCreate(text: string): boolean {
  return CREATE_VERBS.test(text);
}
