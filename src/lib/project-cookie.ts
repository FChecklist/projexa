// R67 F-18 -- the name of the cookie that carries the selected project, and
// the browser-side writer for it.
//
// *** MERGE NOTE (R67 F-18 x WS-A A-05). ***
//
// This file used to own its own cookie, `projexa_project`, because when F-18
// was written NOTHING in the app remembered the rail's project and F-18's whole
// point is that a module page must know its project WITHOUT a network call.
// That was flagged at the time as a seam: "if D-65/D-66 redesign the rail, this
// file is where they meet."
//
// WS-A (A-05) has now shipped that rail, in src/lib/project-preference.ts, with
// its own key `veri.rail.project` written to BOTH localStorage (so the rail can
// paint before any request) and a cookie (so the SERVER agrees on the first
// render). Keeping a second cookie beside it would recreate the exact defect
// A-05's own header describes -- two independent answers to "which project" --
// and it would do so in the worst possible place: SIGN-OUT. This file's
// clearing path is the only one in the app, and had it kept clearing only its
// own cookie it would have left A-05's localStorage and cookie holding the
// PREVIOUS user's project id for the next person to sign in on this browser.
//
// So this module is now a thin delegation to that one owner. The name, the
// writer and the storage are A-05's; what F-18 keeps is the server-side reader
// (module-list-source.ts), the sign-out clearing, and the `Secure` attribute.
import {
  PROJECT_PREFERENCE_KEY,
  readStoredProjectId,
  writeStoredProjectId,
} from "@/lib/project-preference";

/**
 * The cookie the server reads to learn the rail's project without a round trip.
 * ONE name, owned by src/lib/project-preference.ts.
 */
export const PROJECT_COOKIE = PROJECT_PREFERENCE_KEY;

/**
 * Records (or clears) the selected project for the server to read on the next
 * navigation. Browser-only; a no-op anywhere else.
 *
 * *** CLEAR IT ON SIGN-OUT. *** Pass null before signOut() -- every sign-out
 * path in this app does (AccountMenu, AppTopbar, SettingsClient, and M24Shell's
 * own SIGNED_OUT handler for a sign-out that happened in another tab). A
 * year-long preference left behind means the NEXT person to sign in on this
 * browser has the previous user's project id resolved for them with no network
 * call. VERIDIAN scopes every read by org, so nothing of the old tenant's data
 * leaks -- what leaks is worse to read: the new user's /permits, /moms,
 * /drawings and /scope come back with zero rows and NO error, so the screen
 * calmly says there are none. resolveProjectForModule() therefore also
 * validates a cookie-sourced id against the caller's own project list before
 * trusting it.
 *
 * Delegates to writeStoredProjectId(), so clearing clears BOTH the cookie and
 * the localStorage copy the rail paints from. Clearing only one would leave the
 * rail showing the previous user's project name after a sign-out.
 */
export function rememberSelectedProject(projectId: string | null): void {
  writeStoredProjectId(projectId);
}

/**
 * The project the rail last selected, as the BROWSER sees it. Null when nothing
 * has been selected in this browser yet.
 *
 * localStorage first (it is what the rail itself paints from, so this cannot
 * disagree with the rail), then the cookie, which is the copy that survives a
 * browser configured to block script storage but still accept cookies.
 */
export function readSelectedProjectId(): string | null {
  const stored = readStoredProjectId();
  if (stored) return stored;
  if (typeof document === "undefined") return null;
  try {
    for (const part of document.cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === PROJECT_COOKIE) {
        const value = decodeURIComponent(rest.join("="));
        return value.trim() ? value : null;
      }
    }
  } catch {
    // A blocked cookie jar is simply "we do not know".
  }
  return null;
}
