// R67 F-18 -- the name of the cookie that carries the selected project, and
// the browser-side writer for it.
//
// Its own module, with NO server imports, because both halves need it: the
// server reads it in module-list-source.ts (which imports next/headers and can
// never be pulled into a client component), and the top rail writes it from
// the browser when the user switches project.
//
// WHY A COOKIE AT ALL. Under D-04 a module page must know which project it is
// about WITHOUT a network call, or the /dashboard hop goes straight back onto
// the critical path. The `?projectId=` in the URL covers every navigation that
// came from a "+ New" button, a KPI tile or a pill. It does not cover a
// typed URL, a bookmark, or a module opened from the directory -- and for
// those the cookie is the answer the rail already knows.

export const PROJECT_COOKIE = "projexa_project";

// Thirty days: long enough that a returning user lands on the project they
// were last working in, short enough that an abandoned selection expires.
const PROJECT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Records (or clears) the selected project for the server to read on the next
 * navigation. Browser-only; a no-op anywhere else.
 *
 * *** CLEAR IT ON SIGN-OUT. *** Pass null before signOut() -- every sign-out
 * path in this app does (AccountMenu, AppTopbar, SettingsClient, and M24Shell's
 * own SIGNED_OUT handler for a sign-out that happened in another tab). A
 * 30-day cookie left behind means the NEXT person to sign in on this browser
 * has the previous user's project id resolved for them with no network call.
 * VERIDIAN scopes every read by org, so nothing of the old tenant's leaks --
 * what leaks is worse to read: the new user's /permits, /moms, /drawings and
 * /scope come back with zero rows and NO error, so the screen calmly says
 * there are none. resolveProjectForModule() therefore also validates a
 * cookie-sourced id against the caller's own project list before trusting it.
 *
 * SameSite=Lax so it is sent on ordinary top-level navigations -- which is
 * exactly and only what needs it -- and never on a cross-site subrequest. Not
 * HttpOnly, deliberately: this is a UI preference the client itself writes,
 * and it carries no authority of any kind. Every read is still scoped by the
 * caller's own session and org; a forged value can only ask for a project the
 * caller is already entitled to see, and VERIDIAN answers 403 otherwise.
 */
export function rememberSelectedProject(projectId: string | null): void {
  if (typeof document === "undefined") return;
  try {
    // `Secure` on HTTPS so the value cannot be planted over a plaintext
    // downgrade. Omitted on http:// because a Secure cookie is silently
    // dropped there, which would break local development rather than protect
    // it.
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
    document.cookie = projectId
      ? `${PROJECT_COOKIE}=${encodeURIComponent(projectId)}; path=/; max-age=${PROJECT_COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`
      : `${PROJECT_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  } catch {
    // A blocked cookie jar just means the URL stays the only source; it must
    // never take the shell down.
  }
}

/**
 * The project the rail last selected, read from the browser's own cookie jar.
 * Null when nothing has been selected in this browser yet.
 */
export function readSelectedProjectId(): string | null {
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
