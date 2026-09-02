"use client";

// R67 D-66 -- ONE ProjectContext. The rail, the breadcrumb, the composer root
// and the page data all read from here and from nothing else.
//
// WHAT WAS WRONG. R-253 recorded the rail saying "All projects" while the
// breadcrumb underneath it said "Dashboard / Cedar Heights Villa - Phase 1".
// Two independent sources produced that: M24Shell held its own `projectId`
// state for the composer, and every page separately called
// resolveSelectedProject() on the server, which silently fell back to
// projects[0]. Neither knew about the other, so they disagreed whenever the
// URL was quiet -- and M24's own rule is that the project must be visible at
// all times, because acting against the wrong one is the most expensive
// mistake this product offers.
//
// D-20 fixed the SERVER half (resolveSelectedProject no longer guesses, and
// the URL wins). This is the CLIENT half: the shell's single resolution is
// published once, and any component under the shell reads it instead of
// deriving its own.
//
// WHY A DEFAULT RATHER THAN A THROW. A client component rendered outside the
// shell -- in a unit test, or on one of the three routes that deliberately
// get no shell (auth/callback, invite/[token], share/report/[token]) -- must
// still render. The default is honest about knowing nothing: no projects, no
// selection, and a switcher that cannot be opened.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PROJECT_COOKIE } from "@/lib/project-selection";

export type ScopedProject = { id: string; name: string };

// ─── THE URL WINS ────────────────────────────────────────────────────────
//
// R67 D-20's reading half, extracted out of M24Shell so it is TESTABLE. It
// used to be an inline effect inside a shell that also fetches the org, the
// project list, the task list and the screen registry, so nothing could
// exercise the precedence rule without standing all of that up -- and the
// rule is precisely what D-04's and D-66's acceptances turn on. A regression
// that let the cookie win over the URL would have shipped green.
//
// THE RULE, one sentence: a ?projectId= in the URL always decides. The cookie
// is a memory of the user's last choice, consulted ONCE and only when the URL
// says nothing at all -- never as an override, and never again after the URL
// has spoken.
export const PROJECT_PARAM = "projectId";
const PROJECT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readProjectCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${PROJECT_COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(PROJECT_COOKIE.length + 1));
  return value || null;
}

export function writeProjectCookie(projectId: string | null) {
  if (typeof document === "undefined") return;
  // A project id the user picked themselves -- not a credential, not
  // personal data. Lax so it is not sent on cross-site requests at all.
  document.cookie = projectId
    ? `${PROJECT_COOKIE}=${encodeURIComponent(projectId)}; path=/; max-age=${PROJECT_COOKIE_MAX_AGE}; SameSite=Lax`
    : `${PROJECT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * The shell's resolved project id, and the setter the switcher writes through.
 *
 * Re-reads on mount, on every route change (`pathname`), and on back/forward
 * (`popstate`) -- the same three triggers the Task Master's tab param uses,
 * and `window.location.search` rather than useSearchParams so the shell, which
 * wraps all 53 routes, does not put every one of them behind a Suspense
 * boundary it does not otherwise need.
 */
export function useUrlProjectId(pathname: string): [string | null, (next: string | null) => void] {
  const [projectId, setProjectId] = useState<string | null>(null);
  const adoptedCookie = useRef(false);

  useEffect(() => {
    const syncFromUrl = () => {
      const fromUrl = new URLSearchParams(window.location.search).get(PROJECT_PARAM);
      if (fromUrl) {
        adoptedCookie.current = true;
        setProjectId(fromUrl);
        writeProjectCookie(fromUrl);
        return;
      }
      if (!adoptedCookie.current) {
        adoptedCookie.current = true;
        const remembered = readProjectCookie();
        if (remembered) setProjectId(remembered);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [pathname]);

  return [projectId, setProjectId];
}

/**
 * Whether this screen is showing ONE project or the whole portfolio.
 * The distinction is the point of D-20: "all" is a deliberate choice a
 * screen opts into, never the residue of a failed lookup.
 */
export type ProjectScopeMode = "project" | "all";

export type ProjectScope = {
  /** Every project the user may switch to. Empty while the list is loading. */
  projects: ScopedProject[];
  /** The selected project, or null under "All projects". */
  project: ScopedProject | null;
  projectId: string | null;
  mode: ProjectScopeMode;
  /** False until GET /api/projects has actually answered. */
  projectsLoaded: boolean;
  /** Switch project. Writes context, URL and cookie together (M24Shell). */
  selectProject: (project: ScopedProject | null) => void;
  /**
   * Ask the top rail to open its switcher. This is what makes the breadcrumb's
   * project name and the "pick a project" cards actionable rather than
   * decorative -- the item's phrase is "with the switcher open".
   */
  openSwitcher: () => void;
};

const FALLBACK: ProjectScope = {
  projects: [],
  project: null,
  projectId: null,
  mode: "all",
  projectsLoaded: false,
  selectProject: () => {},
  openSwitcher: () => {},
};

const ProjectScopeContext = createContext<ProjectScope>(FALLBACK);

export function ProjectScopeProvider({
  value,
  children,
}: {
  value: Omit<ProjectScope, "mode">;
  children: React.ReactNode;
}) {
  // `mode` is DERIVED, never stored. Storing it would let a screen be in
  // "project" mode with no project -- the contradictory state D-20 removed.
  const scope = useMemo<ProjectScope>(
    () => ({ ...value, mode: value.project ? "project" : "all" }),
    [value]
  );
  return <ProjectScopeContext.Provider value={scope}>{children}</ProjectScopeContext.Provider>;
}

export function useProjectScope(): ProjectScope {
  return useContext(ProjectScopeContext);
}
