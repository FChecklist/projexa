"use client";

// Forked from @fchecklist/veridian-ui-kit/src/screens/DashboardScreen.tsx per
// programme decision D-09 (no kit release in this programme; a kit behaviour
// change is forked into projexa, and everything not forked keeps importing
// the kit). The kit copy is UNCHANGED and still used everywhere else;
// editing node_modules is erased by CI's frozen-lockfile install.
//
// R42 seq24 (M28 DASHBOARD archetype)'s own layout comment is carried over
// verbatim below and is still true of this fork -- nothing about the
// F-pattern shape, the 2fr/3fr split, or the trend/breakdown/activity rows
// beneath it has changed.
//
// THE ONE DIFFERENCE, AND WHY (2026-09-07). The owner supplied the frozen
// project-dashboard mock this programme was built against ("Harbor View
// Corporate HQ") and compared it against the shipped page directly: the
// mock's top KPI row is ONE continuous bordered strip -- oneNumber and every
// secondary KPI share a single outer border, divided by thin lines, no gaps
// between cells. The kit's own layout gives each tile its own separate
// rounded/bordered box with a `gap-4`/`gap-3` void between them -- a real,
// visible difference the owner's screenshot caught, not a subjective nuance.
// Fixed by wrapping the whole row in one bordered container with
// `divide-x`/`divide-y` between cells instead of `gap`, and passing
// `bare` through to every tile (KpiCard.tsx / DashboardKpiTile.tsx) so each
// cell stops drawing its OWN border/rounding -- the strip draws the outline
// once, at its own edge, instead of once per tile. Everything else (the
// trend/breakdown charts below, the quick-actions/recent-activity row) is
// untouched -- the mock never depicted those differently from what already
// ships, so nothing there was reworked on a guess.
import { ScreenFrame, type HeaderActionState } from "@fchecklist/veridian-ui-kit/screens";
import type { ReactNode } from "react";

export type DashboardScreenProps = {
  breadcrumb: ReactNode;
  oneNumber: ReactNode; // the single most important KpiCard, size="primary"
  secondaryKpis: ReactNode; // 2-3 KpiCard size="secondary", laid out top-right
  trendColumn?: ReactNode; // left column -- LineChart over time
  breakdownColumn?: ReactNode; // right column -- BarChart by category
  linkList?: ReactNode; // bottom-left -- LinkListCard
  recentActivity?: ReactNode; // bottom-right -- recent entries table/list
  filterAction?: HeaderActionState;
  exportAction?: HeaderActionState;
  newAction?: HeaderActionState; // DASHBOARD.PROJECT's own row: "+ New suppressed" is a documented per-screen override, not an omission
};

export function DashboardScreen({
  breadcrumb,
  oneNumber,
  secondaryKpis,
  trendColumn,
  breakdownColumn,
  linkList,
  recentActivity,
  filterAction,
  exportAction,
  newAction,
}: DashboardScreenProps) {
  return (
    <ScreenFrame breadcrumb={breadcrumb} filterAction={filterAction} exportAction={exportAction} newAction={newAction} messages={[]}>
      <div className="p-4 space-y-4">
        {/* ONE connected strip: the outer border and the divider lines are
            drawn HERE, once -- every tile inside (passed `bare` by the
            caller) draws only its own padding and tint fill, matching the
            mock's single-bordered-row look instead of four separate boxes
            with gaps between them. */}
        <div className="grid grid-cols-1 divide-y divide-ct-border rounded-md border border-ct-border lg:grid-cols-[2fr_3fr] lg:divide-x lg:divide-y-0">
          <div>{oneNumber}</div>
          <div className="grid grid-cols-1 divide-y divide-ct-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">{secondaryKpis}</div>
        </div>
        {(trendColumn || breakdownColumn) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {trendColumn && <div className="rounded-md border border-ct-border p-3">{trendColumn}</div>}
            {breakdownColumn && <div className="rounded-md border border-ct-border p-3">{breakdownColumn}</div>}
          </div>
        )}
        {(linkList || recentActivity) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {linkList}
            {recentActivity}
          </div>
        )}
      </div>
    </ScreenFrame>
  );
}
