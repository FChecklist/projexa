import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";

export type SelectableProject = { id: string; name: string };

export type ProjectSelection = {
  project: SelectableProject | null;
  projects: SelectableProject[];
  errorMessage: string | null;
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
    // R67 D-04: this one call gates ~50 module pages -- nothing renders until
    // it answers -- so it takes the screen budget (8 s) rather than the
    // client's 20 s write ceiling. A hung upstream now costs a module page
    // 8 s and an honest error, not 20 s of blank frame.
    const data = await callVeridian<{ projects: SelectableProject[] }>("/dashboard", {
      organizationId: organizationId ?? undefined,
      timeoutMs: VERIDIAN_SCREEN_BUDGET_MS,
    });
    const projects = data.projects ?? [];
    const project = (requestedProjectId && projects.find((p) => p.id === requestedProjectId)) || projects[0] || null;
    return { project, projects, errorMessage: null };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
    };
  }
}
