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
// ("Product", "Project Name") -- never the API's own camelCase parameter
// names, which is the same rule src/lib/task-errors.ts applies to failures.

export type ProjectFormValues = {
  productId: string;
  name: string;
};

/**
 * The visible labels of the required fields that are still empty, in the order
 * they appear on the form. An empty array means the form can be saved.
 */
export function missingProjectFields(values: ProjectFormValues): string[] {
  const missing: string[] = [];
  if (!values.productId.trim()) missing.push("Product");
  if (!values.name.trim()) missing.push("Project Name");
  return missing;
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
