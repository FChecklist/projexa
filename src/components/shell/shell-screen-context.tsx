"use client";

// R67 WS-A (A-03, A-04) -- WHAT SCREEN IS THE USER ON, AND WHOSE PROJECT IS IT?
//
// THE PROBLEM THIS SOLVES. Every module page in this app resolves its own
// project on the server (resolveSelectedProject: the ?projectId= if there is
// one, otherwise the org's first project) and then renders one project's data.
// The shell above it kept an entirely separate `projectId` in React state, set
// only by clicking the top rail. The two never met. So a user could stand on
// /moms reading Cedar Heights' meetings while the rail said "All projects" and
// the composer refused to send because it believed no project was chosen -- the
// pane and the rail describing two different jobs on one screen.
//
// THE FIX IS A ONE-WAY PUBLICATION, not a second source of truth. A server
// page renders <ScreenContext/>, which tells the shell three facts about the
// screen it just rendered: which module it is, which project it resolved, and
// HOW it resolved it (from the URL, from the user's own preference, or
// automatically because there was only one sensible answer). The shell reads
// that and stops guessing.
//
// WHY THE PATHNAME IS PART OF THE RECORD. React runs a child's effects before
// its parent's, so a shell that cleared the published screen on navigation
// would wipe the new page's publication a moment after it arrived. Instead the
// publication carries the pathname it describes, and the shell simply ignores
// any record that is not about the screen currently on show. That is
// order-independent and needs no cleanup.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type ScreenProject = { id: string; name: string };

/** How the screen arrived at its project -- the shell says so in the rail. */
export type ScreenProjectSource =
  /** The URL named it: ?projectId=, or the object's own project. */
  | "route"
  /** The user's own last choice in the top rail. */
  | "preference"
  /** The user has exactly one project, so there was nothing to choose. */
  | "only"
  /** Nothing said which, so the page picked one. This is the one the rail
   *  must admit to, rather than presenting it as a decision the user made. */
  | "auto";

export type ShellScreen = {
  /** The pathname this record describes. Anything else is stale. */
  pathname: string | null;
  moduleId: string | null;
  project: ScreenProject | null;
  source: ScreenProjectSource | null;
};

const EMPTY: ShellScreen = { pathname: null, moduleId: null, project: null, source: null };

const ScreenValueContext = createContext<ShellScreen>(EMPTY);
const ScreenPublishContext = createContext<(screen: ShellScreen) => void>(() => {});

function sameScreen(a: ShellScreen, b: ShellScreen): boolean {
  return (
    a.pathname === b.pathname &&
    a.moduleId === b.moduleId &&
    a.source === b.source &&
    a.project?.id === b.project?.id &&
    a.project?.name === b.project?.name
  );
}

/** Exported for shell-screen-context.test.tsx only: the comparison decides
 *  whether the shell re-renders, so it is worth asserting directly. */
export const sameScreenForTest = sameScreen;

export function ShellScreenProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ShellScreen>(EMPTY);
  // Stable across renders, so a page's publish effect does not re-fire simply
  // because the shell re-rendered.
  const publish = useCallback((next: ShellScreen) => {
    setScreen((prev) => (sameScreen(prev, next) ? prev : next));
  }, []);
  return (
    <ScreenPublishContext.Provider value={publish}>
      <ScreenValueContext.Provider value={screen}>{children}</ScreenValueContext.Provider>
    </ScreenPublishContext.Provider>
  );
}

/** What the current screen published. EMPTY outside a provider, never throws:
 *  a shell that has not been wrapped must degrade, not white-screen. */
export function useShellScreen(): ShellScreen {
  return useContext(ScreenValueContext);
}

export function usePublishScreen(): (screen: ShellScreen) => void {
  return useContext(ScreenPublishContext);
}

/**
 * Rendered by a module page (a server component may render it directly) to
 * tell the shell what it just resolved. Renders nothing.
 */
export function ScreenContext({
  moduleId,
  project,
  source,
}: {
  moduleId: string;
  project: ScreenProject | null;
  source: ScreenProjectSource;
}) {
  const publish = usePublishScreen();
  const pathname = usePathname();
  const projectId = project?.id ?? null;
  const projectName = project?.name ?? null;
  const screen = useMemo<ShellScreen>(
    () => ({
      pathname,
      moduleId,
      project: projectId && projectName ? { id: projectId, name: projectName } : null,
      source: projectId ? source : null,
    }),
    [pathname, moduleId, projectId, projectName, source]
  );
  useEffect(() => {
    publish(screen);
  }, [publish, screen]);
  return null;
}
