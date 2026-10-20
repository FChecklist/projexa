// R67 D-01 -- the required-field rule behind the /projects/new create screen.
//
// Correction C-01 recorded that "+ Create Project" on the home screen was the
// one popup left in PROJEXA, and decision D-01 moved it to a real route with a
// breadcrumb, a Back control and a Save that is disabled WITH THE REASON --
// naming the fields that are still missing rather than sitting inert.
//
// The rule lives here, not in the component, for two reasons: it is the part
// worth testing (a component that needs a Next router context cannot be
// rendered in bun:test without one), and /labour/new already proved the
// pattern that every other create screen is being migrated onto -- a disabled
// primary whose LABEL is the list of what is missing.
//
// The field names below are the ones the user actually reads on the form
// ("Project Name") -- never the API's own camelCase parameter
// names, which is the same rule src/lib/task-errors.ts applies to failures.

export type ProjectFormValues = {
  name: string;
};

/**
 * The visible labels of the required fields that are still empty. NOTHING is required any more (owner order: never block the user): an empty name
 * becomes "New project <date>" on save, and can be renamed later. Kept as a function so the screen's gating reads the same way and a field can be
 * made required again in one place.
 */
export function missingProjectFields(values: ProjectFormValues): string[] {
  void values;
  return [];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "New project 20 Oct 2026" -- the name given when the person leaves Project Name empty. */
export function defaultProjectName(now: Date = new Date()): string {
  return `New project ${String(now.getDate()).padStart(2, "0")} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

/** The trimmed name the person typed, else the default name. */
export function resolveProjectName(name: string, now: Date = new Date()): string {
  return name.trim() || defaultProjectName(now);
}

/**
 * What the Save control says while it cannot be pressed. `undefined` means the
 * button is live and needs no explanation.
 */
export function projectSaveDisabledReason(missing: string[], submitting: boolean): string | undefined {
  if (submitting) return "Saving…";
  if (missing.length === 0) return undefined;
  return missing.join(", ");
}
