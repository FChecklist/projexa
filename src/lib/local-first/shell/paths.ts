// LOCAL-FIRST shell: URLs. The static on-laptop shell answers EVERY app URL it is asked to (the service worker serves the same /local
// document for /scope/abc in local-first mode and for /local/scope/abc), so the shell decides what to draw from the address bar
// alone. Pure functions, no browser access.

/** The shell's own prefix. /local/scope/abc and /scope/abc are the same screen. */
export const SHELL_PREFIX = "/local";

/** Query parameter that tells the service worker "this navigation wants the server's page, even in local-first mode". */
export const SERVER_PAGE_PARAM = "px-server";

export type ShellLocation = { path: string; search: string };

/** "/local/scope/abc?x=1#h" or "/scope/abc?x=1" -> { path: "/scope/abc", search: "?x=1" }. The fragment is dropped. */
export function parseShellLocation(pathname: string, search = ""): ShellLocation {
  let path = pathname || "/";
  if (path === SHELL_PREFIX) path = "/";
  else if (path.startsWith(`${SHELL_PREFIX}/`)) path = path.slice(SHELL_PREFIX.length);
  // no trailing slash except the root, no duplicate slashes
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, search: search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "" };
}

/** The URL of the SAME screen served by the server (the fallback for a module the shell does not have yet). */
export function serverPageUrl(location: ShellLocation): string {
  const params = new URLSearchParams(location.search);
  params.set(SERVER_PAGE_PARAM, "1");
  return `${location.path === "/" ? "/dashboard" : location.path}?${params.toString()}`;
}

/** True when `href` is a link the shell should handle itself: same-origin, a plain page path, not a file and not an API. */
export function isShellNavigable(href: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  const last = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  if (last.includes(".")) return false; // a file: let the browser fetch it
  return true;
}

export type PathMatch<P extends string = string> = { params: Record<P, string> };

/** "/scope/:id" matched against "/scope/abc" -> { id: "abc" }; null when it does not match. Segments are decoded. */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i]!;
    const h = have[i]!;
    if (w.startsWith(":")) {
      try {
        params[w.slice(1)] = decodeURIComponent(h);
      } catch {
        return null;
      }
    } else if (w !== h) {
      return null;
    }
  }
  return params;
}

/** The first route whose pattern matches, with its params. Literal patterns are tried before ones with parameters, whatever the order. */
export function matchRoute<R extends { pattern: string }>(routes: readonly R[], path: string): { route: R; params: Record<string, string> } | null {
  const ordered = [...routes].sort((a, b) => Number(a.pattern.includes(":")) - Number(b.pattern.includes(":")));
  for (const route of ordered) {
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}
