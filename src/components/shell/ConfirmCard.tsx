"use client";

// R67 WS-C (C-03, extended by C-05) -- THE CARD BAND 2 SHOWS BEFORE ANYTHING
// IS WRITTEN.
//
// A PROJEXA component, never a kit one (D-09): the kit is an unpublished git
// dependency whose source is not on this machine, and this is PROJEXA's own
// product surface rather than a generic shell mechanism.
//
// THE RULE IT EXISTS TO ENFORCE: *** NOTHING IS WRITTEN UNTIL THE PRIMARY
// BUTTON IS PRESSED. *** The composer's Send produces a PREVIEW -- what the
// server read the sentence as -- and this card is where the user checks it.
// Every field is editable in place, so correcting a fuzzy match costs one
// click rather than retyping the sentence.
//
// AND THE ONE IT INHERITS: NO FAIL-AFTER-CLICK. When the card cannot be
// saved the button is disabled AND the reason is in its own label
// ("Save (pick a task)"), not in a tooltip and not discovered after a click.

import type { ReactNode } from "react";

export type ConfirmField = {
  id: string;
  /** The word beside the control: "Task", "Category", "Date", "Hours". */
  label: string;
  /** The control itself -- an input, a select, a chip row. */
  control: ReactNode;
  /** Optional plain-words note under the field ("matched from what you typed"). */
  note?: string;
};

export type ConfirmCardProps = {
  /** The sentence the card is confirming, as its heading. */
  title: string;
  fields: ConfirmField[];
  /** "Save", or "Save (pick a task)" while something is missing. */
  primaryLabel: string;
  /** Non-empty means the primary button is disabled AND says why. */
  primaryDisabledReason?: string;
  onPrimary: () => void;
  /** "Edit" -- back to the sentence, with nothing written. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** A third, quieter way out ("Start over"). */
  tertiaryLabel?: string;
  onTertiary?: () => void;
  busy?: boolean;
  /** The server's own refusal, when a save has already been attempted. */
  error?: string | null;
};

export function ConfirmCard({
  title,
  fields,
  primaryLabel,
  primaryDisabledReason,
  onPrimary,
  secondaryLabel,
  onSecondary,
  tertiaryLabel,
  onTertiary,
  busy = false,
  error,
}: ConfirmCardProps) {
  const blocked = Boolean(primaryDisabledReason) || busy;

  return (
    <section
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--color-ct-border2)", background: "var(--color-ct-cream)" }}
      aria-label={title}
    >
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--color-ct-navy)" }}>
        {title}
      </p>

      <div className="mt-2 flex flex-wrap gap-3">
        {fields.map((f) => (
          <label key={f.id} className="flex min-w-[9rem] flex-col gap-0.5">
            <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
              {f.label}
            </span>
            {f.control}
            {f.note && (
              <span className="text-[10.5px]" style={{ color: "var(--color-ct-muted)" }}>
                {f.note}
              </span>
            )}
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPrimary}
          disabled={blocked}
          // Navy on saffron, 5.55:1 -- the same fix R67 WS-G made to Send,
          // for the same reason: this is a primary action a person must be
          // able to read.
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          style={{ background: "var(--color-ct-saffron)", color: "var(--color-ct-navy)" }}
        >
          {busy ? "Saving…" : primaryLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button type="button" onClick={onSecondary} className="veri-view-tab" disabled={busy}>
            {secondaryLabel}
          </button>
        )}
        {tertiaryLabel && onTertiary && (
          <button type="button" onClick={onTertiary} className="veri-view-tab" disabled={busy}>
            {tertiaryLabel}
          </button>
        )}
      </div>
    </section>
  );
}
