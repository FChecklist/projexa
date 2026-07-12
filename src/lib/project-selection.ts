import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

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
export async function resolveSelectedProject(requestedProjectId?: string): Promise<ProjectSelection> {
  try {
    const data = await callVeridian<{ projects: SelectableProject[] }>("/dashboard");
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
