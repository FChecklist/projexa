"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// R52 shared fix for F_008 (label/field association) and F_002/F_004 (silent
// submit failure), which are the same structural gap seen from two sides:
// dialog forms in this codebase were written as
//   <Label>Title</Label><Input value={...} onChange={...} />
// with no htmlFor/id pairing, no `required` marker, and no place to render a
// validation message -- so a screen reader could not associate the visible
// label with its field, and a failed client-side check had nowhere to go
// except a bare `return`.
//
// MEASURED on this tree before the fix: 51 `<Label>` elements with no htmlFor
// against 21 with one, and 51 `if (!x.trim()) return;` silent-no-op guards in
// src/components. The three surfaces with a recorded fault row are converted in
// this PR; the primitive exists so the rest convert without re-deciding any of
// this.
//
// WHY A RENDER PROP rather than React.cloneElement: the field props have to
// land on the real input element, and cloneElement would silently do nothing if
// a caller ever wrapped its control in a fragment or a div. A function child
// cannot be got wrong that way, and it types cleanly for Input, Textarea and
// Radix Select triggers alike.

export type FormFieldRenderProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
};

export function FormField({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  /**
   * A validation message to show under the field. Falsy renders nothing.
   * R67 D-18: widened from `string` to ReactNode so a caller can put a
   * warning glyph beside the sentence (the audit asked for glyph + text, not
   * colour alone) without a second, parallel error slot. Every existing
   * caller passes a plain string, which is still a ReactNode.
   */
  error?: React.ReactNode;
  /** Static helper text, always shown. Announced with the field. */
  hint?: React.ReactNode;
  className?: string;
  children: (props: FormFieldRenderProps) => React.ReactNode;
}) {
  const reactId = React.useId();
  const id = `field-${reactId}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <>
            {/* R67 D-50/D-51 quote these labels as "Category *", "Task *",
                "Hours *" -- with the space. The marker used to sit flush
                against the label, so the serialised text was "Category*" and
                the quoted string was never produced verbatim on any screen
                built from this primitive. The literal space is inside the
                JSX expression so JSX cannot strip it as whitespace between
                elements. */}
            {" "}
            {/* The asterisk is decorative -- aria-required on the control is
                what actually conveys this, so it is hidden from the a11y tree
                rather than read out as "asterisk". */}
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
        "aria-required": required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-px-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        // role="alert" so the message is announced when it appears after a
        // failed submit, which is the whole point of F_002: the user currently
        // gets nothing at all.
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The other half of the same fault: a submit handler that returns silently.
 *
 * `validate` returns a map of field key -> message for whatever is wrong.
 * An empty map means "go ahead". Callers keep the map in state and hand each
 * message to the matching FormField, so the user is told which field is wrong
 * instead of watching a button do nothing.
 */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}
