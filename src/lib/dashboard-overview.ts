import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type OrgDashboard = { projects: { id: string; name: string }[] };
type ProjectDashboard = { projectId: string; progressPercent: number };

/**
 * R67 D-03 (R-002 / R-019): `progressPercent` is `number | null`, and null is
 * not a synonym for zero.
 *
 * THE DEFECT. The per-project catch below used to `return { ..., progressPercent: 0 }`.
 * The outer catch was already handled correctly -- a failed ORG call produces
 * an errorMessage and ProjectsOverviewClient renders a Retry -- but a failed
 * PER-PROJECT call was silently converted into the number 0. The portfolio
 * screen then printed "0%" beside the project's name and drew a full-width
 * empty progress bar, so a project that is 80 % complete reported 0 % complete
 * to the owner, with nothing anywhere on the page indicating that anything had
 * failed. A false zero is worse than a visible error, because a figure reads
 * as an answer: "we have no figure for this project" and "this project has
 * made no progress" are different facts and must not render the same.
 *
 * Making the field nullable rather than dropping the row is deliberate: the
 * project EXISTS and is known by name (that came from the org call, which
 * succeeded), so it belongs on the list. Only its number is missing.
 */
export type ProgressBar = { id: string; name: string; progressPercent: number | null };

// R46 P8 seq124: factored out of dashboard/overview/page.tsx verbatim (no
// behavior change) so the route file can stay thin per the M28
// registry-model convention. Real percentComplete per project, sourced the
// same way the /dashboard/hierarchy drill-down Details view's Progress figure
// is (getProjectDashboard's "latest logged entry per activity, averaged").
export async function fetchProjectProgressBars(organizationId: string | null): Promise<{ bars: ProgressBar[]; errorMessage: string | null }> {
  try {
    const orgDashboard = await callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined });
    const bars = await Promise.all(
      orgDashboard.projects.map(async (p) => {
        try {
          const detail = await callVeridian<ProjectDashboard>(`/dashboard/${p.id}`, { organizationId: organizationId ?? undefined });
          // A response that carries no numeric progressPercent is also "no
          // figure" -- coercing undefined through `?? 0` would reintroduce
          // exactly the fabricated zero this function exists to remove.
          return {
            id: p.id,
            name: p.name,
            progressPercent: typeof detail?.progressPercent === "number" && Number.isFinite(detail.progressPercent)
              ? detail.progressPercent
              : null,
          };
        } catch {
          return { id: p.id, name: p.name, progressPercent: null };
        }
      })
    );
    return { bars, errorMessage: null };
  } catch (err) {
    return { bars: [], errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load project progress" };
  }
}
