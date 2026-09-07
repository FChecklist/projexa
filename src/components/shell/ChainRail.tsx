"use client";

// NEW FILE, 2026-09-07 -- the right (ERP) pane's half of the composer's
// chain, per the owner's explicit direction at the end of the mockup review
// that also produced AppShell.tsx's composer-relocation fork: "Merge it into
// the right panel's top rail." (see AppShell.tsx's own ADDENDUM comment for
// the fuller context). This was the one piece of that review's final,
// frozen mock the first implementation pass never built.
//
// WHY A NEW FILE AND NOT A SECOND <ControlStrip>: ControlStrip.tsx always
// renders its own HOME and Reset buttons alongside the chain (R67 WS-A,
// A-18) -- correct on the left, where those controls belong, but rendering
// a second HOME/Reset in the right pane would be exactly the kind of
// duplicate control this codebase's own conventions (ControlStrip's header:
// "ONE INSTRUCTION, NOT TWO"; "THE 'HISTORY' BUTTON IS GONE... two controls
// named History... is a duplicate control") explicitly reject. This
// component renders ONLY the chain-with-Remove -- the one thing that was
// actually missing on the right -- reusing the exact same segment styling
// conventions as ControlStrip (root bold, later segments lighter, WORDS not
// glyphs on the control that removes a segment) so the two chains read as
// one system shown in two places, not two different visual languages.
//
// WHY IT RENDERS NOTHING MOST OF THE TIME: `chain.segments` always has at
// least the project root (M24Shell's own comment: "THE CHAIN. The root
// segment IS the project"). Every one of the ~90 pages under src/app/(app)
// already renders its own breadcrumb/PageHeading naming that same project --
// showing the bare root here too, on every page, every time, would print
// the project name twice for no benefit. This renders only when the user
// has actually built something past the root via the composer (an action
// and/or step segment) -- exactly the case the frozen mock demonstrated
// ("All modules / Work progress / By activity"), and exactly when a
// removable segment exists for this rail to be useful for at all.
//
// WHY cutChainFrom() AND NOT A SEPARATE "BACK": the kit's own chain.ts says
// so directly, in cutChainFrom's doc comment: "M24's replacement for a Back
// button, 'shown on the thing being removed'." Clicking Remove on an
// earlier segment already steps back past everything after it, in one
// click -- which is what a Back button would do one step at a time, so a
// second control here would be the same duplicate-control problem this
// codebase already reasons about explicitly elsewhere.
import { canCutAt, type Chain } from "@fchecklist/veridian-ui-kit/shell";
import { truncateSegmentLabel } from "@/lib/module-catalogue";

export type ChainRailProps = {
  chain: Chain;
  /** Same contract as ControlStrip's onCutFrom: MUST route through
   *  cutChainFrom(), which refuses to reach into the root. */
  onCutFrom: (index: number) => void;
};

export function ChainRail({ chain, onCutFrom }: ChainRailProps) {
  // The bare root (project only, nothing built past it yet) is the common
  // case on every page load and every HOME/Reset -- render nothing then, so
  // this never duplicates the page's own breadcrumb.
  if (chain.segments.length <= 1) return null;

  return (
    <nav
      aria-label="Current composer chain"
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5 text-[12px]"
      style={{ borderColor: "var(--color-ct-border)" }}
    >
      {chain.segments.map((seg, i) => {
        const cuttable = canCutAt(chain, i);
        const isLast = i === chain.segments.length - 1;
        return (
          <span key={seg.id} className="flex min-w-0 shrink-0 items-center gap-1">
            {i > 0 && (
              <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
                ›
              </span>
            )}
            <span
              className={seg.kind === "root" ? "whitespace-nowrap" : "whitespace-nowrap truncate max-w-[22ch]"}
              style={{
                color: "var(--color-ct-navy)",
                fontWeight: seg.kind === "root" ? 600 : isLast ? 700 : 400,
                opacity: seg.kind === "root" || isLast ? 1 : 0.72,
              }}
              title={seg.label}
            >
              {seg.kind === "root" ? seg.label : truncateSegmentLabel(seg.label, 22)}
            </span>
            {cuttable && (
              // R67 A-18: the word, not a glyph -- same rule ControlStrip
              // applies on the left, kept consistent here.
              <button
                type="button"
                onClick={() => onCutFrom(i)}
                aria-label={`Remove ${seg.label} and everything after it`}
                title={`Remove ${seg.label} and everything after it`}
                className="veri-view-tab"
                style={{ minWidth: 32, minHeight: 24, fontSize: "11px" }}
              >
                Remove
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default ChainRail;
