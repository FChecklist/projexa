import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string }[] };
type ProjectDashboard = { projectId: string; progressPercent: number };
// R52 Gate 2: progressPercent is now NULLABLE. It used to be coerced to 0 when
// the per-project detail call failed (see the catch below), which rendered a
// full-width "0%" progress bar for a project whose progress the app had just
// failed to read. 0% and "unknown" are different answers, and on a progress bar
// the difference is the whole message.
export type ProgressBar = { id: string; name: string; progressPercent: number | null };

// R46 P8 seq124: factored out of dashboard/overview/page.tsx verbatim (no
// behavior change) so the route file can stay thin per the M28
// registry-model convention -- this function's own fetch/error-handling
// logic is completely unchanged from before this seq. Real percentComplete
// per project, sourced the same way the /dashboard/hierarchy drill-down
// Details view's Progress figure is (getProjectDashboard's "latest logged
// entry per activity, averaged").
export async function fetchProjectProgressBars(organizationId: string | null): Promise<{ bars: ProgressBar[]; errorMessage: string | null }> {
  try {
    const orgDashboard = await callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined });
    const bars = await Promise.all(
      orgDashboard.projects.map(async (p) => {
        try {
          const detail = await callVeridian<ProjectDashboard>(`/dashboard/${p.id}`, { organizationId: organizationId ?? undefined });
          return { id: p.id, name: p.name, progressPercent: detail.progressPercent };
        } catch {
          // Unknown, NOT zero. The row still renders -- the project exists and
          // dropping it would be its own lie -- but it says so.
          return { id: p.id, name: p.name, progressPercent: null };
        }
      })
    );
    return { bars, errorMessage: null };
  } catch (err) {
    return { bars: [], errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load project progress" };
  }
}
