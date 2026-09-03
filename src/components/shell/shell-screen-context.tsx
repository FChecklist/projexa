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
import type { ShellObjectRecord } from "@/lib/object-screens";

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
  /**
   * R67 A-21. The RECORD an object page is showing, when this screen is one.
   * It carries its own projectId because an object page resolves nothing on the
   * server -- the client fetches the record, and the record is where the
   * project comes from. Null on every list, create and dashboard screen.
   */
  object: ShellObjectRecord | null;
};

const EMPTY: ShellScreen = { pathname: null, moduleId: null, project: null, source: null, object: null };

const ScreenValueContext = createContext<ShellScreen>(EMPTY);
const ScreenPublishContext = createContext<(screen: ShellScreen) => void>(() => {});

function sameScreen(a: ShellScreen, b: ShellScreen): boolean {
  return (
    a.pathname === b.pathname &&
    a.moduleId === b.moduleId &&
    a.source === b.source &&
    a.project?.id === b.project?.id &&
    a.project?.name === b.project?.name &&
    // A-21: the record is part of the screen's identity. A BOQ whose title was
    // just edited, or whose project was corrected, is a different sentence in
    // the strip -- and a record that is still loading (null) is a different
    // screen from one that has arrived.
    a.object?.moduleId === b.object?.moduleId &&
    a.object?.label === b.object?.label &&
    a.object?.projectId === b.object?.projectId &&
    a.object?.kind === b.object?.kind
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
      // A list, create or dashboard screen is not about one record. Publishing
      // null here rather than leaving the field out is what stops a stale
      // object segment surviving from the object page the user just left.
      object: null,
    }),
    [pathname, moduleId, projectId, projectName, source]
  );
  useEffect(() => {
    publish(screen);
  }, [publish, screen]);
  return null;
}

/**
 * R67 A-21 -- WHAT RECORD IS THIS PAGE ABOUT?
 *
 * Rendered by an object page's own client once its record has LOADED, which is
 * the only moment it can answer honestly: these pages fetch in the browser
 * (/scope/<id> and /moms/<id> resolve nothing on the server), so before the
 * fetch returns there is no title and no project to publish, and rendering this
 * with an empty label would put "<project> › BOQ" on screen -- a kind word with
 * no record, which names nothing.
 *
 * It publishes THREE facts and no more: which module the record belongs to, the
 * record's own label, and the record's own project. The kind word ("BOQ",
 * "Worker") is NOT published per page -- src/lib/object-screens.ts owns it, so
 * every screen showing the same kind of record uses the same word.
 *
 * It renders nothing, and it needs no cleanup: like ScreenContext, the
 * publication carries the pathname it describes and the shell ignores any
 * record that is not about the screen currently on show.
 */
export function ObjectContext({
  moduleId,
  kind,
  label,
  projectId,
}: {
  moduleId: string;
  /** Only for a page whose records are not the module's headline record. */
  kind?: string;
  label: string;
  projectId: string | null;
}) {
  const publish = usePublishScreen();
  const pathname = usePathname();
  const screen = useMemo<ShellScreen>(
    () => ({
      pathname,
      moduleId,
      // The NAME is the shell's to resolve: an object page knows the project's
      // id (it is on the record) and never its name, so publishing a name here
      // would mean fetching one this screen has no other use for.
      project: null,
      source: projectId ? "route" : null,
      object: { moduleId, label, projectId, ...(kind ? { kind } : {}) },
    }),
    [pathname, moduleId, kind, label, projectId]
  );
  useEffect(() => {
    publish(screen);
  }, [publish, screen]);
  return null;
}
