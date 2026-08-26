"use client";

// R52 Gate 2 (Flow) -- kills the fail-after-click pattern behind the three
// "dead create button" faults (A4S14_03 /floor-plans, A4S14_08 /inventory,
// A4S14_10 /invoices).
//
// WHAT THE REGISTER RECORDED: "the primary CTA is a dead no-op -- clicked
// twice, nothing happens, no dialog, no XHR, no console error."
//
// WHAT THE CODE ACTUALLY SAYS. The dialog TRIGGERS are ordinary Radix
// DialogTriggers and open fine. The control that genuinely does nothing is the
// SUBMIT button inside the dialog, because every one of these handlers opened
// with a silent guard:
//
//     async function createWarehouse() {
//       if (!whName.trim()) return;        // <- click lands, nothing happens,
//       ...                                //    no toast, no message, ever
//     }
//
// and the button was only ever `disabled={submitting}`. So a user who clicks
// Create before filling the required field gets exactly the recorded symptom:
// a click that produces no dialog change, no request, and no error. Same
// class, different control.
//
// THE RULE THIS ENFORCES, in one place rather than at ~10 dialog footers: a
// primary action is DISABLED while required fields are empty, and the count of
// what is missing is shown BESIDE it. The user learns what is wrong before
// spending a click, instead of after.
//
// The guard is not removed from the handlers -- it stays as the last line of
// defence. This makes the guard unreachable by clicking, which is the point.

import { Button } from "@/components/ui/button";

export default function PrimarySubmit({
  missing,
  submitting,
  submittingLabel,
  onClick,
  children,
}: {
  /** Labels of the required fields that are still empty. Empty array = ready. */
  missing: string[];
  submitting: boolean;
  /** Label while the request is in flight, e.g. "Creating…". */
  submittingLabel: string;
  onClick: () => void;
  /** The button's resting label, e.g. "Create". */
  children: React.ReactNode;
}) {
  const blocked = missing.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {blocked && (
        <span id="primary-submit-missing" className="text-xs text-px-muted">
          {missing.length} required {missing.length === 1 ? "field" : "fields"} left:{" "}
          {missing.join(", ")}
        </span>
      )}
      <Button
        onClick={onClick}
        disabled={blocked || submitting}
        aria-describedby={blocked ? "primary-submit-missing" : undefined}
      >
        {submitting ? submittingLabel : children}
      </Button>
    </div>
  );
}
