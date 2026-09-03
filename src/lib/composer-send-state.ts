// R67 G-04 (R-231). The composer's Send button, as a pure function, so
// "exactly one instruction per state" and "never a dead control with no
// words" are asserted rather than hoped for.
//
// THE DEFECTS THIS ENCODES AGAINST, both real in the kit's Composer:
//   1. A SILENT DEAD STATE. Send was disabled whenever the textarea was
//      empty, and in that state `disabledReason` was undefined -- so the
//      button was grey, unclickable, and unexplained.
//   2. AN INSTRUCTION THAT CONTRADICTED THE CONTROL. In that same state, once
//      a module pill had been picked, the placeholder read "Press send to run
//      this, or add detail first…" -- telling the user to press a button that
//      had been disabled. A wrong instruction is worse than a missing one.
//
// The rule below is that the reason and the disabled flag come from ONE
// evaluation, so they cannot drift apart.

export type ComposerSendInput = {
  /** The caller's own blocking reason: a server refusal, or "Sending…". Most specific, so it wins. */
  disabledReason?: string;
  /** The raw textarea contents. */
  value: string;
  /** True when something runnable is already armed, so an empty input is a real submission. */
  allowEmptySubmit?: boolean;
  /** The sentence for "nothing typed yet, and nothing armed". */
  emptyInputReason: string;
  /** False when the caller wired no submit handler at all. */
  hasSubmitHandler: boolean;
};

export type ComposerSendState = {
  canSubmit: boolean;
  /** Undefined only when the button is live. Never undefined while it is disabled. */
  reason: string | undefined;
};

export function composerSendState({
  disabledReason,
  value,
  allowEmptySubmit = false,
  emptyInputReason,
  hasSubmitHandler,
}: ComposerSendInput): ComposerSendState {
  const blockedByCaller = Boolean(disabledReason);
  const nothingTyped = value.trim().length === 0 && !allowEmptySubmit;
  const canSubmit = hasSubmitHandler && !blockedByCaller && !nothingTyped;
  const reason = blockedByCaller ? disabledReason : nothingTyped ? emptyInputReason : undefined;
  return { canSubmit, reason };
}

// ---------------------------------------------------------------------------
// R67 C-15 / DE-45 -- THE SEND BUTTON SAYS WHAT IT IS STILL WAITING FOR.
// ---------------------------------------------------------------------------

/**
 * The words that go in the brackets, per slot. D-03's own sentences with the
 * first letter lowered, so the button reads as one sentence -- "Send (pick a
 * BOQ line)" -- rather than as a label with a title pasted into it.
 *
 * A slot with no entry here yields a plain "Send" rather than a guess: the
 * chip row above the button is already asking the question in full, and a
 * button reading "Send (someNewSlot)" would put the camelCase parameter name
 * back on screen, which is the whole thing D-03 removes.
 */
const SEND_SLOT_WORDS: Readonly<Record<string, string>> = {
  itemcode: "pick a BOQ line",
  boqlineitemid: "pick a BOQ line",
  boqline: "pick a BOQ line",
  projectid: "pick a project",
  project: "pick a project",
  percent: "type a quantity or %",
  quantity: "type a quantity or %",
  quantitydone: "type a quantity or %",
  hours: "type the hours",
  task: "pick a task",
  issueid: "pick a task",
  workerid: "pick a worker",
};

/**
 * "Send (pick a BOQ line)" -- or plain "Send" when nothing is outstanding.
 *
 * ONE question at a time: only the FIRST missing slot is named, because that
 * is the one the chip row above is asking and a button listing three is a
 * button nobody reads.
 */
export function sendLabelFor(missing: readonly string[] | null | undefined): string {
  const first = missing?.find((m) => typeof m === "string" && m.trim().length > 0);
  if (!first) return "Send";
  const words = SEND_SLOT_WORDS[first.toLowerCase().replace(/[^a-z]/g, "")];
  return words ? `Send (${words})` : "Send";
}
