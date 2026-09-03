"use client";

// R67 E-38 (R-270 / R-296), under programme decision D-09: a FORK of the kit's
// KpiCard into projexa, not an edit of node_modules (which CI erases) and not
// a kit release (which this programme does not do).
//
// WHY IT HAD TO BE FORKED, precisely. The kit's KpiCard offers `onClick` and
// nothing else, so a clickable tile is a <button> that calls router.push().
// R-270's finding is that these tiles must be real links: a <button> has no
// href, so it cannot be middle-clicked, opened in a new tab, copied, hovered
// to preview its destination, or crawled -- and, as R-270 recorded live, one
// tile's click resolved to a NEIGHBOUR's destination, which is a class of bug
// a real href simply cannot have. Wrapping the kit card in a <Link> is not an
// option either: with an onClick the kit renders a <button>, and a button
// inside an anchor is invalid and does not navigate reliably.
//
// WHAT THE FORK CHANGES, and nothing else:
//   * `href` renders the whole tile as ONE Next <Link>, with a "->" affordance
//     so the tile reads as somewhere to go rather than a decorated number;
//   * `onClick` (used only where the tile's job is to RETRY its own failed
//     read) renders a <button>, because retrying is not navigating;
//   * exactly one of the two, so a KPI with no destination cannot ship --
//     which the kit could only ask for in a comment.
// Layout, type scale, tone variables and the trend/baseline contract are the
// kit's own, kept deliberately close so the two do not drift.
import Link from "next/link";
import type { ReactNode } from "react";

/** The kit's own tone set -- only these four have a real --color-veri-status-* variable. */
export type KpiTone = "context" | "needs-you" | "done" | "late";
export type KpiTrend = { direction: "up" | "down" | "flat"; label: string; tone: KpiTone };

const ARROW: Record<KpiTrend["direction"], string> = { up: "↑", down: "↓", flat: "→" };

export type ProjectKpiTileProps = {
  label: string;
  value: string;
  trend: KpiTrend;
  /** "target 5,000" / "latest BOQ revision" / "next 30 days" -- required, as in the kit. */
  baseline: string;
  visual?: ReactNode;
  size?: "primary" | "secondary";
  /** Where this number's breakdown lives. Mutually exclusive with onClick. */
  href?: string;
  /** Only for a tile whose job is to retry its own failed read. Mutually exclusive with href. */
  onClick?: () => void;
};

const TILE_CLASS = "block w-full text-left rounded-md border border-ct-border p-3 hover:border-ct-teal";

function TileBody({ label, value, trend, baseline, visual, size = "secondary", showArrow }: ProjectKpiTileProps & { showArrow: boolean }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ct-muted">{label}</span>
        {/* The navigation affordance. aria-hidden because the element is
            already a link -- a screen reader announces that, and "right arrow"
            read aloud after every tile is noise. */}
        {showArrow && <span aria-hidden className="text-[12.5px] text-ct-muted">→</span>}
      </div>
      <div className={size === "primary" ? "font-heading text-4xl text-ct-navy mt-1" : "font-heading text-xl text-ct-navy mt-1"}>
        {value}
      </div>
      <div className="flex items-center gap-1.5 mt-1 text-[12.5px]" style={{ color: `var(--color-veri-status-${trend.tone})` }}>
        <span aria-hidden>{ARROW[trend.direction]}</span>
        <span>{trend.label}</span>
      </div>
      <div className="text-[11.5px] text-ct-muted mt-0.5">{baseline}</div>
      {visual && <div className="mt-2">{visual}</div>}
    </>
  );
}

export function ProjectKpiTile(props: ProjectKpiTileProps) {
  const { href, onClick } = props;

  if (href) {
    return (
      <Link href={href} className={TILE_CLASS}>
        <TileBody {...props} showArrow />
      </Link>
    );
  }

  // No href: this tile retries its own read rather than going anywhere, so a
  // button is the honest control and there is no navigation arrow to show.
  return (
    <button type="button" onClick={onClick} className={`${TILE_CLASS} cursor-pointer`}>
      <TileBody {...props} showArrow={false} />
    </button>
  );
}
