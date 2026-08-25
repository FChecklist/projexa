import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string }[] };
type ProjectDashboard = { projectId: string; progressPercent: number };
export type ProgressBar = { id: string; name: string; progressPercent: number };

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
          return { id: p.id, name: p.name, progressPercent: 0 };
        }
      })
    );
    return { bars, errorMessage: null };
  } catch (err) {
    return { bars: [], errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load project progress" };
  }
}
