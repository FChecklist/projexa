// R67 WS-C (C-16) -- D-08'S BUDGET, COUNTED RATHER THAN CLAIMED.
//
// C-16 ends with a hard constraint on the flow it describes: "The whole flow
// must fit D-08's budget: at most 3 clicks including Save and at most 1 typed
// value." Every earlier claim of that shape in this programme was a sentence
// in a document. This is the arithmetic, as data, so a change that quietly
// adds a step fails a test instead of being noticed by whoever next reads the
// screen.
//
// D-08's counting rule, verbatim from the decision:
//
//   "a click is one deliberate selection on a card, chip, row, button or Enter
//    on a highlighted chip; the OS file picker is part of the click that
//    opened it; typing into one field is one typed value, capped at one per
//    task; the budget is at most 3 clicks including the final Save/Ask/Run and
//    at most 1 typed value."
//
// ONE HONEST DISTINCTION THE RULE ITSELF FORCES. C-16's acceptance lists FOUR
// deliberate selections -- the "Record progress" card, the BOQ line, the
// value, Save -- and then says "Total: three clicks". Both cannot be true of
// the same number, so the two are counted separately here and each is named:
//
//   * `entry`  -- the selection that says WHICH TASK this is ("Record
//                 progress"). A route that already carries the module or the
//                 project answers it for free (DE-30), which is why the same
//                 flow costs one click less when it is reached from a door
//                 (C-06) than from a cold composer.
//   * `clicks` -- everything after that, INCLUDING the final Save. This is the
//                 number D-08's "at most 3 including Save" is measured
//                 against, and it is what the acceptance's "three clicks"
//                 counts.
//
// `total` is both, so nothing here can be read as hiding a click.
//
// PURE. No React, no fetch. Asserted in click-budget.test.ts.

/** One deliberate act in a flow. */
export type FlowStep = {
  /** What the user does, in the words they would use. */
  label: string;
  kind: FlowStepKind;
};

export type FlowStepKind =
  /** The selection that chooses the task itself. Free when a route carries it. */
  | "entry"
  /** A chip, row or card selection inside the task. */
  | "select"
  /** Typing into one labelled field. Capped at one per task by D-08. */
  | "type"
  /** The final Save / Ask / Run. Counted as a click. */
  | "commit";

export const CLICK_BUDGET = 3;
export const TYPED_VALUE_BUDGET = 1;

export type FlowCost = {
  /** Selections + the commit, excluding the entry. D-08's budgeted number. */
  clicks: number;
  /** The entry selection, when the flow pays for one. 0 or 1. */
  entry: number;
  /** entry + clicks -- every deliberate act, so nothing is hidden. */
  total: number;
  typedValues: number;
  withinBudget: boolean;
  /**
   * Why it does not fit, in words, or null. A budget check that fails with a
   * bare `false` tells whoever hits it nothing about what to remove.
   */
  reason: string | null;
};

export function costOf(steps: readonly FlowStep[]): FlowCost {
  const entry = steps.filter((s) => s.kind === "entry").length;
  const clicks = steps.filter((s) => s.kind === "select" || s.kind === "commit").length;
  const typedValues = steps.filter((s) => s.kind === "type").length;
  const overClicks = clicks > CLICK_BUDGET;
  const overTyped = typedValues > TYPED_VALUE_BUDGET;
  return {
    clicks,
    entry,
    total: entry + clicks,
    typedValues,
    withinBudget: !overClicks && !overTyped,
    reason: overClicks
      ? `${clicks} clicks, budget ${CLICK_BUDGET}`
      : overTyped
        ? `${typedValues} typed values, budget ${TYPED_VALUE_BUDGET}`
        : null,
  };
}

/**
 * C-16's own flow, as the shell actually implements it after this item:
 * /work-progress?projectId=<Cedar>, no rail selection, no typing at all.
 *
 * The project costs NOTHING because the route carries it (DE-30) -- that is
 * the click this item removes, and it is why the same walk used to need a top
 * rail selection first.
 */
export const RECORD_PROGRESS_BY_CHIPS: readonly FlowStep[] = [
  { label: "Record progress", kind: "entry" },
  { label: "R66-1009b Excavation", kind: "select" },
  { label: "50 %", kind: "select" },
  { label: "Save", kind: "commit" },
];

/**
 * The same task where the value is not one of the four chips -- 37 %, say.
 * D-08 allows exactly one typed value per task, and this is it.
 */
export const RECORD_PROGRESS_TYPED_VALUE: readonly FlowStep[] = [
  { label: "Record progress", kind: "entry" },
  { label: "R66-1009b Excavation", kind: "select" },
  { label: "37", kind: "type" },
  { label: "Save", kind: "commit" },
];

/**
 * A whole crew's attendance (C-08): the roster arrives ticked, so a normal
 * morning is the entry and the Save. Marking one man absent is one more
 * selection and still inside the budget.
 */
export const MARK_ATTENDANCE: readonly FlowStep[] = [
  { label: "Mark attendance", kind: "entry" },
  { label: "Save attendance (12 present, 0 absent)", kind: "commit" },
];
