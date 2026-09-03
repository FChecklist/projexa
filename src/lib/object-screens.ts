// R67 WS-A (A-21) -- ON AN OBJECT PAGE THE STRIP NAMES THE RECORD.
//
// THE DEFECT. Standing on /scope/<id> -- one BOQ, its line items on screen, its
// title in the page heading -- the composer's strip said "<project> › Scope of
// Work". That is true of the list page, of the create page and of every other
// BOQ in the org; it is not a sentence about the thing the user is looking at.
// Worse, until A-13 the project itself came from the top rail, so a bookmarked
// BOQ could be described under a DIFFERENT project's name than the one whose
// line items were rendered underneath.
//
// THE FIX IS TWO FIXED SEGMENTS: "<project> › BOQ R66 Audit BOQ 1009b". Both
// are `kind: "root"`, which is not decoration -- the kit's firstCuttableIndex()
// takes the LAST root as the floor, so a root segment gets no Remove control and
// cutChainFrom() can never reach behind it. The user is standing in this record;
// there is nothing to remove.
//
// WHY THE OBJECT SEGMENT REPLACES THE MODULE SEGMENT RATHER THAN FOLLOWING IT.
// "<project> › Scope of Work › BOQ 1009b" names the module twice: "BOQ" IS the
// word this product uses for a Scope of Work record, and A-21's own acceptance
// is that the strip text starts with "<project> › BOQ " -- two fixed segments,
// not three. A-06's rule (the strip names the module you are standing in) is
// unchanged everywhere else; an object page is simply more specific about it.
//
// WHERE THE THREE FACTS COME FROM. The object clients fetch their record in the
// BROWSER -- /scope/<id> and /moms/<id> resolve nothing server-side -- so the
// page is the only thing that knows the record's label and which project it
// belongs to, and it publishes both through the shell screen context. The KIND
// WORD is not published per page: it lives in this one table, so "Worker" is
// the same word on every screen that shows one, and the four words A-21's
// acceptance names are assertable in one place instead of seven.

import { MODULE_CATALOGUE, moduleRoute } from "./module-catalogue";

/**
 * The word the strip leads an object segment with, per module.
 *
 * It is the word the USER's own screen already uses -- ScopeObjectClient's
 * breadcrumb reads "Scope / Bill of Quantities" and the product calls the thing
 * a BOQ; RosterObjectClient's reads "Labour / Worker". A module with no entry
 * here has no object segment: its object pages keep A-06's module segment,
 * which is correct rather than missing.
 */
export const OBJECT_KIND_BY_MODULE: Readonly<Record<string, string>> = {
  scope: "BOQ",
  moms: "Meeting",
  labour: "Worker",
  materials: "Material",
  permits: "Permit",
  drawings: "Drawing",
  schedule: "Task",
};

/** What an object page publishes about the record it is showing. */
export type ShellObjectRecord = {
  /** The module the record belongs to, e.g. "scope". */
  moduleId: string;
  /** The record's own label -- the BOQ's title, the worker's name. */
  label: string;
  /**
   * The project the record belongs to, from the record itself. Null for a
   * genuinely org-level record (a meeting filed against no project), which is a
   * real state and not a missing value.
   */
  projectId: string | null;
  /**
   * An explicit kind word, for an object page whose records are not the
   * module's own headline record. Absent means the table above decides.
   */
  kind?: string;
};

/** The word this module's records are called, or null if it has none. */
export function objectKindFor(record: Pick<ShellObjectRecord, "moduleId" | "kind">): string | null {
  const explicit = record.kind?.trim();
  if (explicit) return explicit;
  return OBJECT_KIND_BY_MODULE[record.moduleId] ?? null;
}

/**
 * THE SECOND FIXED SEGMENT: "BOQ R66 Audit BOQ 1009b".
 *
 * Null when the page has published nothing yet (the record is still loading),
 * when the module has no kind word, or when the record has no label -- in every
 * one of those the strip must fall back to A-06's module segment rather than
 * render the kind word on its own, because "<project> › BOQ" with no record
 * names a screen that does not exist.
 */
export function objectSegmentFor(record: ShellObjectRecord | null): { id: string; label: string } | null {
  if (!record) return null;
  const kind = objectKindFor(record);
  const label = record.label.trim();
  if (!kind || !label) return null;
  return { id: `object:${record.moduleId}`, label: `${kind} ${label}` };
}

/**
 * How the composer's next question refers to the record: "Pick an action above
 * or type what you need on this BOQ".
 *
 * The alternative was to leave the module's own label there, which would have
 * put two names for one thing on one screen -- the strip saying "BOQ Villa
 * Tower" and the prompt saying "Scope of Work" -- which is precisely the
 * duplicate vocabulary this programme is removing. The RECORD's label is
 * deliberately not repeated: it is already on screen twice (the strip and the
 * page heading), and a third copy inside a sentence would make the sentence
 * unreadable on a phone.
 */
export function objectPromptLabel(record: ShellObjectRecord | null): string | null {
  const kind = record ? objectKindFor(record) : null;
  return kind ? `this ${kind}` : null;
}

/**
 * R67 A-21 -- WHERE THE TOP RAIL'S PROJECT SWITCH GOES ON AN OBJECT PAGE.
 *
 * THE PROBLEM THIS ITEM CREATES AND MUST THEREFORE CLOSE. Once the record's own
 * project outranks the rail's remembered choice, the rail's switch can no longer
 * change what the strip says here -- and it must not: you cannot move a BOQ to
 * another project by clicking the top rail, and a control that appeared to do so
 * would be the mis-attribution this whole item exists to prevent. But leaving the
 * switch to write a preference nothing on screen reads is a control that does
 * nothing, which M24 forbids just as plainly.
 *
 * So on an object page the switch means what a person means by it: "show me this
 * module in that project" -- the same destination the page's own Back control
 * produces, with the newly chosen project. The record they left is one Back away.
 *
 * Null when the module has no route to go to, which the caller reads as "fall
 * back to the ordinary behaviour" rather than as an error.
 */
export function railDestinationForObject(
  record: ShellObjectRecord | null,
  nextProjectId: string | null
): string | null {
  if (!record) return null;
  const mod = MODULE_CATALOGUE.find((m) => m.id === record.moduleId);
  return mod ? moduleRoute(mod, nextProjectId) : null;
}

/** Every module id this table names (used by its test). */
export function objectKindModuleIds(): string[] {
  return Object.keys(OBJECT_KIND_BY_MODULE).sort();
}

/** The module ids the catalogue actually ships (used by its test). */
export function catalogueModuleIds(): string[] {
  return MODULE_CATALOGUE.map((m) => m.id).sort();
}
