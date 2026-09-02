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
    document.cookie = projectId
      ? `${PROJECT_COOKIE}=${encodeURIComponent(projectId)}; path=/; max-age=${PROJECT_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
      : `${PROJECT_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // A blocked cookie jar just means the URL stays the only source; it must
    // never take the shell down.
  }
}
