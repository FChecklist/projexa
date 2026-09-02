// R67 WS-A (A-01) -- ONE INSTRUCTION PER STATE.
//
// THE DEFECT THIS REPLACES: the composer told the user two different things
// about one state. The control strip printed the kit's fixed "Select a module
// to begin" while, six lines lower, the Send button printed "Pick a project or
// a module first" -- one sentence naming a module, the other naming a project,
// neither naming the actual missing step. A user who has a project selected and
// has typed nothing read both at once.
//
// This module is the single source of that sentence. It is pure and injectable
// so every state can be asserted without a browser, and the composer renders
// its result exactly ONCE (in the strip) and reuses the same string as the Send
// button's tooltip and accessible name rather than printing it again.
//
// The closed set of sentences is deliberately small -- five states, five
// strings -- because a user learns a fixed vocabulary once and then stops
// reading it.

export type ComposerState = {
  /** False only once the projects list has really loaded and is empty. */
  hasProjects: boolean;
  /** A project is resolved -- from the route's projectId or the top rail. */
  hasProject: boolean;
  /** The resolved project's name, for the sentence that names it. */
  projectName?: string | null;
  /** The module the current screen IS, when the composer is standing in one. */
  moduleLabel?: string | null;
  /**
   * The user has armed something submittable -- a pill whose functionId the
   * server knows. Standing on a module screen is NOT an action: the module is
   * context, and submitting it alone would post an empty task.
   */
  hasAction: boolean;
  /** The input box has real content. */
  hasText: boolean;
  /** A submission is in flight. */
  busy?: boolean;
  /**
   * A-06. FALSE when no page.tsx serves this URL. The shell still renders --
   * a bare error card with no rail, no strip and no way back is the dead end
   * this whole programme exists to remove -- and the strip says what happened.
   */
  shipped?: boolean;
};

/** THE ONE SENTENCE. Rendered in the strip; reused as the Send tooltip. */
export function composerInstruction(state: ComposerState): string {
  if (state.busy) return "Sending…";
  // A-06: a 404 is a state of the SCREEN, not of the chain, so it outranks
  // every question about projects and modules -- asking "which project?" on a
  // page that does not exist would be answering the wrong question.
  if (state.shipped === false) return "Page not found — HOME";
  // A-05: the org has nothing to work on yet. The sentence names the one
  // action available rather than describing the emptiness.
  if (!state.hasProjects) return "No projects yet — Create Project";
  if (!state.hasProject) return "Pick a project in the top rail to start";
  if (!state.hasText && !state.hasAction) {
    // A-06. Inside a module the missing step is never "pick a project or a
    // module" -- the user is standing in the module and the project is already
    // named to the left. The sentence names the two things that WOULD move the
    // chain on, in this module's own words.
    //
    // This supersedes A-03's "Type what you need for <project>" for the same
    // state: that named the project a second time (the strip's own root is
    // already showing it) and never mentioned the cards directly above the
    // input, which are the faster of the two routes forward.
    if (state.moduleLabel) return `Pick an action above or type what you need on ${state.moduleLabel}`;
    // A-05: rendered after the project root, the strip reads as one sentence
    // -- "Cedar Heights Villa - Phase 1 > What do you want to do?" -- which is
    // the question the composer actually wants answered.
    return "What do you want to do?";
  }
  return "Press Send to run this, or add detail";
}

/**
 * Whether a submission is actually possible. POST /api/tasks takes either
 * { rawInput } or { functionId }, so with neither there is nothing to send and
 * the button must be disabled rather than failing after the click.
 */
export function canSend(state: ComposerState): boolean {
  if (state.busy) return false;
  if (!state.hasProjects || !state.hasProject) return false;
  return state.hasText || state.hasAction;
}
