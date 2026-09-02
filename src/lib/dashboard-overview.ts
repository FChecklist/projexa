import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string; progressPercent?: number }[] };
export type ProgressBar = { id: string; name: string; progressPercent: number };

// R46 P8 seq124: factored out of dashboard/overview/page.tsx verbatim so the
// route file can stay thin per the M28 registry-model convention. Real
// percentComplete per project, sourced the same way the /dashboard/hierarchy
// drill-down Details view's Progress figure is ("latest logged entry per
// activity, averaged").
//
// R67 F-01 (R-006/R-011) -- WHAT CHANGED AND WHY IT MATTERED. This used to
// fetch the org dashboard and then call GET /dashboard/{id} once PER PROJECT,
// in a Promise.all, to read each project's progressPercent. Every one of those
// calls ran getProjectDashboard() -- budget, revenue, expenses, tasks, photos,
// earned value -- and opened its own transaction on tenant-scoped.ts's
// FIVE-connection app_runtime pool. An org with more than a handful of active
// projects therefore asked for more simultaneous connections than the pool
// has, and the excess queued: the exact five-connection exhaustion pattern the
// R66 audit reproduced live (all five sessions "idle in transaction" for 25
// minutes). It is now ONE call: getOrgDashboard() carries progressPercent per
// project, computed by one grouped query inside the transaction it already
// holds.
//
// The per-project try/catch that used to degrade a failed detail call to 0 is
// gone with the calls themselves. A project the backend reports no progress
// for is 0 because zero is the truth ("nothing logged yet"), not because a
// request failed -- and if the ONE call fails, errorMessage says so instead of
// a screen full of confident zeroes.
export async function fetchProjectProgressBars(organizationId: string | null): Promise<{ bars: ProgressBar[]; errorMessage: string | null }> {
  try {
    const orgDashboard = await callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined });
    const bars = (orgDashboard.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      progressPercent: p.progressPercent ?? 0,
    }));
    return { bars, errorMessage: null };
  } catch (err) {
    return { bars: [], errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load project progress" };
  }
}
