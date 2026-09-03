// R67 WS-C (C-16) -- BAND 2 ASKS INSTEAD OF REFUSING.
//
// THE DEFECT THIS CLOSES. Everything up to C-15 could ASK one question --
// "Pick a BOQ line" -- and only that one. The shell said so in three separate
// places, each with the same hard-coded branch:
//
//     if (resolved.missingStep === "boqLine") setLevelPath([...]);
//
// Every other missing slot fell through to a sentence with no control under
// it: a refusal in nicer words. C-16's rule is that a missing slot OPENS ITS
// OWN PICKER -- boqLine, worker, value, task -- or, where the route already
// answered it, is not asked at all (DE-30).
//
// It also owns the two facts the composer needs BEFORE any Send:
//   * `openQuestionSlots` -- what band 2 is asking right now, as slot names,
//     so the Send button can read "Send (pick a BOQ line)" from the moment the
//     chips appear rather than only after a Send has come back short;
//   * `chainRunFor` -- whether the walk is DONE, which is what C-16 keys the
//     confirmation card off ("when done is true the confirmation card renders
//     in band 2 and only its Save/Ask/Run executes").
//
// PURE. No React, no fetch, no Date. Every rule below is asserted in
// chain-walk.test.ts.

import type { MissingStep } from "./task-errors";
import { missingFieldLabel } from "./conversation";

// ---------------------------------------------------------------------------
// 1. WHICH PICKER ANSWERS WHICH STEP
// ---------------------------------------------------------------------------

/** A chain-options level path, exactly as /api/chain-options addresses one. */
export type LevelPath = readonly string[];

/**
 * The level band 2 opens for a missing step, or null when chips are the wrong
 * shape of answer.
 *
 * WHY THREE OF THE FIVE ARE NULL, AND WHY THAT IS NOT A GAP:
 *   * `value`   -- a quantity or a percentage is a NUMBER. The common four are
 *                  chips on the value level itself; the rest is the labelled
 *                  field in band 4. There is no level of "every number".
 *   * `project` -- the top rail owns the project, and DE-30 means the question
 *                  is usually already answered by the route. A second project
 *                  selector in band 2 is the duplicate control the audit found.
 *   * `task`    -- the timesheet card carries its own task select, populated
 *                  from the project's real issues (C-03). Opening a second
 *                  picker for the same slot would be two controls for one
 *                  answer.
 */
export const LEVEL_FOR_STEP: Readonly<Record<MissingStep, LevelPath | null>> = {
  boqLine: ["work_progress", "record_progress"],
  worker: ["manpower", "mark_attendance"],
  value: null,
  project: null,
  task: null,
};

export function levelForStep(step: MissingStep | null | undefined): string[] | null {
  if (!step) return null;
  const path = LEVEL_FOR_STEP[step];
  return path ? [...path] : null;
}

/** What the caller already knows, which can turn a dead step into a live one. */
export type KnownValues = { itemCode?: string | null };

/**
 * The level to open for a step, GIVEN WHAT IS ALREADY RESOLVED.
 *
 * The one case that matters, and it is the case C-16 is about: when the server
 * says only the VALUE is missing, it has already resolved the BOQ line -- so
 * "Type quantity or %" is not a step without a control, it is the value level
 * of that line, chips and all. Without this the user read the sentence with
 * nothing underneath it, which is the refusal C-16 exists to remove.
 */
export function levelPathForStep(
  step: MissingStep | null | undefined,
  known: KnownValues = {}
): string[] | null {
  if (step === "value") {
    const code = (known.itemCode ?? "").trim();
    const parent = LEVEL_FOR_STEP.boqLine;
    return code && parent ? [...parent, code] : null;
  }
  return levelForStep(step);
}

/**
 * Slot name -> step. The same normalisation conversation.ts's own
 * missingFieldLabel uses, so the sentence over the chips and the chips
 * themselves are chosen by one reading of the slot name.
 */
const STEP_FOR_SLOT: Readonly<Record<string, MissingStep>> = {
  itemcode: "boqLine",
  boqlineitemid: "boqLine",
  boqline: "boqLine",
  projectid: "project",
  project: "project",
  percent: "value",
  quantity: "value",
  quantitydone: "value",
  hours: "value",
  task: "task",
  issueid: "task",
  workerid: "worker",
  worker: "worker",
};

export function stepForSlot(slot: string): MissingStep | null {
  return STEP_FOR_SLOT[slot.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

// ---------------------------------------------------------------------------
// 2. DE-30 -- A QUESTION THE ROUTE HAS ALREADY ANSWERED IS NOT ASKED
// ---------------------------------------------------------------------------

/** What the screen the user is standing on already knows. */
export type RouteAnswers = {
  /** The project on the rail or in the URL. Non-null answers the project slot. */
  projectId?: string | null;
};

/**
 * The slots still genuinely open, in the server's own order.
 *
 * *** THE PROJECT IS DROPPED WHEN THE ROUTE CARRIES ONE. *** C-16's own
 * acceptance is "band 2 shows BOQ-line chips ... (no project chips)" on
 * /work-progress?projectId=<Cedar>. Asking a foreman which project he is
 * looking at, on the screen for that project, is the question the audit
 * counted as a wasted click.
 */
export function unansweredSlots(
  missing: readonly string[] | null | undefined,
  answers: RouteAnswers = {}
): string[] {
  const out: string[] = [];
  for (const slot of missing ?? []) {
    if (typeof slot !== "string" || !slot.trim()) continue;
    if (stepForSlot(slot) === "project" && answers.projectId) continue;
    out.push(slot);
  }
  return out;
}

export type Question = {
  /** The raw slot name. Never rendered. */
  slot: string;
  step: MissingStep | null;
  /** D-03's sentence: "Pick a BOQ line", "Pick a worker", "Type quantity or %". */
  label: string;
  /** The level to open, or null when the answer is typed rather than picked. */
  levelPath: string[] | null;
};

/**
 * ONE QUESTION AT A TIME -- the first slot the route has not already answered.
 *
 * Null when nothing is outstanding, which is the state the confirmation card
 * belongs to.
 */
export function firstQuestion(
  missing: readonly string[] | null | undefined,
  answers: RouteAnswers = {},
  known: KnownValues = {}
): Question | null {
  const slot = unansweredSlots(missing, answers)[0];
  if (!slot) return null;
  const step = stepForSlot(slot);
  return { slot, step, label: missingFieldLabel(slot), levelPath: levelPathForStep(step, known) };
}

// ---------------------------------------------------------------------------
// 3. WHAT BAND 2 IS ASKING RIGHT NOW
// ---------------------------------------------------------------------------

const WORK_PROGRESS = "work_progress";
const RECORD_PROGRESS = "record_progress";

/**
 * The slots the OPEN level is waiting on, expressed the way the server would
 * express them, so composer-send-state's sendLabelFor() names the live
 * question -- "Send (pick a BOQ line)" -- from the moment the chips render.
 *
 * Before C-16 that label could only come from a response, so a user who
 * clicked "Record progress" and read the button saw a bare "Send" for a
 * chain that could not run yet.
 *
 * The attendance level is deliberately empty: its answer is saved by its own
 * "Save attendance (12 present, 0 absent)" button, and a Send label naming a
 * worker would point at a control that is not the one that writes.
 */
export function openQuestionSlots(levelPath: readonly string[], value: string): string[] {
  if (levelPath[0] !== WORK_PROGRESS || levelPath[1] !== RECORD_PROGRESS) return [];
  if (!levelPath[2]) return ["itemCode"];
  if (!resolvedValue(levelPath, value)) return ["percent"];
  return [];
}

// ---------------------------------------------------------------------------
// 4. IS THE WALK DONE?
// ---------------------------------------------------------------------------

/**
 * The value the walk currently holds: the chip the user clicked, else what
 * they typed into the band-4 field.
 *
 * *** AN EMPTY FIELD IS NOT A ZERO. *** This is a real defect fixed here, not
 * a restatement: the shell used to compute `Number(levelPath[3] ?? scalarValue)`
 * directly, and `Number("")` is 0 -- finite, in range -- so a BOQ line picked
 * with the value box untouched produced a runnable chain that would have
 * recorded 0 % against that line. The value question has to be a real
 * question, which means "nothing typed" has to be nothing.
 */
function resolvedValue(levelPath: readonly string[], value: string): string | null {
  const raw = (levelPath[3] ?? value ?? "").trim();
  return raw ? raw : null;
}

export type ChainRun = {
  functionId: "record_work_progress";
  params: { itemCode: string; percent: number };
};

/**
 * What Send (or the confirmation card's Save) would run, once the chain is a
 * complete sentence -- and null until then, which is what lets the composer
 * say "Pick a BOQ line" instead of accepting a submission that can only come
 * back blocked.
 *
 * `itemCode` is the chain's own segment id: chain-options.ts's
 * boqLineOptions() puts the item code on the chip because the executor
 * resolves a line by item_code within the project's current BOQ.
 *
 * ONLY PERCENT, DELIBERATELY. C-16's example value chips read "2 nos" / "40 %".
 * VERIDIAN's registered write (executeRecordWorkProgress) accepts itemCode and
 * a numeric PERCENT and nothing else -- a "2 nos" chip would post 2 into a
 * percent column, which is a wrong number written confidently. The quantity
 * shape is a backend change, not a chip.
 */
export function chainRunFor(input: { levelPath: readonly string[]; value: string }): ChainRun | null {
  const { levelPath, value } = input;
  if (levelPath[0] !== WORK_PROGRESS || levelPath[1] !== RECORD_PROGRESS) return null;
  const itemCode = levelPath[2];
  if (!itemCode) return null;
  const raw = resolvedValue(levelPath, value);
  if (raw === null) return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return { functionId: "record_work_progress", params: { itemCode, percent } };
}

/** C-16's "when done is true". */
export function chainDone(input: { levelPath: readonly string[]; value: string }): boolean {
  return chainRunFor(input) !== null;
}

// ---------------------------------------------------------------------------
// 5. THE CONFIRMATION CARD'S OWN SENTENCE
// ---------------------------------------------------------------------------

/**
 * "Record Work Progress > New entry — R66-1009b Excavation · 50 %".
 *
 * NOT PREFIXED "Understood:". That word belongs to the typed path, where the
 * server read a sentence and the user has to check the reading. Nothing was
 * read here: the user built this by clicking, and the card's job is to show
 * the sentence they built before it is written.
 */
export function chainConfirmTitle(input: { lineLabel: string | null; percent: number }): string {
  const line = (input.lineLabel ?? "").trim();
  const clauses = [line, `${input.percent} %`].filter(Boolean);
  return `Record Work Progress > New entry — ${clauses.join(" · ")}`;
}

/** "Recorded 50% on R66-1009b Excavation" -- the receipt for a built chain. */
export function chainReceiptLine(input: { lineLabel: string | null; percent: number }): string {
  const line = (input.lineLabel ?? "").trim();
  return line ? `Recorded ${input.percent}% on ${line}` : `Recorded ${input.percent}%`;
}
