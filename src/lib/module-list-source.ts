// R67 F-18 / decision D-04 option A -- where a module page gets its data.
//
// THE CHAIN THIS REPLACES. Every one of the eleven module page.tsx files ran
// three network round-trips IN SERIES before Next.js could send a single byte:
//
//     await getServerOrganizationId()          // Supabase session
//     await resolveSelectedProject(...)        // VERIDIAN /dashboard
//     await resolve<Module>ListColumns(...)    // VERIDIAN /screen-definitions
//
// and only then rendered a client component that went and fetched the actual
// rows. /budgets, which skips the chain entirely, paints at 616 ms; the module
// pages took 1.5-1.65 s to first byte and 6-8 s to a usable screen. The chain
// is pure overhead on the critical path: the project id is nearly always
// already in the URL (every "+ New" button, KPI tile and pill passes
// ?projectId=), and the screen-definitions row is slowly-changing reference
// data whose absence has a correct, instant answer -- the hardcoded columns in
// module-list-columns.ts, which were already the 404 path.
//
// So: the project id is read WITHOUT a network call (query string, then the
// projexa_project cookie); the columns are cached for an hour per org and fall
// back synchronously; and the rows are fetched by the SERVER inside a
// <Suspense> boundary and handed to the client component as props, so the
// frame streams first and the client makes no round trip of its own on first
// paint. The /dashboard hop survives only for the case it is actually needed
// for -- neither the URL nor the cookie names a project -- and it happens
// inside the boundary, after the frame is on screen.
//
// D-04 rejects the alternative (browser calls straight to VERIDIAN with a
// minted token) because it would expose the org API key or need a second
// proxy. Everything here is server-side; no key moves.

import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { PROJECT_COOKIE } from "@/lib/project-cookie";
import type { ProjectSource } from "@/lib/project-preference";
import { timeUpstream } from "@/lib/debug-latency";

// Written by the top rail when the user switches project (see
// src/lib/project-cookie.ts, which owns the name and the browser-side writer
// because a client component may never import this file -- next/headers).
export { PROJECT_COOKIE } from "@/lib/project-cookie";

/**
 * The project id, WITHOUT a network call: the `?projectId=` the navigation
 * already carried, else the cookie the rail wrote. `null` means neither knew,
 * and only then is the /dashboard hop worth paying for.
 */
export async function resolveProjectIdFast(requestedProjectId?: string): Promise<string | null> {
  const { projectId } = await resolveProjectIdFastWithSource(requestedProjectId);
  return projectId;
}

/**
 * The same fast resolution, saying WHERE the answer came from.
 *
 * The source matters because the two are not equally trustworthy. A
 * `?projectId=` was put there by this app's own navigation a moment ago. The
 * cookie can be thirty days old and can outlive the session that wrote it: a
 * sign-out followed by a different user signing in on the same browser, or one
 * user switching organisation, leaves an id that resolves to nothing for the
 * caller who now reads it -- and VERIDIAN answers that with zero rows and no
 * error, which a list screen renders as a calm "there are none". Every
 * sign-out path clears the cookie, but a cleared cookie is a promise and this
 * is the check.
 */
export async function resolveProjectIdFastWithSource(
  requestedProjectId?: string
): Promise<{ projectId: string | null; source: "url" | "cookie" | "none" }> {
  if (requestedProjectId) return { projectId: requestedProjectId, source: "url" };
  try {
    const jar = await cookies();
    const value = jar.get(PROJECT_COOKIE)?.value;
    return value && value.trim() ? { projectId: value, source: "cookie" } : { projectId: null, source: "none" };
  } catch {
    // cookies() throws outside a request scope; a missing cookie is simply
    // "we don't know yet", never an error the user should see.
    return { projectId: null, source: "none" };
  }
}

export type ResolvedModuleProject = {
  projectId: string | null;
  errorMessage: string | null;
  /**
   * R67 WS-A (A-04): HOW the project was chosen, in A-05's own vocabulary, so
   * the rail can admit to a choice it made for the user rather than presenting
   * a guess as a decision they took. F-18's fast path maps onto it directly:
   * the URL is "route", the remembered cookie is "preference", and anything
   * that fell through to resolveSelectedProject() carries whatever that
   * returned ("only" or "auto").
   */
  source: ProjectSource | null;
};

/**
 * Is this id one of the caller's OWN projects?
 *
 * Costs nothing on the hot path: cachedProjects() below is the same 60 s
 * per-org cache /schedule already reads for the project's name, so a page that
 * arrives with a valid cookie makes no extra round trip. A read that FAILS
 * returns true -- an unreachable project list is not evidence that the id is
 * wrong, and refusing a good cookie because a lookup blipped would send the
 * user through the /dashboard hop for nothing.
 */
async function cookieProjectStillBelongs(projectId: string, organizationId: string | null): Promise<boolean> {
  try {
    const data = await cachedProjects(organizationId ?? null);
    const projects = data.projects ?? [];
    if (projects.length === 0) return true; // nothing to check against
    return projects.some((p) => p.id === projectId);
  } catch {
    return true;
  }
}

/**
 * The project a module page is about.
 *
 * The fast path costs nothing. The /dashboard hop is only paid when neither
 * the URL nor the cookie knew -- or when the cookie names a project this
 * caller does not have, which is what a stale cross-session cookie looks like
 * -- and callers run this INSIDE their <Suspense> boundary so even that case
 * has the frame on screen first.
 */
export async function resolveProjectForModule(
  requestedProjectId: string | undefined,
  organizationId: string | null
): Promise<ResolvedModuleProject> {
  const { projectId: fast, source } = await resolveProjectIdFastWithSource(requestedProjectId);
  if (fast && source === "url") return { projectId: fast, errorMessage: null, source: "route" };
  if (fast && (await cookieProjectStillBelongs(fast, organizationId))) {
    return { projectId: fast, errorMessage: null, source: "preference" };
  }
  const { resolveSelectedProject } = await import("@/lib/project-selection");
  const {
    project,
    errorMessage,
    source: chosen,
  } = await resolveSelectedProject(undefined, organizationId);
  return { projectId: project?.id ?? null, errorMessage, source: project ? chosen : null };
}

// ---------------------------------------------------------------------------
// Screen definitions: cached an hour, per org, never fatal.
// ---------------------------------------------------------------------------
//
// SECURITY, same reasoning as createCachedVeridianGet() in veridian-client.ts:
// the same `path` returns a DIFFERENT org's data depending on the Bearer token,
// and Next's `fetch` cache keys on URL + method + body only, NEVER on headers.
// So this uses unstable_cache with the organization id as both an explicit key
// part and the wrapped function's own argument -- org-scoped two independent
// ways -- rather than putting `next: { revalidate }` on the shared fetch inside
// veridian-client, which would serve org A's columns to org B.
const cachedScreenDefinition = unstable_cache(
  (screen: string, organizationId: string | null) =>
    callVeridian<{ columns: ScreenColumn[] }>(`/screen-definitions/${screen}`, {
      organizationId: organizationId ?? undefined,
    }),
  ["veridian-screen-definition"],
  { revalidate: 3600, tags: ["screen-definitions"] }
);

/**
 * A screen's registry columns, or null to use the module's hardcoded fallback.
 * NEVER throws and never blocks the frame: a 404 is the normal state for a
 * screen with no seeded row, and any other failure is logged and answered the
 * same way, because the hardcoded columns are a correct answer.
 */
export async function getScreenColumns(
  screen: string,
  organizationId: string | null
): Promise<ScreenColumn[] | null> {
  try {
    const definition = await cachedScreenDefinition(screen, organizationId ?? null);
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected
    console.error(
      `[module-list-source] screen_definitions resolve failed for ${screen}, using the hardcoded columns:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// The project's NAME, for the screens that show it.
// ---------------------------------------------------------------------------
//
// The fast path gives an id, not a name, and /schedule prints the name as a
// subheading. Rather than putting the /dashboard hop back on the critical path
// for one string, the name is resolved from a 60 s per-org cache and rendered
// inside its own nested <Suspense>, so it fills in beside a frame that is
// already on screen.
const cachedProjects = unstable_cache(
  (organizationId: string | null) =>
    callVeridian<{ projects: { id: string; name: string }[] }>("/dashboard", {
      organizationId: organizationId ?? undefined,
    }),
  ["veridian-projects"],
  { revalidate: 60, tags: ["projects"] }
);

/** The project's display name, or null when it cannot be established. */
export async function getProjectName(projectId: string, organizationId: string | null): Promise<string | null> {
  try {
    const data = await cachedProjects(organizationId ?? null);
    return (data.projects ?? []).find((p) => p.id === projectId)?.name ?? null;
  } catch (err) {
    console.error("[module-list-source] project name lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Module lists: cached 30 s, per org + project, tagged so a write refreshes it.
// ---------------------------------------------------------------------------

/**
 * What a page hands its client component. `rows` is what VERIDIAN returned;
 * `errorMessage` is the backend's own words when it did not answer. Both are
 * present so the client can tell "there are none" from "we could not find
 * out" -- the empty-state-honesty rule in read-outcome.ts.
 */
export type ModuleListOutcome<T> = { rows: T[]; errorMessage: string | null };

// The tags a write path passes to revalidateTag() so a create shows up
// immediately instead of up to 30 s later. One tag per module: unstable_cache
// applies its tags to every entry of the wrapper, so revalidating "permits"
// clears the permit list for every project of every org in this deployment's
// cache -- broader than strictly needed, and correct: the next read simply
// re-fetches. A per-project tag would need a wrapper built per request, which
// is precisely what unstable_cache must not be used for.
export const MODULE_TAGS = {
  permits: "module:permits",
  moms: "module:moms",
  drawings: "module:drawings",
  documents: "module:documents",
  manpower: "module:manpower",
  materials: "module:materials",
  workProgress: "module:work-progress",
  scope: "module:scope",
} as const;

export type ModuleTag = (typeof MODULE_TAGS)[keyof typeof MODULE_TAGS];

/**
 * Builds a cached, org-scoped list fetcher for one module.
 *
 * The wrapped function is the THROWING callVeridian on purpose: Next's data
 * cache stores what a cached function returns, so returning a failure object
 * would pin the failure in the cache for the full 30 s. A thrown error is not
 * cached, so a failed read is retried on the very next request -- and is
 * converted to a message here, outside the cache.
 *
 * Defined once per module at module scope, never inside a request handler.
 */
function createModuleList(
  tag: ModuleTag,
  buildPath: (projectId: string) => string,
  pick: (payload: Record<string, unknown>) => unknown[] | undefined,
  options: { root?: boolean } = {}
) {
  const cached = unstable_cache(
    (organizationId: string | null, projectId: string) =>
      callVeridian<Record<string, unknown>>(buildPath(projectId), {
        organizationId: organizationId ?? undefined,
        root: options.root,
      }),
    ["veridian-module-list", tag],
    { revalidate: 30, tags: [tag] }
  );

  // Generic at the CALL site, not at creation: the row type belongs to the
  // client component that renders it (Permit, Doc, RosterEntry...), and each
  // page passes it explicitly so a payload-shape change is a type error rather
  // than a runtime surprise.
  return async function fetchList<T>(
    organizationId: string | null,
    projectId: string,
    context: string
  ): Promise<ModuleListOutcome<T>> {
    try {
      const payload = await cached(organizationId ?? null, projectId);
      return { rows: (pick(payload) ?? []) as T[], errorMessage: null };
    } catch (err) {
      const message = err instanceof VeridianApiError ? err.message : `Couldn't load ${context}.`;
      console.error(`[module-list-source] ${tag} failed:`, err instanceof Error ? err.message : err);
      // rows stays EMPTY and errorMessage is set: the client renders the error,
      // never a calm "there are none" over a failed read.
      return { rows: [], errorMessage: message };
    }
  };
}

const q = encodeURIComponent;

export const fetchPermitsList = createModuleList(
  MODULE_TAGS.permits,
  (projectId) => `/permits?projectId=${q(projectId)}&all=true`,
  (p) => p.permits as unknown[] | undefined
);

export const fetchMomsList = createModuleList(
  MODULE_TAGS.moms,
  (projectId) => `/veri-meetings?projectId=${q(projectId)}`,
  (p) => p.meetings as unknown[] | undefined
);

export const fetchDrawingsList = createModuleList(
  MODULE_TAGS.drawings,
  (projectId) => `/drawings?projectId=${q(projectId)}`,
  (p) => p.drawings as unknown[] | undefined
);

// /api/v1/documents was never re-exported under /api/v1/projexa/*, hence root.
export const fetchDocumentsList = createModuleList(
  MODULE_TAGS.documents,
  (projectId) => `/documents?linkedEntityType=project&linkedEntityId=${q(projectId)}`,
  (p) => p.documents as unknown[] | undefined,
  { root: true }
);

export const fetchRosterList = createModuleList(
  MODULE_TAGS.manpower,
  (projectId) => `/construction/labour-roster?projectId=${q(projectId)}`,
  (p) => p.roster as unknown[] | undefined,
  { root: true }
);

// ---------------------------------------------------------------------------
// R67 F-30 (audit recommendation R-274) -- the /labour landing, in ONE hop.
// ---------------------------------------------------------------------------
//
// The Manpower screen needs two things on arrival: the roster (its opening
// tab) and the day's attendance summary (the strip above it). Fetching them
// one after the other is two round trips to VERIDIAN and, upstream, two
// transactions on a five-connection pool for one landing --  the shape R-274
// asked to be profiled and, if serial, collapsed. VERIDIAN's labour route now
// answers both from one transaction behind `includeAttendanceSummary=1`, and
// this asks for exactly that.
//
// TWO <Suspense> BOUNDARIES, ONE FETCH. The page renders the summary strip and
// the roster in separate boundaries so each streams as soon as it can. Both
// call getLabourLanding() below, and React's cache() makes the SECOND call
// return the FIRST call's promise -- so two boundaries cost one request, not
// two. Without it, splitting the page into boundaries would have doubled its
// network cost, which is the opposite of this item.

export type LabourAttendanceSummary = {
  date: string;
  recorded: number;
  present: number;
  halfDay: number;
  absent: number;
  totalCost: number;
};

export type LabourLanding<T> = {
  roster: T[];
  attendanceSummary: LabourAttendanceSummary | null;
  /** The backend's own words when the landing could not be read. */
  errorMessage: string | null;
};

const cachedLabourLanding = unstable_cache(
  (organizationId: string | null, projectId: string, date: string) =>
    callVeridian<Record<string, unknown>>(
      `/construction/labour-roster?projectId=${q(projectId)}&includeAttendanceSummary=1&date=${q(date)}`,
      { organizationId: organizationId ?? undefined, root: true }
    ),
  ["veridian-module-list", MODULE_TAGS.manpower, "landing"],
  // Tagged with the SAME module tag as the roster list, so an "Add Worker"
  // write clears both and a new worker is visible immediately.
  { revalidate: 30, tags: [MODULE_TAGS.manpower] }
);

/**
 * The roster and one day's attendance summary, deduplicated per request.
 *
 * `cache()` is request-scoped, so the two <Suspense> boundaries on /labour
 * share ONE in-flight call; `unstable_cache` underneath then shares it across
 * requests for 30 s, keyed org + project + day.
 */
export const getLabourLanding = cache(async function getLabourLanding<T>(
  organizationId: string | null,
  projectId: string,
  date: string
): Promise<LabourLanding<T>> {
  try {
    const payload = await timeUpstream("labour:roster+attendance-summary", () =>
      cachedLabourLanding(organizationId ?? null, projectId, date)
    );
    return {
      roster: ((payload.roster as unknown[]) ?? []) as T[],
      attendanceSummary: (payload.attendanceSummary as LabourAttendanceSummary | null) ?? null,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Couldn't load the roster.";
    console.error("[module-list-source] labour landing failed:", err instanceof Error ? err.message : err);
    // rows EMPTY and errorMessage set: the screen renders the reason, never a
    // calm "no workers on the roster yet" over a failed read.
    return { roster: [], attendanceSummary: null, errorMessage: message };
  }
});

/**
 * The organisation id for this request, resolved ONCE however many <Suspense>
 * boundaries ask for it. requireAuth() costs a Supabase claims decode plus a
 * memberships query; /labour has two boundaries and paying for that twice
 * would be a regression introduced by the very restructure meant to speed the
 * page up.
 */
export const getCachedServerOrganizationId = cache(async function getCachedServerOrganizationId(): Promise<string | null> {
  const { getServerOrganizationId } = await import("@/lib/supabase/auth-guard");
  return timeUpstream("shell:organization", () => getServerOrganizationId());
});

export const fetchMaterialMasterList = createModuleList(
  MODULE_TAGS.materials,
  (projectId) => `/construction/materials?projectId=${q(projectId)}`,
  (p) => p.materials as unknown[] | undefined,
  { root: true }
);

// R67 F-23 (R-239) + F-29 (R-273): `include=variation,compare` makes VERIDIAN
// return each revision's variation-vs-prior AND its compare summary (line
// count, total, delta amount and percent) with the list, so ScopeClient no
// longer fires one /api/scope/{id}/compare request per row to fill those cells
// -- the single biggest contributor to /scope's 22 calls. Both come out of ONE
// statement upstream, so asking for both costs what asking for either costs.
export const fetchScopeList = createModuleList(
  MODULE_TAGS.scope,
  (projectId) => `/scope?projectId=${q(projectId)}&include=variation,compare`,
  (p) => p.boqs as unknown[] | undefined
);
