// R67 D-38 (audit R-097/R-101): the top rail's project selection, made
// persistent so a screen can consume it.
//
// THE DEFECT THIS EXISTS FOR. Every Materials capture in the audit shows
// "All projects" in the top rail while the data calls behind the page carried
// exactly one projectId, because the page called resolveSelectedProject() and
// silently took projects[0]. The rail and the rows disagreed, and the screen
// never said which one was right.
//
// The rail's own selection lived in React state inside M24Shell and died on
// every navigation, so there was nothing for a page to read even if it wanted
// to. This module is that one place: written by the rail, read by the pages.
//
// PRECEDENCE, and what this module is NOT. The URL wins. A page that receives
// ?projectId= must use it and must not consult this module at all -- this is
// only the answer to "and if the URL says nothing?". The rail/route precedence
// rule itself belongs to the shell contract; this file stores a value and
// nothing else, so a screen consuming it cannot accidentally re-implement the
// rule.
//
// LIFETIME. sessionStorage, for the same reason M24Shell's MODE_KEY uses it
// (see its own comment): a selection is view state for this sitting, and
// "nobody returns to a view they forgot they set". localStorage would survive
// the session and break that.
//
// Every access is wrapped: storage can throw outright (Safari private mode,
// a browser configured to block site data, an SSR pass where `window` does not
// exist). A storage failure degrades to "no rail selection", which is a state
// the callers already handle, never to a crash.

export const RAIL_PROJECT_KEY = "veri.rail.projectId";

/**
 * Fired on the window after a write, so components in the same tab update.
 * The browser's own `storage` event only fires in OTHER tabs.
 */
export const RAIL_PROJECT_EVENT = "veri:rail-project";

/** The rail's current project, or null for "All projects" / nothing stored. */
export function readRailProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(RAIL_PROJECT_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** `null` clears the selection, which is the rail's real "All projects" state. */
export function writeRailProject(projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (projectId) window.sessionStorage.setItem(RAIL_PROJECT_KEY, projectId);
    else window.sessionStorage.removeItem(RAIL_PROJECT_KEY);
  } catch {
    // A blocked storage must not stop the user switching project -- the
    // selection simply does not survive the next navigation.
  }
  try {
    window.dispatchEvent(new CustomEvent(RAIL_PROJECT_EVENT, { detail: projectId }));
  } catch {
    // CustomEvent is unavailable in some non-browser test environments.
  }
}

/** Subscribe to same-tab writes. Returns the unsubscribe function. */
export function subscribeRailProject(onChange: (projectId: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange(readRailProject());
  window.addEventListener(RAIL_PROJECT_EVENT, handler);
  return () => window.removeEventListener(RAIL_PROJECT_EVENT, handler);
}
