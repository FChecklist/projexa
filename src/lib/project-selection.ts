import { unstable_cache } from "next/cache";
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
export type ResolveProjectOptions = {
  /**
   * R67 F-06/F-07/F-09. When set, the PROJECT LIST read is memoised per org
   * for this many seconds (Next's Data Cache), so a run of navigations across
   * project-scoped pages costs one round trip rather than one per page.
   *
   * Only the LIST is cached. Which project is selected -- the ?projectId=
   * param, the px_project cookie, the first-project fallback -- is decided
   * outside the cache on every call, so switching project is still instant and
   * a cached list can never pin the wrong selection.
   *
   * Omitted by default: ~50 callers share this function and a page that has
   * just created a project must be able to see it immediately.
   */
  cacheSeconds?: number;
};

export function projectsCacheTag(organizationId: string | null): string {
  return `projects:${organizationId ?? "shared"}`;
}

// The read itself, optionally wrapped in Next's Data Cache. Split out so the
// caching decision is one place and the selection logic below is unaffected by
// it. A failure is deliberately NOT cached -- see screen-definitions.ts for the
// same reasoning: caching "this org has no projects" for a minute would turn
// one blip into a minute of "No active projects yet."
async function listProjects(organizationId: string | null, cacheSeconds?: number): Promise<SelectableProject[]> {
  const read = async (orgId: string | null) => {
    const data = await callVeridian<{ projects: SelectableProject[] }>("/projects", {
      organizationId: orgId ?? undefined,
    });
    return data.projects ?? [];
  };
  if (!cacheSeconds || cacheSeconds <= 0) return read(organizationId);
  // organizationId is both an explicit key part and the wrapped function's
  // argument, so the entry is org-scoped two independent ways -- callVeridian
  // attaches a PER-ORG bearer token and Next keys its fetch cache on URL only
  // (see createCachedVeridianGet's comment on that cross-tenant leak).
  const cached = unstable_cache(read, ["projects", organizationId ?? "shared"], {
    revalidate: cacheSeconds,
    tags: [projectsCacheTag(organizationId)],
  });
  return cached(organizationId);
}

export async function resolveSelectedProject(
  requestedProjectId?: string,
  organizationId?: string | null,
  options: ResolveProjectOptions = {}
): Promise<ProjectSelection> {
  const preferredId = requestedProjectId || (await readSelectedProjectCookie());
  try {
    const projects = await listProjects(organizationId ?? null, options.cacheSeconds);
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
