// R67 WS-C (C-08) -- WHAT THE CHIP GRID SHOWS, AND UNDER WHICH HEADING.
//
// Extracted out of the forked OptionChain so the two rules that matter can be
// asserted directly rather than through a DOM event:
//
//   1. the filter matches what a foreman would type -- a name OR a trade,
//      case-insensitively;
//   2. A HEADING NEVER SURVIVES ITS OWN GROUP. If a search leaves no
//      carpenters visible, the word "Carpenter" goes with them. A heading
//      standing over nothing reads as "every carpenter is off site today",
//      which is not what a filter did, and on an attendance grid that
//      misreading is a payroll error.
//
// PURE. No React, no DOM.

export type GridOption = {
  id: string;
  label: string;
  /** A second string the search should match: the worker's trade. */
  keywords?: string;
  isLeaf?: boolean;
  unavailableReason?: string;
};

export type GridGroup = { label: string; optionIds: readonly string[] };

/** Case-insensitive substring over the label and the option's own keywords. */
export function filterOptions<T extends GridOption>(options: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter(
    (o) => o.label.toLowerCase().includes(needle) || (o.keywords ?? "").toLowerCase().includes(needle)
  );
}

/**
 * The rows the grid renders: one per group that still has a visible member,
 * in the groups' own order, plus an "Other" row for anything no group claims.
 *
 * With no groups at all it is one unlabelled row, which is exactly what the
 * kit's flat chip strip was -- so a level that does not group loses nothing.
 */
export function groupOptions<T extends GridOption>(
  visible: readonly T[],
  groups: readonly GridGroup[] | undefined
): { label: string | null; options: T[] }[] {
  if (!groups || groups.length === 0) return [{ label: null, options: [...visible] }];
  const byId = new Map(visible.map((o) => [o.id, o]));
  const rows: { label: string | null; options: T[] }[] = [];
  const claimed = new Set<string>();
  for (const group of groups) {
    const members: T[] = [];
    for (const id of group.optionIds) {
      const option = byId.get(id);
      if (!option || claimed.has(id)) continue;
      claimed.add(id);
      members.push(option);
    }
    // A group with nothing visible in it is not rendered AT ALL -- see the
    // header comment: an empty heading is a wrong statement, not a tidy one.
    if (members.length > 0) rows.push({ label: group.label, options: members });
  }
  const ungrouped = visible.filter((o) => !claimed.has(o.id));
  if (ungrouped.length > 0) rows.push({ label: "Other", options: ungrouped });
  return rows;
}
