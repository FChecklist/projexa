"use client";

// R67 D-02, forked from @fchecklist/veridian-ui-kit/src/screens/parts/KpiCard.tsx
// per programme decision D-09 (no kit release in this programme; a kit
// behaviour change is forked into projexa, and everything not forked keeps
// importing the kit). The kit copy is UNCHANGED and still used everywhere
// else; editing node_modules is erased by CI's frozen-lockfile install.
//
// The one behavioural difference, and the whole reason for the fork: `trend`
// is OPTIONAL here. The kit makes it required on purpose -- DASHBOARD.GLOBAL's
// "every KPI shows three things or it does not ship" -- and that rule is right
// wherever a trend exists to show. It is wrong where the backend has no delta
// at all: PROJEXA's org dashboard returns totals with no 30-day comparison
// behind them, so the kit card forced every home KPI to emit an arrow and a
// status colour that were chosen by the caller rather than measured. A
// fabricated trend is worse than none -- so a card with no real delta now
// renders no arrow and no tone, and the caller cannot accidentally invent one.
//
// Everything else (layout, sizes, the primary/secondary split, the four
// tones that have a real --color-veri-status-* variable, "every KPI value is
// clickable") is carried over verbatim from the kit source.
import type { ReactNode } from "react";

// Deliberately NOT the full StatusTone union -- only these four have a real
// --color-veri-status-* CSS variable defined (globals.css);
// "running"/"waiting"/"neutral" have no matching variable and would silently
// render as an invalid custom property.
export type KpiTone = "context" | "needs-you" | "done" | "late";

export type KpiTrend = { direction: "up" | "down" | "flat"; label: string; tone: KpiTone };

export type KpiCardProps = {
  label: string;
  value: string;
  /** Omit (or pass null) when the backend has no real delta -- see the file header. */
  trend?: KpiTrend | null;
  baseline: string; // "target 5,000" / "prior period 620" / "3% behind plan"
  visual?: ReactNode; // a <Sparkline> or <BulletChart>
  size?: "primary" | "secondary"; // primary = the ONE number (2-3x larger), secondary = supporting KPI card
  onClick?: () => void;
};

const ARROW: Record<KpiTrend["direction"], string> = { up: "↑", down: "↓", flat: "→" };

export function KpiCard({ label, value, trend, baseline, visual, size = "secondary", onClick }: KpiCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`block w-full text-left rounded-md border border-ct-border p-3 ${onClick ? "cursor-pointer hover:border-ct-teal" : ""}`}
    >
      <div className="text-[12.5px] text-ct-muted">{label}</div>
      <div className={size === "primary" ? "font-heading text-4xl text-ct-navy mt-1" : "font-heading text-xl text-ct-navy mt-1"}>
        {value}
      </div>
      {trend && (
        <div className="flex items-center gap-1.5 mt-1 text-[12.5px]" style={{ color: `var(--color-veri-status-${trend.tone})` }}>
          <span aria-hidden>{ARROW[trend.direction]}</span>
          <span>{trend.label}</span>
        </div>
      )}
      {baseline && <div className="text-[11.5px] text-ct-muted mt-0.5">{baseline}</div>}
      {visual && <div className="mt-2">{visual}</div>}
    </Wrapper>
  );
}
