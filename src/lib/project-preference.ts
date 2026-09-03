// R67 WS-A (A-05) -- ONE ANSWER TO "WHICH PROJECT", SHARED BY BOTH HALVES.
//
// THE DEFECT. Two independent resolutions of the same question ran on every
// screen. The server page called resolveSelectedProject(), which took the
// ?projectId= if there was one and otherwise silently took projects[0]. The
// shell kept its own React state, set only by clicking the top rail and
// remembered nowhere. Neither told the other, so the pane could render one
// project while the rail named another (or "All projects"), and a reload threw
// the rail's answer away entirely while the pane kept its own.
//
// THE RULE IS NOW WRITTEN DOWN ONCE, as a pure function, and both halves call
// it: THE URL WINS, THEN THE USER'S OWN LAST CHOICE, THEN -- only if the user
// has exactly one project -- that project, and only after all of those does the
// page pick one for them. `source` says which of those happened, so the rail
// can admit to an automatic choice instead of presenting it as a decision the
// user made.
//
// The preference is stored twice on purpose: localStorage so the shell can
// paint the rail before any request, and a cookie so the SERVER's own
// resolution agrees with it on the very first render, before any client code
// has run. Both are per-browser conveniences, never authority: every read is
// checked against the projects the API actually returned, so a stale id for a
// project the user has lost access to resolves to null, not to a wrong screen.

export const PROJECT_PREFERENCE_KEY = "veri.rail.project";

/** How the project was chosen. Mirrors ScreenProjectSource in the shell. */
export type ProjectSource = "route" | "preference" | "only" | "auto";

export type PickProjectInput<T extends { id: string }> = {
  /** The URL's own ?projectId= (or an object page's project). Wins. */
  requested?: string | null;
  /** The user's last rail choice, from the cookie or localStorage. */
  preferred?: string | null;
  /** Everything the user can actually reach. The only authority. */
  projects: readonly T[];
};

export type PickProjectResult<T> = {
  project: T | null;
  source: ProjectSource | null;
};

/**
 * THE resolution rule. Pure, so both the server page and the browser shell can
 * apply it and cannot disagree.
 */
export function pickProject<T extends { id: string }>({
  requested,
  preferred,
  projects,
}: PickProjectInput<T>): PickProjectResult<T> {
  if (projects.length === 0) return { project: null, source: null };

  const named = requested ? projects.find((p) => p.id === requested) : undefined;
  if (named) return { project: named, source: "route" };

  const remembered = preferred ? projects.find((p) => p.id === preferred) : undefined;
  if (remembered) return { project: remembered, source: "preference" };

  // Exactly one project is not a choice at all -- offering it as one is
  // busywork, and calling it "auto-selected" would be pedantry.
  if (projects.length === 1) return { project: projects[0], source: "only" };

  // Nothing said which. The page still has to render something, but the rail
  // is told this was automatic so it can say so (A-04).
  return { project: projects[0], source: "auto" };
}

// R67 WS-A (A-13) -- THE STRICT RULE, FOR SCREENS THAT BELONG TO ONE PROJECT.
//
// pickProject() above still ends by choosing for the user, because ~50 pages
// call it and removing that last resort would land every multi-project org on
// "No active projects yet" across all of them (A-05 kept it deliberately, and
// made it admit to itself via source: "auto").
//
// A-13 rules that on a project's OWN screen that last resort is wrong: "The
// URL wins", and "/schedule renders strictly from the URL's projectId and
// shows the sentence 'Pick a project' when absent instead of defaulting to the
// first project". Ten reloads of /schedule?projectId=X must render X, and a
// /schedule with no project must ask rather than silently pick one and show
// another project's board under the same heading.
//
// So this is the same question answered without the fallback, and it
// distinguishes the two ways of having no project, because they need different
// sentences: nothing was asked for (ask), and something was asked for that this
// user cannot reach (say so).

export type PickRouteProjectInput<T extends { id: string }> = {
  /** The URL's own ?projectId=. */
  requested?: string | null;
  /** An object page's own project, e.g. the BOQ's or the meeting's. */
  objectProjectId?: string | null;
  /** Everything the user can actually reach. The only authority. */
  projects: readonly T[];
};

export type PickRouteProjectResult<T> = {
  project: T | null;
  /** "route" whenever the URL or the object named a reachable project. */
  source: Extract<ProjectSource, "route"> | null;
  /** Nothing named a project at all -- the screen asks for one. */
  missing: boolean;
  /** A project WAS named and this user cannot reach it. */
  unreachable: boolean;
};

export function pickRouteProject<T extends { id: string }>({
  requested,
  objectProjectId,
  projects,
}: PickRouteProjectInput<T>): PickRouteProjectResult<T> {
  const named = (requested ?? objectProjectId ?? "").trim();
  if (!named) return { project: null, source: null, missing: true, unreachable: false };
  const found = projects.find((p) => p.id === named);
  if (found) return { project: found, source: "route", missing: false, unreachable: false };
  return { project: null, source: null, missing: false, unreachable: true };
}

/** The stored preference, or null. Never throws: a browser with storage
 *  blocked must still render a shell. */
export function readStoredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(PROJECT_PREFERENCE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the rail's choice for this browser -- in localStorage for the
 * shell and in a cookie so the SERVER resolves the same project on the next
 * render. Clearing (null) removes both.
 */
export function writeStoredProjectId(projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (projectId) window.localStorage.setItem(PROJECT_PREFERENCE_KEY, projectId);
    else window.localStorage.removeItem(PROJECT_PREFERENCE_KEY);
  } catch {
    // Storage can be blocked. The cookie below is the one that matters.
  }
  try {
    // R67 F-18: `Secure` on HTTPS so the value cannot be planted over a
    // plaintext downgrade. Omitted on http:// because a Secure cookie is
    // silently dropped there, which would break local development rather than
    // protect it. Not HttpOnly, deliberately: this is a UI preference the
    // client itself writes and it carries no authority -- every read is still
    // scoped by the caller's own session and org, and a forged value can only
    // ask for a project the caller is already entitled to see.
    const secure =
      typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
    document.cookie = projectId
      ? `${PROJECT_PREFERENCE_KEY}=${encodeURIComponent(projectId)}; path=/; max-age=31536000; samesite=lax${secure}`
      : `${PROJECT_PREFERENCE_KEY}=; path=/; max-age=0; samesite=lax${secure}`;
  } catch {
    // Non-fatal: the preference is a convenience, never authority.
  }
}
