"use client";

// GUIDED ERROR RECOVERY -- the one panel every failure is shown in. It never just says "error":
//   what happened (complete), why, the numbered steps to take, a "Fix it now" button that goes to the EXACT place it can be corrected (and leaves a
//   way back), "Try again" when trying again is honest, and "Copy details" for the complete plain-text report.
// It is an inline panel (role="alert"), never a popup. Docs: docs/ERROR_GUIDE.md. Contract: src/lib/error-guide/types.ts.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/local-first/client-error-report";
import { matchGuide, resolveGuide } from "@/lib/error-guide/match";
import { buildGuideReport } from "@/lib/error-guide/report";
import { highlightElement, findFocusTarget } from "@/lib/error-guide/focus";
import { hereOf, pathOf } from "@/lib/error-guide/urls";
import { newTrailId, pushReturn, withReturnTo } from "@/lib/error-guide/return-trail";
import { contextFromFailure, type FailureFacts } from "@/lib/error-guide/context";
import type { Guide, GuideContext } from "@/lib/error-guide/types";

export type GuidedErrorProps = {
  ctx: GuideContext;
  /** Use this guide instead of looking one up. */
  guide?: Guide;
  /** Shown as "Try again" when the guide allows it. */
  onRetry?: () => void;
  /** Overrides whether "Try again" is honest for THIS failure (the screen knows: a refused save can be re-sent, an unconfirmed one must not). */
  retryable?: boolean;
  /** The screen's own complete sentence for this failure; it replaces the guide's one-line "what happened" (the rest of the guide stays). */
  message?: string;
  /** The draft key of the form on screen, remembered so the way back finds what was typed. */
  draftKey?: string;
  className?: string;
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const TONE = {
  block: "border-px-error-border bg-px-error-light text-px-error",
  warn: "border-px-warning-border bg-px-warning-light text-px-warning",
  info: "border-px-info-border bg-px-info-light text-px-info",
} as const;

export function GuidedError({ ctx, guide, onRetry, retryable, message, draftKey, className }: GuidedErrorProps) {
  const router = useRouter();
  const resolved = useMemo(() => resolveGuide(guide ?? matchGuide(ctx), ctx), [guide, ctx]);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  const trailId = useMemo(() => newTrailId(), [resolved.guide.id, ctx.serverMessage, ctx.status]);
  const here = hereOf(ctx);

  // The occurrence goes to the device log (the full report, with the steps before it), once per distinct failure shown.
  const reportKey = `${resolved.guide.id}|${ctx.status ?? ""}|${ctx.code ?? ""}|${ctx.serverMessage ?? ""}`;
  useEffect(() => {
    reportClientError("guided-error", new Error(`${resolved.guide.id}: ${resolved.title}${ctx.serverMessage ? ` -- ${ctx.serverMessage}` : ""}`), ctx.route);
  }, [reportKey]);

  // The panel is what the person must see first: bring it into view when it appears (a long form hides the top).
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-testid="guided-error"]')?.scrollIntoView?.({ block: "nearest" });
  }, [reportKey]);

  const fix = resolved.fix;
  // The sign-in page brings the person back by itself (?redirectTo=), so only other destinations carry the return marker.
  const needsTrail = !!fix && pathOf(fix.href) !== pathOf(here) && pathOf(fix.href) !== "/login";
  const fixHref = fix ? (needsTrail ? withReturnTo(fix.href, trailId) : fix.href) : null;

  function goFix(e: React.MouseEvent) {
    if (!fix || !fixHref) return;
    e.preventDefault();
    const samePlace = pathOf(fix.href) === pathOf(here);
    if (samePlace) {
      // The place to correct is on THIS screen: nothing to leave, so show it.
      const el = fix.focus ? findFocusTarget(fix.focus) : null;
      if (el) highlightElement(el);
      return;
    }
    if (needsTrail) {
      pushReturn({ id: trailId, returnUrl: here, label: resolved.returnLabel.startsWith("Back to ") ? resolved.returnLabel.slice(8) : resolved.returnLabel, destination: fix.href, draftKey });
    }
    router.push(fixHref);
  }

  async function copy() {
    setCopied((await copyText(buildGuideReport(resolved, ctx))) ? "yes" : "no");
  }

  const Icon = resolved.severity === "info" ? Info : AlertTriangle;
  return (
    <div
      role="alert"
      data-testid="guided-error"
      data-guide-id={resolved.guide.id}
      className={`rounded-lg border p-4 text-sm ${TONE[resolved.severity]} ${className ?? ""}`}
    >
      <p className="flex items-start gap-2 font-medium">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span data-testid="guided-error-title">{resolved.title}</span>
      </p>
      <div className="mt-2 space-y-2 text-px-ink">
        <p data-testid="guided-error-what">{message?.trim() || resolved.what}</p>
        <p data-testid="guided-error-why" className="text-px-muted">{resolved.why}</p>
        <div>
          <p className="font-medium">What to do</p>
          <ol data-testid="guided-error-steps" className="mt-1 list-decimal space-y-0.5 pl-5">
            {resolved.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        {fix && <p data-testid="guided-error-where" className="text-px-muted">Where: {fix.where}</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {fix && fixHref && (
          <Button asChild size="sm">
            <a href={fixHref} onClick={goFix} data-testid="guided-error-fix">
              {fix.label}
            </a>
          </Button>
        )}
        {(retryable ?? resolved.retry) && onRetry && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} data-testid="guided-error-retry">
            <RotateCcw className="mr-2 size-4" aria-hidden />
            Try again
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={copy} data-testid="guided-error-copy">
          {copied === "yes" ? "Copied" : "Copy details"}
        </Button>
        {copied === "no" && <span className="text-px-muted">Could not copy. Select the text above instead.</span>}
      </div>
    </div>
  );
}

export default GuidedError;

/** The panel for a failure produced by useSubmit (src/lib/use-submit.ts): the hook's own complete sentence, plus the guide for the facts it carries. */
export function GuidedSubmitFailure({ failure, onRetry, draftKey }: { failure: (FailureFacts & { retryable: boolean }) | null; onRetry?: () => void; draftKey?: string }) {
  if (!failure) return null;
  return <GuidedError ctx={contextFromFailure(failure)} message={failure.message} retryable={failure.retryable} onRetry={onRetry} draftKey={draftKey} />;
}
