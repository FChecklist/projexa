import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export type SelectableProject = { id: string; name: string };

export type ProjectSelection = {
  project: SelectableProject | null;
  projects: SelectableProject[];
  errorMessage: string | null;
  // R67 (audit R-084/R-097): TRUE when nothing asked for this project -- no
  // ?projectId= in the URL and no rail selection -- and it is simply the org's
  // first project. Every screen used to take projects[0] silently, so a
  // capture could show "All projects" in the top rail while the rows on
  // screen, and every data call behind them, belonged to exactly one project.
  // Additive: callers that ignore this field behave exactly as before.
  resolvedByFallback: boolean;
};

// Shared by every project-scoped page (RFIs, Scope, Labour, Schedule, ...)
// so they don't each re-implement the same "/dashboard" fetch + fallback.
//
// `requestedProjectId` is normally the `?projectId=` search param set by
// the ProjectSwitcher in AppSidebar. When it's absent (a bookmarked/shared
// URL from before the switcher existed, or the user just hasn't picked
// anything yet) this falls back to the org's first project -- the exact
// behavior every one of these pages had before the switcher was added, so
// old URLs keep working unchanged.
//
// `organizationId` (Priority 17 platform provisioning) scopes the VERIDIAN
// call to the caller's own org -- see getServerOrganizationId() in
// src/lib/supabase/auth-guard.ts, which every page.tsx caller uses to
// obtain it. Optional/nullable so a page that somehow calls this before
// resolving auth still gets the same demo-key fallback callVeridian() has
// always had, rather than a hard failure.
export async function resolveSelectedProject(
  requestedProjectId?: string,
  organizationId?: string | null
): Promise<ProjectSelection> {
  try {
    const data = await callVeridian<{ projects: SelectableProject[] }>("/dashboard", {
      organizationId: organizationId ?? undefined,
    });
    const projects = data.projects ?? [];
    const requested = requestedProjectId ? projects.find((p) => p.id === requestedProjectId) ?? null : null;
    const project = requested ?? projects[0] ?? null;
    return {
      project,
      projects,
      errorMessage: null,
      // A single-project org is not "a fallback the user should be warned
      // about" -- there is nothing else it could be showing.
      resolvedByFallback: requested === null && project !== null && projects.length > 1,
    };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      resolvedByFallback: false,
    };
  }
}
