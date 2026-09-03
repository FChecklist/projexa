// R67 G-04 (R-231). The New Task screen's Type control, as a pure state
// machine, so the rule "never a placeholder that could be read as a chosen
// value" is unit-testable rather than eyeballed in a browser.
//
// THE DEFECT. `placeholder={types.length ? "Select a type" : "Loading…"}`
// put the word "Loading…" in a select's VALUE SLOT -- the place a select
// puts the answer. The control read as though "Loading…" were a task type
// the user had picked. It also conflated three different situations behind
// one string: options still arriving, the org genuinely having no task
// types, and the fetch having failed. And it left the control ENABLED
// throughout, so opening it mid-load showed an empty menu, which looks
// exactly like "there are no task types".

export type ScheduleTypesState = "loading" | "ready" | "empty" | "error";

/**
 * Derives the state from what the load actually produced.
 * `loaded` is null while the request is in flight; `failed` distinguishes a
 * non-OK response from a genuinely empty list -- previously both produced
 * `[]` and the user was told the org had no task types when VERIDIAN had in
 * fact returned a 502.
 */
export function scheduleTypesState({ loaded, failed }: { loaded: unknown[] | null; failed: boolean }): ScheduleTypesState {
  if (failed) return "error";
  if (loaded === null) return "loading";
  return loaded.length > 0 ? "ready" : "empty";
}

/**
 * What the control shows. The loading state deliberately shows NO TEXT -- a
 * skeleton stands in for the control -- because any word here occupies the
 * value slot.
 */
export const SCHEDULE_TYPE_PLACEHOLDER: Record<ScheduleTypesState, string> = {
  loading: "",
  ready: "Select a type",
  empty: "No task types - Add one",
  error: "Task types didn't load",
};

/**
 * The one instruction for each state, or null when the control already says
 * everything there is to say. Task types are defined in VERIDIAN, not in
 * PROJEXA, so the empty state names where they come from rather than
 * offering an "Add" that leads nowhere; and because the server applies the
 * org's default type when none is sent, neither the empty nor the error
 * state blocks Save -- both say so.
 */
export const SCHEDULE_TYPE_HINT: Record<ScheduleTypesState, string | null> = {
  loading: null,
  ready: null,
  empty: "Task types come from VERIDIAN. Saving now uses your organisation's default type.",
  error: "Saving now uses your organisation's default type.",
};

/** The control can only be opened when there is something in it to choose. */
export function scheduleTypeDisabled(state: ScheduleTypesState): boolean {
  return state !== "ready";
}
