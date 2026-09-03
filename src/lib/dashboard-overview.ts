import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string; progressPercent?: number | null }[] };

/**
 * R67 D-03 (R-002 / R-019) x F-01 (R-006/R-011), reconciled by the integration
 * train. Two lanes changed the same function for two different reasons and
 * BOTH answers are kept.
 *
 * F-01 -- ONE CALL, NOT N. This used to fetch the org dashboard and then call
 * GET /dashboard/{id} once PER PROJECT, in a Promise.all, purely to read each
 * project's progressPercent. Every one of those ran getProjectDashboard()
 * -- budget, revenue, expenses, tasks, photos, earned value -- and opened its
 * own transaction on tenant-scoped.ts's FIVE-connection app_runtime pool, so an
 * org with more than a handful of active projects asked for more simultaneous
 * connections than the pool has and the excess queued: the exact exhaustion the
 * R66 audit reproduced live (all five sessions "idle in transaction" for 25
 * minutes). getOrgDashboard() now carries progressPercent per project, computed
 * by one grouped query inside the transaction it already holds.
 *
 * D-03 -- NULL IS NOT ZERO. The per-project catch used to return
 * `progressPercent: 0`, so the portfolio screen printed "0%" and an empty bar
 * for a project that is 80 % complete, with nothing indicating a failure. That
 * fan-out is gone with F-01, but the rule it established is KEPT and still
 * load-bearing: a project whose row carries no numeric progressPercent reports
 * null, never a fabricated 0. "We have no figure for this project" and "this
 * project has made no progress" are different facts and must not render the
 * same. The project still appears -- it exists and is named -- only its number
 * is missing.
 */
export type ProgressBar = { id: string; name: string; progressPercent: number | null };

// R46 P8 seq124: factored out of dashboard/overview/page.tsx verbatim so the
// route file can stay thin per the M28 registry-model convention. Real
// percentComplete per project, sourced the same way the /dashboard/hierarchy
// drill-down Details view's Progress figure is ("latest logged entry per
// activity, averaged").
export async function fetchProjectProgressBars(organizationId: string | null): Promise<{ bars: ProgressBar[]; errorMessage: string | null }> {
  try {
    const orgDashboard = await callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined });
    const bars = (orgDashboard.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      // `?? 0` here would reintroduce exactly the fabricated zero D-03 removed.
      progressPercent: typeof p.progressPercent === "number" && Number.isFinite(p.progressPercent)
        ? p.progressPercent
        : null,
    }));
    return { bars, errorMessage: null };
  } catch (err) {
    return { bars: [], errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load project progress" };
  }
}
