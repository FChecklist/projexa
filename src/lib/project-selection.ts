import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export type SelectableProject = { id: string; name: string; status?: string };

export type ProjectSelection = {
  project: SelectableProject | null;
  projects: SelectableProject[];
  errorMessage: string | null;
};

// R67 F-03 (R-041/R-046/R-052/R-057). The cookie the project rail writes when
// the user picks a project, read here so a navigation with no ?projectId= in
// the URL still lands on the project they were just looking at instead of
// silently falling back to projects[0].
export const SELECTED_PROJECT_COOKIE = "px_project";

// Shared by every project-scoped page (RFIs, Scope, Labour, Schedule, ...)
// so they don't each re-implement the same project fetch + fallback.
//
// R67 F-03 -- WHAT CHANGED AND WHY IT MATTERED. This used to resolve the
// project by calling VERIDIAN's GET /dashboard: getOrgDashboard(), the
// earned-value/BOQ/invoice aggregate, measured at 1.4-4.0 s. Fifty page.tsx
// files call this function, and every one of them awaited that aggregate
// BEFORE sending a single byte of HTML, purely to learn a project's id and
// name. That is why /documents measured TTFB 1951 ms and /moms 1983 ms while
// /budgets -- which does not do this -- painted at 580 ms.
//
// It now calls GET /projects, which compliance-tracker answers from one
// indexed read of `projects` inside one transaction, with its own 60 s
// per-org cache. This fixes all fifty callers, not the two pages the audit
// happened to measure.
//
// Resolution order for WHICH project: the explicitly requested id (the
// ?projectId= search param) wins; then the px_project cookie; then the org's
// first project, which is the behaviour every one of these pages had before
// the switcher existed, so old URLs keep working unchanged.
//
// `organizationId` (Priority 17 platform provisioning) scopes the call to the
// caller's own org -- see getServerOrganizationId() in
// src/lib/supabase/auth-guard.ts, which every page.tsx caller uses to obtain
// it. Optional/nullable so a page that somehow calls this before resolving
// auth still gets the same demo-key fallback callVeridian() has always had,
// rather than a hard failure.
export async function resolveSelectedProject(
  requestedProjectId?: string,
  organizationId?: string | null
): Promise<ProjectSelection> {
  const preferredId = requestedProjectId || (await readSelectedProjectCookie());
  try {
    const data = await callVeridian<{ projects: SelectableProject[] }>("/projects", {
      organizationId: organizationId ?? undefined,
    });
    const projects = data.projects ?? [];
    const project = (preferredId && projects.find((p) => p.id === preferredId)) || projects[0] || null;
    return { project, projects, errorMessage: null };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
    };
  }
}

// next/headers' cookies() only exists inside a request scope. This helper is
// reached from server components AND from unit tests that call
// resolveSelectedProject() directly, so a missing request scope must mean
// "no remembered project", never a thrown error -- and the import is dynamic
// so a caller that passes an explicit id never pays for it at all.
async function readSelectedProjectCookie(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(SELECTED_PROJECT_COOKIE)?.value || undefined;
  } catch {
    return undefined;
  }
}
