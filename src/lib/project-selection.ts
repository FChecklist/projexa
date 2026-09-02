import { cookies } from "next/headers";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import {
  PROJECT_PREFERENCE_KEY,
  pickProject,
  type ProjectSource,
} from "@/lib/project-preference";

export type SelectableProject = { id: string; name: string };

export type ProjectSelection = {
  project: SelectableProject | null;
  projects: SelectableProject[];
  errorMessage: string | null;
  /**
   * R67 A-04/A-05. HOW the project above was chosen: from the URL, from the
   * user's own last choice in the top rail, because it is their only project,
   * or automatically because nothing said which. Pages pass this to
   * <ScreenContext/> so the rail can admit to an automatic choice
   * ("<name> (auto-selected)") instead of presenting a guess as a decision the
   * user made. null when there is no project at all.
   */
  source: ProjectSource | null;
};

// Shared by every project-scoped page (RFIs, Scope, Labour, Schedule, ...)
// so they don't each re-implement the same "/dashboard" fetch + fallback.
//
// R67 A-05 -- THE RAIL AND THE PANE NOW AGREE, because they apply ONE rule.
//
// This used to end in `|| projects[0]`: with no ?projectId= the page silently
// rendered the org's first project while the shell's top rail, which kept its
// own separate state, said "All projects". Two answers to one question on one
// screen, and a reload threw the rail's away.
//
// The rule now lives in pickProject() (src/lib/project-preference.ts), which
// the browser shell applies too: the URL wins, then the user's own last rail
// choice -- read here from the veri.rail.project cookie the shell writes, so
// the SERVER agrees on the very first render before any client code has run --
// then their only project if they have exactly one, and only then does the page
// choose for them. That last case is kept deliberately: without it every
// multi-project org would land on "No active projects yet" on 50 pages. It is
// no longer silent, though -- it comes back as source: "auto" and the rail says
// so.
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
    const preferred = await readPreferredProjectId();
    const { project, source } = pickProject({ requested: requestedProjectId, preferred, projects });
    return { project, projects, errorMessage: null, source };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      source: null,
    };
  }
}

/**
 * The user's last top-rail choice, as the shell wrote it. A cookie rather than
 * only localStorage precisely so this server-side resolution can see it: a
 * preference the server cannot read would still leave the first render
 * disagreeing with the rail.
 *
 * Never fatal -- a request with no cookie store (or a cookie for a project the
 * user can no longer reach, which pickProject() then ignores) simply means no
 * preference.
 */
async function readPreferredProjectId(): Promise<string | null> {
  try {
    const store = await cookies();
    const raw = store.get(PROJECT_PREFERENCE_KEY)?.value;
    return raw && raw.trim() ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}
