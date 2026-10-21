"use client";

// GUIDED ERRORS (G3): the panel for a failed edit / status change / delete / void (see useProblem in src/lib/guided-form.ts). Renders nothing when
// there is no problem. It is the same inline panel as everywhere (what happened, why, numbered steps, the exact place to fix it, the way back).
import { GuidedError } from "@/components/GuidedError";
import type { Problem } from "@/lib/guided-form";

export function ProblemPanel({ problem, draftKey, className }: { problem: Problem | null; draftKey?: string; className?: string }) {
  if (!problem) return null;
  return (
    <div className={className ?? "px-4 py-3"}>
      <GuidedError ctx={problem.ctx} message={problem.message} onRetry={problem.retry} draftKey={draftKey} />
    </div>
  );
}

export default ProblemPanel;
