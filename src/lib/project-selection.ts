import { cookies } from "next/headers";
import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";
import {
  PROJECT_PREFERENCE_KEY,
  pickProject,
  pickRouteProject,
  type ProjectSource,
} from "@/lib/project-preference";

export type SelectableProject = { id: string; name: string };

/**
 * R67 D-20/D-66 -- the cookie holding the user's last project choice.
 *
 * ONE COOKIE, NOT TWO. This lane introduced "px_project" and WS-A shipped
 * "veri.rail.project" (PROJECT_PREFERENCE_KEY) for the same purpose, and
 * WS-A's is the one the SERVER already reads in resolveSelectedProject below,
 * so it is the one that survives. Two cookies remembering one preference is
 * precisely the duplication both items existed to remove -- and the failure
 * mode is not cosmetic: whichever the shell wrote last would decide, so the
 * rail and the first server render could disagree again.
 *
 * The name is kept as an alias because this lane's readers and writers import
 * it from here, and because naming it in the one server-safe module both
 * halves already import is what stops them drifting apart on a string literal.
 */
export const PROJECT_COOKIE = PROJECT_PREFERENCE_KEY;

/**
 * R67 D-66 -- what /dashboard shows.
 *
 * "/dashboard renders the portfolio when the context is All and the project
 * dashboard when a project is set." The order is the WS-A root rule's: the
 * URL first, then the remembered choice, and a remembered id that is no
 * longer in the org's list is discarded rather than followed -- a deleted or
 * reassigned project must not pin a user to a blank screen forever.
 *
 * Note what this does NOT do: it never falls back to projects[0]. That is
 * the exact fault D-20 removed, and re-introducing it on the home screen
 * would be the loudest possible place to make it.
 */
export function dashboardScope(
  projects: SelectableProject[],
  fromUrl?: string | null,
  fromCookie?: string | null
): { project: SelectableProject | null; mode: ProjectSelectionMode } {
  for (const candidate of [fromUrl, fromCookie]) {
    if (!candidate) continue;
    const found = projects.find((p) => p.id === candidate);
    if (found) return { project: found, mode: "project" };
  }
  return { project: null, mode: "all" };
}

// R67 D-20. "all" is a REAL, explicit state -- the user is looking at the
// whole org, and the screen is allowed to say so -- not the absence of a
// choice. Every screen that opts in must handle both.
export type ProjectSelectionMode = "project" | "all";

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
  /**
   * R67 D-70: the upstream HTTP status when the read failed, or null. Returned
   * for the CALLER's logging and branching only -- it is never rendered; see
   * describeProjectListFailure() below for what a user is shown instead.
   */
  status: number | null;
  /**
   * R67 D-20. "project" means a specific project is in scope. "all" means the
   * org as a whole is in scope and `project` is null ON PURPOSE -- the caller
   * must query org-wide rather than pick one.
   */
  mode: ProjectSelectionMode;
  /**
   * R67 D-20. True when `project` is NOT one the user asked for or chose -- it
   * was picked for them because nothing said which. Callers render
   * "(auto-selected)" beside the name so a user is never silently shown, and
   * never silently WRITES TO, a project they did not pick.
   *
   * DERIVED from `source`, never stored beside it: WS-A's "auto" and this
   * lane's `fellBack` are the same fact, and two fields that can disagree
   * about one fact is how the rail and the pane came to disagree in the first
   * place. "only" is deliberately NOT a fallback -- a user with exactly one
   * project was not offered a choice, so there is nothing to admit to.
   */
  fellBack: boolean;
};

/** WS-A's `source`, read as this lane's "was this chosen FOR the user?". */
export function fellBackFrom(source: ProjectSource | null): boolean {
  return source === "auto";
}

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
 *
 * THE RULE ITSELF IS NOT HERE. WS-A's pickProject() owns it -- the URL, then
 * the user's own remembered rail choice, then their only project, then a pick
 * -- and the browser shell applies the same function, which is what stops the
 * rail and the pane disagreeing. This adds the one thing WS-A's rule has no
 * opinion about: a screen may DECLINE the last resort entirely and take the
 * org-wide mode instead.
 */
export function chooseProject(
  projects: SelectableProject[],
  requestedProjectId?: string,
  options?: ResolveProjectOptions,
  preferredProjectId?: string | null
): { project: SelectableProject | null; mode: ProjectSelectionMode; fellBack: boolean; source: ProjectSource | null } {
  const picked = pickProject({ requested: requestedProjectId, preferred: preferredProjectId, projects });

  // Nothing the user asked for or ever chose. Either the URL carried no
  // projectId at all, or it carried one this org cannot see (a stale bookmark,
  // a link pasted from another org). Both are the same question -- "which
  // project did you mean?" -- and neither is an invitation to answer it on the
  // user's behalf, which is what opting in refuses.
  if (options?.allProjectsWhenUnset && picked.source === "auto") {
    return { project: null, mode: "all", fellBack: false, source: null };
  }

  return {
    project: picked.project,
    mode: picked.project ? "project" : "all",
    fellBack: fellBackFrom(picked.source),
    source: picked.source,
  };
}

/**
 * R67 D-70 (audit R-262). What a user is told when the project list does not
 * load.
 *
 * THE DEFECT. Every create page in this app returned early with this outcome's
 * raw `errorMessage` in a bare Card, so a failing VERIDIAN /dashboard replaced
 * the entire right pane with the words "Internal Server Error" -- no title, no
 * Back, no Retry, and no statement of what had failed. That string is not the
 * backend's words about anything: it is the HTTP status phrase, it names no
 * subject, and it is what an upstream 500 with no JSON body degrades into.
 *
 * The standing rule in this codebase is to show the backend's OWN words (see
 * DataLoadError's header), and this keeps them -- with that one exception. A
 * message that says nothing is replaced by one that says which call failed and
 * who answered; every real VERIDIAN message, including its timeout wording,
 * passes through untouched.
 */
export function describeProjectListFailure(raw: string): string {
  return /^(internal server error|internal error|error|500|bad gateway|502|service unavailable|503)\.?$/i.test(raw.trim())
    ? "VERIDIAN answered with an internal error."
    : raw;
}

/** The one sentence every create screen leads its failure banner with. */
export function projectListFailureBanner(raw: string): string {
  return `Couldn't load your project list: ${describeProjectListFailure(raw)}`;
}

/**
 * The one reason a create screen's Save states while there is no project list to
 * write against. It outranks every field-level reason: there is nothing to write
 * to, whatever the form says.
 */
export const PROJECT_LIST_UNAVAILABLE_REASON = "project list unavailable";

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
// so. R67 D-20 adds the refusal: a screen may pass allProjectsWhenUnset and
// take the org-wide mode rather than have a project chosen for it.
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
    const preferred = await readPreferredProjectId();
    return {
      projects,
      errorMessage: null,
      // R67 D-70: null on a successful read -- there is no failure to report.
      status: null,
      ...chooseProject(projects, requestedProjectId, options, preferred),
    };
  } catch (err) {
    // R67 D-70: the RAW error, with the upstream status, is logged here and only
    // here. Callers render describeProjectListFailure(errorMessage) -- never the
    // exception, never a stack, never the internal URL (VeridianApiError already
    // keeps that in `detail`, which is logged by veridian-client and never
    // returned). Without this line a create-route failure left nothing at all in
    // the server log: the page swallowed it into a card and moved on, which is
    // why correction C-06 records that the cause of the /drawings/new failure
    // was never established.
    const status = err instanceof VeridianApiError ? err.status : null;
    console.error(
      `[project-selection] resolveSelectedProject failed (upstream status ${status ?? "none"}):`,
      err instanceof Error ? err.message : err
    );
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      source: null,
      status,
      // Nothing was resolved, so nothing was fallen back to -- and with no
      // project there is no project in scope, whatever the caller asked for.
      // "project mode with no project" is the contradictory state
      // ProjectScopeProvider refuses to represent, so it is not produced here
      // either; the errorMessage is what an opted-in screen branches on.
      mode: "all",
      fellBack: false,
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
 */
export async function resolveRouteProject(
  searchParams: { projectId?: string | null } | undefined,
  objectProjectId?: string | null,
  organizationId?: string | null
): Promise<RouteProjectSelection> {
  try {
    const data = await callVeridian<{ projects: SelectableProject[] }>("/dashboard", {
      organizationId: organizationId ?? undefined,
    });
    const projects = data.projects ?? [];
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
      // R67 D-70: the upstream status, for the caller's logging only. null on a
      // successful read -- there is no failure to report.
      status: null,
      // A-13's strict resolution never picks for the user, so it can never
      // have fallen back; with no project the screen IS org-wide, and asks.
      mode: picked.project ? "project" : "all",
      fellBack: false,
      missing: picked.missing,
      unreachable: picked.unreachable,
    };
  } catch (err) {
    return {
      project: null,
      projects: [],
      errorMessage: err instanceof VeridianApiError ? err.message : "Failed to load projects from VERIDIAN",
      source: null,
      // R67 D-70: carried for the caller's own logging, never rendered -- see
      // describeProjectListFailure() for what a user is shown instead.
      status: err instanceof VeridianApiError ? err.status : null,
      mode: "all",
      fellBack: false,
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
