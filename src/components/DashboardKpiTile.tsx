"use client";

// R67 F-27 (audit recommendation R-243) -- ONE KPI TILE, THREE HONEST STATES.
//
// WHAT THIS REPLACES. DashboardProjectClient held the ENTIRE per-project
// dashboard behind `if (loading || !dashboard) return <p>Loading…</p>` -- one
// Promise.all over five requests, plus a SIXTH fired serially after it, and
// the word "Loading…" alone on the screen for all of it. LCP was 5.3 s warm.
// Every tile waited on the slowest call even though each answers a different
// question from a different endpoint.
//
// Now each tile renders as soon as ITS OWN figure arrives, and says which of
// three states it is in:
//
//   pending -- a skeleton bar the size of the value. Never "0%", never "—":
//              a zero on a dashboard is a real figure and reads as one, which
//              is exactly the lie a placeholder must not tell.
//   ready   -- the kit's own KpiCard, unchanged, with its trend and baseline.
//   error   -- the backend's own sentence, in the same card frame, so the
//              layout does not jump and the user learns WHY rather than
//              staring at a number that never appears.
//
// The card takes `value: string`, so a skeleton cannot be passed through it.
// Rather than fork it again for a placeholder (D-09 -- forks are for behaviour,
// not for a grey rectangle), this wraps it: the pending and error states are
// rendered here in the SAME card frame, and the ready state is the card itself.
//
// R67 MERGE (lane D1's D-61). The ready state was the KIT's KpiCard. It is now
// the FORKED one (src/components/screens/KpiCard.tsx), which lane D1 moved
// DashboardProjectClient onto and which the home band already uses. Two reasons,
// both lane D1's: a KPI value must not be set in DM Serif Display (the fork sets
// numbers in Inter 600 with tabular figures, so two stacked cards' digits line
// up), and the home dashboard and the project dashboard must not be two
// different cards when they sit one click apart. Folding it in HERE rather than
// in each screen is what keeps F-27's three tile states and D-61's typography
// from being two competing card components on one page. The fork's props are the
// kit's, with `trend` relaxed to optional, so nothing else in this file changes.
import { KpiCard, type KpiCardProps } from "@/components/screens/KpiCard";

/** The same frame the kit's KpiCard draws, so a tile does not resize when its
 *  figure lands. */
const CARD_CLASS = "block w-full text-left rounded-md border border-ct-border p-3";

export type KpiTileState = "pending" | "ready" | "error";

export function DashboardKpiTile({
  state,
  error,
  size = "secondary",
  label,
  ...card
}: Omit<KpiCardProps, "value" | "trend" | "baseline"> & {
  state: KpiTileState;
  /** The backend's own words. Only read when state is "error". */
  error?: string | null;
  value?: string;
  trend?: KpiCardProps["trend"];
  baseline?: string;
}) {
  if (state === "ready" && card.value !== undefined && card.trend && card.baseline !== undefined) {
    return <KpiCard label={label} size={size} {...(card as Omit<KpiCardProps, "label" | "size">)} />;
  }

  return (
    <div className={CARD_CLASS} aria-busy={state === "pending"}>
      <div className="text-[12.5px] text-ct-muted">{label}</div>
      {state === "pending" ? (
        <>
          {/* The skeleton bar stands where the value will be, at the value's
              own size, so nothing moves when it arrives. */}
          <div
            className={`mt-1 animate-pulse rounded bg-ct-cloud ${size === "primary" ? "h-9 w-40" : "h-6 w-24"}`}
            role="presentation"
          />
          <div className="mt-1.5 h-3 w-28 animate-pulse rounded bg-ct-cloud" role="presentation" />
          <span className="sr-only">Loading {label}…</span>
        </>
      ) : (
        <>
          <div className="font-heading mt-1 text-[15px] text-ct-navy">Not available</div>
          <p role="alert" className="mt-1 text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>
            {error ?? `Couldn't load ${label}.`}
          </p>
        </>
      )}
    </div>
  );
}

export default DashboardKpiTile;
