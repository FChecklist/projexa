"use client";

// GUIDED ERRORS (G2): (named FormFaultPanel; FaultPanel is the G1 panel for its own fault list) the panel for faults a form found ITSELF, before anything was sent (a percentage of 140, a date in the future, an e-mail with no @).
// The first fault gets the full guide (what happened, why, the numbered steps, "Fix it now" that scrolls to and outlines the exact field, and the
// way back); any others are listed underneath so the person sees everything wrong in one go. The same fault is also written beside its field by the
// form (FormField error), so the message is at the place AND at the top. Fault codes and their guides: src/lib/error-guide/g2-faults.ts, catalogue/*.ts.
import { GuidedError } from "@/components/GuidedError";
import { faultContext, type Fault } from "@/lib/error-guide/g2-faults";
import type { GuideContext } from "@/lib/error-guide/types";

export default function FormFaultPanel({ faults, draftKey, extra, className }: { faults: Fault[]; draftKey?: string; extra?: Partial<GuideContext>; className?: string }) {
  if (faults.length === 0) return null;
  const [first, ...rest] = faults;
  return (
    <div className={className} data-testid="fault-panel" data-fault-code={first.code}>
      <GuidedError ctx={faultContext(first, extra)} draftKey={draftKey} />
      {rest.length > 0 && (
        <div data-testid="fault-panel-more" className="mt-2 rounded-md border border-px-border px-3 py-2 text-[12.5px] text-px-ink">
          <p className="font-medium">{rest.length === 1 ? "One more thing to correct:" : `${rest.length} more things to correct:`}</p>
          <ul className="mt-1 list-disc pl-5">
            {rest.map((f) => (
              <li key={`${f.code}:${f.field}`} data-fault-code={f.code}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
