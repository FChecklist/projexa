import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";

export type SelectableProject = { id: string; name: string };

// R67 D-20. "all" is a REAL, explicit state -- the user is looking at the
// whole org, and the screen is allowed to say so -- not the absence of a
// choice. Every screen that opts in must handle both.
export type ProjectSelectionMode = "project" | "all";

export type ProjectSelection = {
  project: SelectableProject | null;
  projects: SelectableProject[];
  errorMessage: string | null;
  /**
   * R67 D-20. "project" means a specific project is in scope (either the URL
   * asked for it, or the legacy first-project fallback below supplied one).
   * "all" means the org as a whole is in scope and `project` is null ON
   * PURPOSE -- the caller must query org-wide rather than pick one.
   */
  mode: ProjectSelectionMode;
  /**
   * R67 D-20. True when `project` is NOT the project the URL asked for -- it
   * is the org's first project, chosen by this function because nothing was
   * requested (or what was requested does not exist). Callers render
   * "(auto-selected)" beside the name so a user is never silently shown, and
   * never silently WRITES TO, a project they did not pick.
   */
  fellBack: boolean;
};

// R67 D-20. The opt-in the item requires: without it this function behaves
// exactly as it did before (first-project fallback), so the ~50 module pages
// that call it compile AND behave unchanged and adopt the honest mode in
// their own items. With it, "nothing was asked for" resolves to the org-wide
// mode instead of quietly picking a project for the user.
export type ResolveProjectOptions = {
  allProjectsWhenUnset?: boolean;
};

/**
 * R67 D-20 -- the whole decision, extracted from the fetch so it is unit
 * testable without a database or a network.
 *
 * THE DEFECT: this used to be one line --
 *   `(requestedProjectId && projects.find(...)) || projects[0] || null`
 * -- so a screen reached with no ?projectId= silently resolved to the org's
 * FIRST project while the top rail still said "All projects". Minutes typed
 * into a Villa 21 meeting could be saved, and then locked by Publish, under
 * Cedar Heights. The fallback is kept (old links must not break) but it is
 * no longer silent, and a caller can now refuse it outright.
 */
export function chooseProject(
  projects: SelectableProject[],
  requestedProjectId?: string,
  options?: ResolveProjectOptions
): { project: SelectableProject | null; mode: ProjectSelectionMode; fellBack: boolean } {
  const requested = requestedProjectId ? projects.find((p) => p.id === requestedProjectId) ?? null : null;
  if (requested) return { project: requested, mode: "project", fellBack: false };

  // Nothing usable was asked for. Either the URL carried no projectId at all,
  // or it carried one this org cannot see (a stale bookmark, a link pasted
  // from another org). Both are the same question -- "which project did you
  // mean?" -- and neither is an invitation to answer it on the user's behalf.
  if (options?.allProjectsWhenUnset) return { project: null, mode: "all", fellBack: false };

  const first = projects[0] ?? null;
  return { project: first, mode: "project", fellBack: first !== null };
}

// Shared by every project-scoped page (RFIs, Scope, Labour, Schedule, ...)
// so they don't each re-implement the same "/dashboard" fetch + fallback.
//
// `requestedProjectId` is normally the `?projectId=` search param set by
// the ProjectSwitcher in AppSidebar. When it's absent (a bookmarked/shared
// URL from before the switcher existed, or the user just hasn't picked
// anything yet) this falls back to the org's first project -- the exact
// behavior every one of these pages had before the switcher was added, so
// old URLs keep working unchanged. R67 D-20: that fallback is now REPORTED
// (`fellBack`) and can be declined (`options.allProjectsWhenUnset`).
//
// `organizationId` (Priority 17 platform provisioning) scopes the VERIDIAN
// call to the caller's own org -- see getServerOrganizationId() in
// src/lib/supabase/auth-guard.ts, which every page.tsx caller uses to
// obtain it. Optional/nullable so a page that somehow calls this before
// resolving auth still gets the same demo-key fallback callVeridian() has
// always had, rather than a hard failure.
export async function resolveSelectedProject(
  requestedProjectId?: string,
  organizationId?: string | null,
  options?: ResolveProjectOptions
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
    return { projects, errorMessage: null, ...chooseProject(projects, requestedProjectId, options) };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      // Nothing was resolved, so nothing was fallen back to. The mode follows
      // the caller's own contract so an opted-in screen never has to special-
      // case the error branch to know which shape it is holding.
      mode: options?.allProjectsWhenUnset ? "all" : "project",
      fellBack: false,
    };
  }
}
