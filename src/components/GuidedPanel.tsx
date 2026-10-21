"use client";

// GUIDED ERROR RECOVERY, router-free edition. The same inline panel as GuidedError (what happened, why, numbered steps, the exact place to fix it,
// a way back) for the places that cannot rely on the Next app router: the on-laptop shell's own screens, the sign-in page's inline messages, the
// browser-capability notices. It never opens a popup. Differences from GuidedError, on purpose:
//   - the "fix" link is a plain <a> (never next/link, which prefetches pages from the server; never router.push), so it also works in the static on-laptop shell (which intercepts same-origin links);
//   - extra buttons are passed in (`actions`) because here an action is often "do it now" (send a new code, try again, go back), not a link;
//   - the title / what / why / steps may be overridden by the screen when only it knows the exact words ("Line budget was not saved").
// Everything else (the matcher, the guide contract, the report, the highlight) is the framework's. Docs: docs/ERROR_GUIDE.md.

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/local-first/client-error-report";
import { matchGuide, resolveGuide } from "@/lib/error-guide/match";
import { buildGuideReport } from "@/lib/error-guide/report";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import { hereOf, pathOf } from "@/lib/error-guide/urls";
import type { Guide, GuideContext } from "@/lib/error-guide/types";

export type PanelAction = {
  id: string;
  label: string;
  onClick: () => void;
  /** The main action is drawn solid, the rest outlined. */
  primary?: boolean;
  disabled?: boolean;
};

export type GuidedPanelProps = {
  ctx: GuideContext;
  /** Use this guide instead of looking one up by the context. */
  guide?: Guide;
  /** The screen's own words, when only it knows them exactly. Each replaces the guide's text of the same part. */
  title?: string;
  what?: string;
  why?: string;
  steps?: string[];
  /** The exact place the fix is: overrides the guide's `fix` (a screen that knows the exact record). */
  fix?: { label: string; href: string; where: string; focus?: string } | null;
  /** Buttons that DO something here (send a new code, try again). */
  actions?: PanelAction[];
  /** A progress line for something still happening ("copying: this page updates by itself"). */
  progress?: { label: string };
  /** Anything extra the screen wants to show inside the panel (the values that were typed, the list of waiting changes). */
  children?: React.ReactNode;
  /** Override the ARIA role: a screen STATE (not copied yet, not in the copy) is announced politely as "status", a fault as "alert". */
  role?: "status" | "alert";
  /** Do not write this occurrence to the device log (a screen state such as "not copied yet" is expected, not a fault). */
  quiet?: boolean;
  /** Hide "Copy details" (a calm informational note does not need it). */
  noCopy?: boolean;
  className?: string;
  testId?: string;
};

const TONE = {
  block: "border-px-error-border bg-px-error-light text-px-error",
  warn: "border-px-warning-border bg-px-warning-light text-px-warning",
  info: "border-px-info-border bg-px-info-light text-px-info",
} as const;

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
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

export function GuidedPanel(props: GuidedPanelProps) {
  const { ctx, guide, actions, progress, children, noCopy, className, testId, quiet } = props;
  const resolved = useMemo(() => resolveGuide(guide ?? matchGuide(ctx), ctx), [guide, ctx]);
  const title = props.title?.trim() || resolved.title;
  const what = props.what?.trim() || resolved.what;
  const why = props.why?.trim() || resolved.why;
  const steps = props.steps && props.steps.length ? props.steps : resolved.steps;
  const fix = props.fix === null ? null : (props.fix ?? resolved.fix);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  const here = hereOf(ctx);

  // One line in the device log per distinct failure shown (the full report, with the steps before it).
  const reportKey = `${resolved.guide.id}|${ctx.status ?? ""}|${ctx.code ?? ""}|${ctx.serverMessage ?? ""}`;
  useEffect(() => {
    if (resolved.severity === "info" || quiet) return; // a calm note is not a failure
    reportClientError("guided-error", new Error(`${resolved.guide.id}: ${title}${ctx.serverMessage ? ` -- ${ctx.serverMessage}` : ""}`), ctx.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  function goFix(e: MouseEvent) {
    if (!fix) return;
    if (pathOf(fix.href) === pathOf(here) || fix.href.startsWith("#")) {
      // The place to correct is on THIS screen: show it instead of leaving.
      e.preventDefault();
      const el = fix.focus ? findFocusTarget(fix.focus) : null;
      if (el) highlightElement(el);
    }
  }

  async function copy() {
    setCopied((await copyText(buildGuideReport({ ...resolved, title, what, why, steps }, ctx))) ? "yes" : "no");
  }

  const Icon = resolved.severity === "info" ? Info : AlertTriangle;
  return (
    <div
      role={props.role ?? (resolved.severity === "info" ? "status" : "alert")}
      data-testid={testId ?? "guided-error"}
      data-guide-id={resolved.guide.id}
      className={`rounded-lg border p-4 text-sm ${TONE[resolved.severity]} ${className ?? ""}`}
    >
      <p className="flex items-start gap-2 font-medium">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span data-testid="guided-error-title">{title}</span>
      </p>
      <div className="mt-2 space-y-2 text-px-ink">
        <p data-testid="guided-error-what">{what}</p>
        <p data-testid="guided-error-why" className="text-px-muted">{why}</p>
        {children}
        {progress ? (
          <div data-testid="guided-error-progress" aria-busy="true">
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10" role="progressbar" aria-label={progress.label}>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-px-info" />
            </div>
            <p className="mt-1 text-px-muted">{progress.label}</p>
          </div>
        ) : null}
        <div>
          <p className="font-medium">What to do</p>
          <ol data-testid="guided-error-steps" className="mt-1 list-decimal space-y-0.5 pl-5">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        {fix ? <p data-testid="guided-error-where" className="text-px-muted">Where: {fix.where}</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {fix ? (
          <Button asChild size="sm">
            <a href={fix.href} onClick={goFix} data-testid="guided-error-fix">
              {fix.label}
            </a>
          </Button>
        ) : null}
        {(actions ?? []).map((a) => (
          <Button key={a.id} type="button" size="sm" variant={a.primary ? "default" : "outline"} disabled={a.disabled} onClick={a.onClick} data-testid={`guided-error-action-${a.id}`}>
            {a.label}
          </Button>
        ))}
        {noCopy ? null : (
          <Button type="button" size="sm" variant="ghost" onClick={copy} data-testid="guided-error-copy">
            {copied === "yes" ? "Copied" : "Copy details"}
          </Button>
        )}
        {copied === "no" ? <span className="text-px-muted">Could not copy. Select the text above instead.</span> : null}
      </div>
    </div>
  );
}

export default GuidedPanel;
