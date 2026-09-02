// R67 WS-A (A-11, A-12, A-14) -- THE EXPANDED PILL LIST: FIXED, FROZEN, WIRED.
//
// THREE ITEMS ASK FOR THE SAME OBJECT, so it is built once, here.
//
//   A-11  "Replace the kit's 14 UNIVERSAL_PILLS with a projexa-owned catalogue
//         module ... and drop universal pills that have no PROJEXA screen."
//   A-12  "The catalogue is projexa code in src/lib/pill-catalogue.ts, not
//         platform.mode_pills ... a pill with no wired leaf does not render ...
//         each pill shows its key hint (for example 'P' for Permits)."
//   A-14  "The expanded 'All modules' list renders from a fixed catalogue
//         array ... never from usage."
//
// WHAT THIS FILE ADDS OVER card-catalogue.ts, which already owns the CARDS and
// Sumeet's module order:
//
//  1. IT IS THE RENDERED LIST, and it is FROZEN AT MODULE LOAD. Not "sorted
//     deterministically", not "recomputed identically" -- one array, built
//     once, returned by identity to every caller for the life of the tab.
//     A-14 exists because the list used to move: the last pill clicked was
//     pulled to the front and that order persisted across routes, so the same
//     control lived somewhere different on every screen and the user had to
//     re-read the whole row every time. A frozen array cannot regress into
//     that, whatever a future caller does with it.
//
//  2. A PILL WITH NO WIRED DESTINATION DOES NOT RENDER. Four of the kit's
//     fourteen universal pills -- Email, Policies, Department, Teams -- have no
//     PROJEXA screen at all. They used to render disabled with the words "not
//     part of PROJEXA", which is honest but is four permanent non-controls in a
//     list of twenty. Owner approval D-10 keeps the Platform group so that
//     "the same name still reaches the same destination"; a name with no
//     destination in this product reaches nothing, so dropping it takes nothing
//     away. Every pill that IS still listed goes somewhere real.
//
//  3. EVERY REMAINING PILL HAS A REAL DESTINATION, of one of three kinds, and
//     the kind is data rather than a special case buried in a click handler:
//       "route"  a shipped page (checked by module-catalogue.test.ts).
//       "rail"   the top rail's own project control -- this is why "Projects"
//                survives despite having no /projects page: it is not a dead
//                end, it is a pointer at the real control, and clicking it
//                moves keyboard focus there.
//       "input"  the composer's own box ("Other - type it", A-15).
//
//  4. KEY HINTS. One letter per pill, assigned deterministically from the
//     label, unique across the list. See KEY HINTS below for why the shortcut
//     itself is Alt+<letter> rather than the bare letter.

import { allModulesEntries, type AllModulesEntry } from "./card-catalogue";

/** Where a pill goes. There is no fourth kind, and no pill has none. */
export type PillDestination =
  /** A shipped page. */
  | "route"
  /** The top rail's project control. */
  | "rail"
  /** The composer's own textarea. */
  | "input";

export type PillEntry = AllModulesEntry & {
  destination: PillDestination;
  /**
   * A single uppercase letter, unique in this list. Null only if the list ever
   * outgrows the alphabet, which is asserted against in the test.
   */
  keyHint: string | null;
  /**
   * Supplementary words that do NOT disable the pill -- "pick one in the top
   * rail" tells the user what will happen, it does not refuse to happen.
   * `unavailable` (from AllModulesEntry) is the disabling one and is reserved
   * for the caller's own "you are here" case.
   */
  note?: string;
};

/**
 * KEY HINTS, AND WHY THE MODIFIER IS NOT OPTIONAL.
 *
 * A-12 asks for a key hint per pill "honoured while the input is focused". A
 * BARE letter cannot be that shortcut: the composer's whole purpose is a
 * textarea a person types sentences into, and a bare "P" that jumped to Permits
 * would make every word beginning with P unwritable. So the hint letter is
 * shown and the chord is Alt+<letter>, which produces no character in a
 * textarea on any platform this product runs on. The rendered hint says
 * "Alt+P" rather than "P" for the same reason the rest of this programme
 * removed silent controls: a label that omits the modifier is a shortcut that
 * appears not to work.
 */
export const SHORTCUT_MODIFIER = "Alt";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** "Projects" has no /projects page in PROJEXA; its control is the top rail. */
const RAIL_ENTRIES: Readonly<Record<string, string>> = {
  "platform.projects": "pick one in the top rail",
};

function destinationFor(entry: AllModulesEntry): PillDestination | null {
  if (entry.kind === "other") return "input";
  if (entry.moduleId) return "route";
  if (RAIL_ENTRIES[entry.id]) return "rail";
  return null;
}

/**
 * One letter per pill: the first letter of its label that nothing above it has
 * taken, else the first free letter of the alphabet. Deterministic, so the
 * hint on a pill is the same letter on every machine and in every session --
 * a shortcut that moved would be worse than none.
 */
function withKeyHints(entries: readonly Omit<PillEntry, "keyHint">[]): PillEntry[] {
  const used = new Set<string>();
  return entries.map((entry) => {
    const fromLabel = entry.label.toUpperCase().replace(/[^A-Z]/g, "").split("");
    const hint = fromLabel.find((l) => !used.has(l)) ?? ALPHABET.find((l) => !used.has(l)) ?? null;
    if (hint) used.add(hint);
    return { ...entry, keyHint: hint };
  });
}

function build(): readonly PillEntry[] {
  const wired: Omit<PillEntry, "keyHint">[] = [];
  for (const entry of allModulesEntries()) {
    const destination = destinationFor(entry);
    // A-11 / A-12: a pill with no wired destination does not render at all.
    if (!destination) continue;
    const note = RAIL_ENTRIES[entry.id];
    wired.push({
      ...entry,
      destination,
      // The disabling flag is the CALLER's ("you are here"); a pointer at the
      // rail is a note, not a refusal.
      unavailable: undefined,
      ...(note ? { note } : {}),
    });
  }
  return Object.freeze(withKeyHints(wired).map((e) => Object.freeze(e)));
}

/**
 * THE list. Built once, frozen, and handed out by identity -- see the header:
 * this is what makes "the expanded list never re-orders" a property of the
 * data rather than a promise about every future caller.
 */
export const PILL_CATALOGUE: readonly PillEntry[] = build();

/** Always the same array, in the same order. Never a copy, never re-sorted. */
export function pillCatalogue(): readonly PillEntry[] {
  return PILL_CATALOGUE;
}

export function pillEntryById(id: string): PillEntry | null {
  return PILL_CATALOGUE.find((e) => e.id === id) ?? null;
}

/** The words rendered on the pill and read out as its shortcut. */
export function shortcutLabel(entry: Pick<PillEntry, "keyHint">): string | null {
  return entry.keyHint ? `${SHORTCUT_MODIFIER}+${entry.keyHint}` : null;
}

/**
 * The pill a keystroke means, or null. Pure so the chord rule -- Alt, and
 * neither Ctrl nor Meta -- is asserted rather than only observed.
 */
export function matchPillShortcut(
  event: { key: string; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
  entries: readonly PillEntry[] = PILL_CATALOGUE
): PillEntry | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = (event.key ?? "").toUpperCase();
  if (key.length !== 1 || !ALPHABET.includes(key)) return null;
  return entries.find((e) => e.keyHint === key) ?? null;
}
