// R67 D-67 -- the create-screen archetype's rules, extracted so they are
// tests rather than four hand-written forms that drift.
//
// WHAT THE AUDIT FOUND (R-257). /labour/new does it right: a breadcrumb
// "← Back Labour / New Worker", labelled fields carrying "(optional)" and an
// example placeholder, and one primary reading "Save (Name, Daily Rate)".
// /scope/new -- the screen a quantity surveyor lives in -- had a teal Save
// ENABLED on an empty form and seven unlabelled inputs whose placeholders
// truncated to "Parent Item Coc". Permits counted its missing fields in a
// sentence beside a button that said "Create". Three conventions, one
// product.
//
// This file owns the two decisions a create screen has to make -- what is
// still missing, and what the user is told after a save -- and nothing about
// rendering, so both can be asserted without a DOM or a router.

import type { ReactNode } from "react";
import { saveLabel } from "@/lib/save-label";

/**
 * The kinds of input the archetype renders. Deliberately small.
 *
 * R67 G-05 (R-260) merge: "money" is a distinct kind from "number" because a
 * money box owes the reader the currency CODE inside the box, beside the
 * caret, for as long as they are typing -- a placeholder disappears on the
 * first keystroke, which is exactly when the unit matters most. The archetype
 * renders it through src/components/ui/money-input.tsx, so the thirteen create
 * screens cannot each decide differently.
 */
export type CreateFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "time"
  | "datetime-local"
  | "select"
  | "file";

export type CreateField = {
  /** The form key. Also the input's name and id. */
  name: string;
  /** What the user reads. This is the word that appears in "Save (…)". */
  label: string;
  kind: CreateFieldKind;
  required?: boolean;
  placeholder?: string;
  /**
   * A sentence under the field. Where a term needs explaining, explain it
   * here. A node rather than a string so a field whose options failed to load
   * can put a Retry alongside its own explanation, instead of the screen
   * growing a second error region for one control.
   */
  help?: ReactNode;
  options?: { value: string; label: string }[];
  /**
   * R67 D-34, added by the integration train. A text field whose value SHOULD
   * come from a shared vocabulary but must not be locked to one: the roster's
   * Trade is the case that forced it. Free text split every trade-wise total
   * three ways ("Mason", "mason", "Masonry"), and a plain select would refuse
   * a trade this org genuinely has and the seed list does not. A native
   * datalist offers the vocabulary as the user types and still accepts a new
   * word -- one mechanism, in the archetype, rather than a hand-built combo
   * box on one screen. Only meaningful for `kind: "text"`.
   */
  suggestions?: string[];
  /**
   * R67 G-04 (R-231) merge: a select whose options are still arriving renders
   * a disabled skeleton in the control's own shape rather than putting a word
   * like "Loading…" in the VALUE SLOT, where it reads as a chosen answer.
   */
  loading?: boolean;
  /** A control there is nothing to choose in yet. It still shows its placeholder. */
  disabled?: boolean;
  /** Stable hook for the browser-level specs that assert this control's states. */
  testId?: string;
  accept?: string;
  /** Full-width rather than half. */
  wide?: boolean;
  /**
   * A validator run when the field loses focus. Returns the message to show,
   * or null when the value is acceptable. Required-ness is NOT expressed here
   * -- an empty required field is named in the Save label, not shouted at the
   * user while they are still typing.
   */
  validate?: (value: string) => string | null;
};

export type CreateValues = Record<string, string>;
export type CreateFiles = Record<string, File | null | undefined>;

/**
 * The labels of the required fields that are still empty, in the order they
 * appear on the form. `extra` carries required things the field list does not
 * own -- /scope/new's "at least one complete line", for instance.
 */
export function missingCreateFields(
  fields: CreateField[],
  values: CreateValues,
  files: CreateFiles = {},
  extra: string[] = []
): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    if (field.kind === "file") {
      if (!files[field.name]) missing.push(field.label);
      continue;
    }
    if (!(values[field.name] ?? "").trim()) missing.push(field.label);
  }
  return [...missing, ...extra.filter(Boolean)];
}

/** The primary action's label, from the one convention. */
export function createSaveLabel(missing: string[]): string {
  return saveLabel("Save", missing);
}

/**
 * The receipt the object page shows after a create.
 *
 * R-257: "After Save, router.replace to /module/[id] in display mode with the
 * footer message 'Created {object} {id}' — never back to an empty form or a
 * list." The id shown is the one the user would recognise (a permit number, a
 * BOQ title), falling back to the record id only when there is nothing better.
 */
export function createdMessage(objectLabel: string, identifier: string | null | undefined): string {
  const id = (identifier ?? "").trim();
  return id ? `Created ${objectLabel.toLowerCase()} ${id}` : `Created ${objectLabel.toLowerCase()}`;
}

/**
 * The delete confirmation, naming the blast radius rather than asking "are
 * you sure". `extra` is what goes with the record -- "and its PDF".
 */
export function deleteConfirmation(
  objectLabel: string,
  identifier: string | null | undefined,
  extra?: string | null
): string {
  const id = (identifier ?? "").trim();
  const subject = id ? `${objectLabel.toLowerCase()} ${id}` : `this ${objectLabel.toLowerCase()}`;
  const tail = extra?.trim() ? ` ${extra.trim()}` : "";
  return `Delete ${subject}${tail}? This cannot be undone.`;
}
