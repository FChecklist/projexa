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
  projectName?: string | null;
  /** The module the current screen IS, when standing in one. */
  moduleLabel?: string | null;
  /** The armed card, when one is armed. Standing on a module is not an action. */
  action?: ArmedAction | null;
  /** What the armed action still needs, in the order it should be asked for. */
  missing?: readonly MissingParam[];
  /** The input box has real content. */
  hasText: boolean;
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
  if (!state.hasProject) return "no-project";
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
 * THE SEND BUTTON'S OWN NAME. A button labelled by what it will do is the
 * cheapest possible way to answer "what happens if I press this", and it is
 * the reason the strip no longer has to.
 *
 * IT NEVER BECOMES "Sending...". Replacing the label mid-flight destroys the
 * one word the user was reading to decide whether to press it, and it makes
 * the button's width jump; a spinner sits beside it instead (see Composer).
 */
export function sendLabel(state: ComposerState): string {
  const status = chainStatus(state);
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
  if (!state.hasProjects || !state.hasProject) return false;
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
