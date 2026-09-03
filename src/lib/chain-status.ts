// R67 WS-A (A-10) -- ONE INSTRUCTION PER STATE, AND ONE PLACE THAT DECIDES IT.
//
// THE DEFECT THIS REPLACES. The composer's strings were computed from
// `projectId || pendingFunctionId` at the point of render, which is not a
// state machine -- it is two booleans and a guess. It produced four sentences
// that could contradict each other on one screen:
//
//   "Select a module to begin"                      (in the strip, always)
//   "Pick a project or a module first"              (beside Send)
//   "Describe what you need, or pick a module above."   (the placeholder)
//   "Press send to run this, or add detail first..."    (the other placeholder)
//
// A user standing inside Permits with a project selected could read the first
// two at once: one telling them to pick a module they were already in, the
// other naming a project that was already chosen. All four are retired here
// and chain-status.test.ts asserts that no reachable state can produce any of
// them again.
//
// THE MODEL. A state resolves to exactly ONE status, and every string the
// composer shows is a function of that status. The strip asks the NEXT
// QUESTION; the footer line is empty unless something actually failed; the
// Send button is named for what it will do. Nothing is printed twice.
//
// WHY THE STATUS SET IS SLIGHTLY LARGER THAN A-10'S LIST. The item names
// no-project | no-action | missing-step:<param> | ready-pill | ready-text |
// sending | error. Two more are needed to keep earlier items true, and both
// are genuinely different states rather than sub-cases:
//   "no-projects"  the ORG has none at all (A-05). "Which project?" is the
//                  wrong question when the answer cannot exist yet; the right
//                  sentence names the one thing that can be done.
//   "not-found"    the URL is not a shipped page (A-06). The shell still
//                  renders, and asking about projects on a page that does not
//                  exist would be answering a question nobody asked.

/** What the composer will do when Send is pressed. Mirrors CardDef["kind"]. */
export type ActionKind = "write" | "ask" | "run";

/** The armed action -- a card whose function the server actually knows. */
export type ArmedAction = {
  /** The card's own words, e.g. "Record progress". */
  label: string;
  /** The object half of the card, e.g. "progress" -- used by the Save label. */
  object: string;
  kind: ActionKind;
};

/** A parameter the armed action still needs before it can run. */
export type MissingParam = {
  /** Stable key, so the status is assertable: "missing-step:itemCode". */
  key: string;
  /** The words a person reads: "Which BOQ line?" */
  label: string;
};

export type ComposerState = {
  /** False when no page.tsx serves this URL (A-06). */
  shipped?: boolean;
  /** False only once the projects list has really loaded and is empty. */
  hasProjects: boolean;
  /** A project is resolved -- from the route's projectId or the top rail. */
  hasProject: boolean;
  /**
   * A-19. FALSE on a screen whose work is org-wide -- the Reports catalogue,
   * Customers, Vendors. Defaults to true, because almost everything in this
   * product is written against one project. Without it, "pick a project" would
   * be listed as a missing thing on screens where a project is not part of the
   * sentence at all, and Send would sit disabled waiting for something the user
   * has no reason to choose.
   */
  projectRequired?: boolean;
  projectName?: string | null;
  /** The module the current screen IS, when standing in one. */
  moduleLabel?: string | null;
  /** The armed card, when one is armed. Standing on a module is not an action. */
  action?: ArmedAction | null;
  /** What the armed action still needs, in the order it should be asked for. */
  missing?: readonly MissingParam[];
  /** The input box has real content. */
  hasText: boolean;
  /**
   * A-19. The user has put at least one segment of their OWN in the strip --
   * a module, a card, a step. The screen's own module does not count: standing
   * on Permits is not the same as having said anything.
   */
  hasSegment?: boolean;
  /**
   * A-15. The user has said, in as many words, that they will type it: they
   * chose "Other - type it". It changes nothing about the STATE -- no segment
   * is added and the strip's own question is untouched -- but it does change
   * what the Send button is waiting for, and the button says so.
   */
  awaitingText?: boolean;
  /** A submission is in flight. */
  busy?: boolean;
  /** Something failed, in the backend's own words. Never a generic string. */
  error?: string | null;
};

export type ChainStatus =
  | "not-found"
  | "sending"
  | "error"
  | "no-projects"
  | "no-project"
  | `missing-step:${string}`
  | "ready-pill"
  | "ready-text"
  | "no-action";

/**
 * THE STATE MACHINE. Precedence is deliberate and reads top to bottom as
 * "which question is the earliest one still unanswered".
 */
export function chainStatus(state: ComposerState): ChainStatus {
  if (state.shipped === false) return "not-found";
  if (state.busy) return "sending";
  if (state.error) return "error";
  if (!state.hasProjects) return "no-projects";
  // A-19: on an org-wide screen there is no project to be missing.
  if (!state.hasProject && state.projectRequired !== false) return "no-project";
  if (state.action) {
    const missing = state.missing ?? [];
    if (missing.length > 0) return `missing-step:${missing[0].key}`;
    return "ready-pill";
  }
  if (state.hasText) return "ready-text";
  return "no-action";
}

/**
 * The question the STRIP asks, and the only instruction on screen.
 *
 * An EMPTY string is a real answer, not a gap: when the sentence is complete
 * there is no next question, and the Send button's own name says what will
 * happen. Printing "Press send to run this" beside a button labelled "Save
 * progress" is the duplication this item exists to remove.
 *
 * The error state asks the same question the state underneath it would --
 * the failure itself is rendered once, in the footer, in the backend's words.
 */
export function chainPrompt(state: ComposerState): string {
  const status = chainStatus(state.error ? { ...state, error: null } : state);
  switch (status) {
    case "not-found":
      return "Page not found — HOME";
    case "sending":
      return "";
    case "no-projects":
      // A-05: the sentence names the one action available rather than
      // describing the emptiness.
      return "No projects yet — Create Project";
    case "no-project":
      return "Which project? Choose one in the top rail";
    case "ready-pill":
    case "ready-text":
      return "";
    case "no-action":
      // A-06: inside a module the missing step is never "pick a module" -- the
      // user is standing in one, and the two ways forward are the cards just
      // above the box and the box itself.
      return state.moduleLabel
        ? `Pick an action above or type what you need on ${state.moduleLabel}`
        : "What do you want to do?";
    default: {
      const first = (state.missing ?? [])[0];
      return first ? `Which ${first.label}?` : "What do you want to do?";
    }
  }
}

/**
 * R67 A-19 -- THE ONE MISSING THING, IN THE USER'S OWN WORDS.
 *
 * A-19 replaces the grey reason text beside the Send button with the LABEL
 * form: "Send" when it can be pressed, otherwise "Send (pick a project, say
 * what you need)". The reason is then unmissable -- it is written on the thing
 * the user is reaching for -- and there is exactly one place on screen where
 * "why can't I send" is answered.
 *
 * ORDER IS FIXED AND IS NOT A PREFERENCE: a project first, because it is the
 * decision every other one hangs off, and because getting it wrong is the most
 * expensive mistake this product offers.
 *
 * NOTE WHAT "say what you need" IS MISSING FROM. A SEGMENT counts as having
 * said something -- A-19's own acceptance is that clicking a module pill drops
 * that clause and changes nothing else -- so it is asked for only when the user
 * has neither picked anything nor typed anything.
 */
export const MISSING_PROJECT = "pick a project";
export const MISSING_TEXT = "say what you need";

export function missingThings(state: ComposerState): string[] {
  const missing: string[] = [];
  if (state.projectRequired !== false && !state.hasProject && state.hasProjects) missing.push(MISSING_PROJECT);
  if (!state.action && !state.hasSegment && !state.hasText) missing.push(MISSING_TEXT);
  return missing;
}

/**
 * THE SEND BUTTON'S OWN NAME. A button labelled by what it will do is the
 * cheapest possible way to answer "what happens if I press this", and it is
 * the reason the strip no longer has to.
 *
 * IT NEVER BECOMES "Sending...". Replacing the label mid-flight destroys the
 * one word the user was reading to decide whether to press it, and it makes
 * the button's width jump; a spinner sits beside it instead (see Composer).
 *
 * A-10 AND A-19 BOTH NAME THIS BUTTON, and the precedence between them is
 * deliberate: an ARMED action is named for what it will do ("Save progress",
 * "Ask", "Run"), because at that point nothing is missing and "Send" would be
 * strictly less informative. Everything else -- which is every state A-19's own
 * acceptance sweeps, since it walks the tab routes at rest with nothing armed
 * -- takes the "Send (...)" form.
 */
export function sendLabel(state: ComposerState): string {
  // Computed from the state UNDERNEATH any error, for the same reason
  // chainPrompt() is: after a failure the user's next move is to try again, and
  // a button that renamed itself from "Save progress" to "Send" the moment
  // something went wrong would be describing the error rather than the action.
  const status = chainStatus(state.error ? { ...state, error: null } : state);
  if (status.startsWith("missing-step:")) {
    const missing = state.missing ?? [];
    const n = missing.length;
    return `${state.action?.label ?? "Send"} (${n} required field${n === 1 ? "" : "s"})`;
  }
  if (status === "ready-pill" || (status === "sending" && state.action)) {
    switch (state.action!.kind) {
      case "write":
        return `Save ${state.action!.object}`;
      case "ask":
        return "Ask";
      case "run":
        return "Run";
    }
  }
  // A-19 GENERALISES A-15'S SHAPE. A-15 shipped "Send (say what you need)" for
  // the one case it owned -- the user had chosen "Other - type it" and the only
  // thing left was the sentence. A-19 makes that the rule for every missing
  // thing, in one fixed order, so the button answers "why can't I press this"
  // wherever the answer happens to be. "Other - type it" still forces the text
  // clause even when a segment is present, because the user has just said in as
  // many words that they are going to type.
  const missing = missingThings(state);
  if (state.awaitingText && !state.hasText && !missing.includes(MISSING_TEXT)) missing.push(MISSING_TEXT);
  if (missing.length > 0) return `Send (${missing.join(", ")})`;
  // Free text, and every state where nothing is armed: the generic verb is
  // correct because the server decides what the sentence means.
  return "Send";
}

/**
 * Whether a submission is actually possible. POST /api/tasks takes either
 * { rawInput } or { functionId }, so with neither there is nothing to send and
 * the button must be disabled rather than failing after the click.
 */
export function canSend(state: ComposerState): boolean {
  const status = chainStatus(state);
  if (status === "sending" || status === "not-found") return false;
  if (!state.hasProjects) return false;
  // A-19: a project is required almost everywhere, and on the screens where it
  // is not, demanding one would block work that is genuinely org-wide.
  if (state.projectRequired !== false && !state.hasProject) return false;
  if (status.startsWith("missing-step:")) return false;
  return Boolean(state.action) || state.hasText;
}

/** Every string this module can put on screen, for the exhaustiveness test
 *  and for anything that needs to prove a retired sentence is unreachable. */
export const RETIRED_STRINGS: readonly string[] = [
  "Select a module to begin",
  "Pick a project or a module first",
  "Describe what you need, or pick a module above.",
  "Press send to run this, or add detail first…",
  "Press Send to run this, or add detail",
  "Pick a project in the top rail to start",
];
