import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import {
  PROJECT_PREFERENCE_KEY,
  pickProject,
  pickRouteProject,
  type ProjectSource,
} from "@/lib/project-preference";

export type SelectableProject = { id: string; name: string; status?: string };

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

// R67 F-03 named its own px_project cookie for "the project the user was last
// looking at". R67 A-05 then shipped the real one -- PROJECT_PREFERENCE_KEY
// ("veri.rail.project"), which the top rail actually WRITES (see
// project-preference.ts). px_project had no writer, so it is gone rather than
// left as a second, always-empty answer to the same question.

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
  try {
    // F-03: the cheap GET /projects, never the /dashboard aggregate.
    const projects = await listProjects(organizationId ?? null, options.cacheSeconds);
    // A-05: and ONE selection rule, shared with the shell's own rail.
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

export type RouteProjectSelection = ProjectSelection & {
  /** Nothing in the URL (or the object) named a project. The screen asks. */
  missing: boolean;
  /** A project WAS named and this user cannot reach it. */
  unreachable: boolean;
};

/**
 * R67 A-13 -- THE PROJECT A SCREEN THAT BELONGS TO ONE PROJECT MUST USE.
 *
 * resolveSelectedProject() above ends by choosing for the user, and keeps doing
 * so for the ~50 pages that call it. On a project's own screen that is wrong:
 * /schedule with no ?projectId= silently rendered the org's FIRST project's
 * board under a heading naming that project, while the top rail could be saying
 * something else entirely -- and nothing on screen admitted that the choice had
 * been made for the user. The URL is the source of truth, so this resolves
 * STRICTLY from it (or from the object the page is about) and returns nothing
 * when it says nothing, letting the page ask instead of guess.
 *
 * `missing` and `unreachable` are separate because they are different
 * sentences: one asks for a decision, the other reports a fact.
 *
 * R67 F-03: reads the same cheap GET /projects listProjects() uses above --
 * this resolver was written against /dashboard, the aggregate F-03 exists to
 * get off the render path, and it is on the render path of every screen that
 * belongs to one project.
 */
export async function resolveRouteProject(
  searchParams: { projectId?: string | null } | undefined,
  objectProjectId?: string | null,
  organizationId?: string | null,
  options: ResolveProjectOptions = {}
): Promise<RouteProjectSelection> {
  try {
    const projects = await listProjects(organizationId ?? null, options.cacheSeconds);
    const picked = pickRouteProject({
      requested: searchParams?.projectId ?? null,
      objectProjectId: objectProjectId ?? null,
      projects,
    });
    return {
      project: picked.project,
      projects,
      errorMessage: null,
      source: picked.source,
      missing: picked.missing,
      unreachable: picked.unreachable,
    };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      source: null,
      // A failed read says nothing about the URL, and must not be reported as
      // "you did not pick a project" -- the error is the sentence to show.
      missing: false,
      unreachable: false,
    };
  }
}

/**
 * The user's last top-rail choice, as the shell wrote it. A cookie rather than
 * only localStorage precisely so this server-side resolution can see it: a
 * preference the server cannot read would still leave the first render
 * disagreeing with the rail.
 *
 * Never fatal -- a request with no cookie store (which is also how a unit test
 * calling these resolvers directly reaches this line), or a cookie naming a
 * project the user can no longer reach (pickProject() then ignores it), simply
 * means no preference.
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
