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

import { createContext, useContext, useMemo } from "react";

export type ScopedProject = { id: string; name: string };

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
