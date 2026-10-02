"use client";

// LOCAL-FIRST shell: the client router. The static shell is ONE document that draws whatever app URL it was opened at, so routing is
// the address bar and the History API, nothing more: no server round trip, no Next navigation (Next's own router knows only the
// /local page; it is never asked to go anywhere).
//
// Before the first effect runs the location is null, so the prerendered HTML and the first client render are identical (a skeleton),
// whatever URL the service worker served the document for -- no hydration mismatch.
//
// Links: navigate() keeps the person under the prefix they are already on (/local/scope/abc stays under /local), so a reload lands
// back in the shell even when local-first mode is off.

import { useCallback, useEffect, useState } from "react";
import { SHELL_PREFIX, isShellNavigable, parseShellLocation, type ShellLocation } from "./paths";

/** Builds the history URL for an app path: under /local when the current document is. */
export function historyUrlFor(href: string, current: { pathname: string; origin: string; href: string }): string {
  const url = new URL(href, current.href);
  const underPrefix = current.pathname === SHELL_PREFIX || current.pathname.startsWith(`${SHELL_PREFIX}/`);
  const loc = parseShellLocation(url.pathname, url.search);
  const path = underPrefix ? (loc.path === "/" ? SHELL_PREFIX : `${SHELL_PREFIX}${loc.path}`) : loc.path;
  return `${path}${loc.search}`;
}

export function useShellLocation(): { location: ShellLocation | null; navigate: (href: string, options?: { replace?: boolean }) => void } {
  const [location, setLocation] = useState<ShellLocation | null>(null);

  useEffect(() => {
    const read = () => setLocation(parseShellLocation(window.location.pathname, window.location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    const target = historyUrlFor(href, { pathname: window.location.pathname, origin: window.location.origin, href: window.location.href });
    if (options?.replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
    setLocation(parseShellLocation(window.location.pathname, window.location.search));
    if (!options?.replace) window.scrollTo?.(0, 0);
  }, []);

  return { location, navigate };
}

/**
 * The click handler of the shell's root element: a plain <a> to a page of this app is a shell navigation, so a screen can use ordinary
 * anchors. Modified clicks, new-tab links, downloads, other origins, files and /api go to the browser as usual.
 */
export function interceptLinkClick(event: { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: unknown; preventDefault(): void }, navigate: (href: string) => void, origin: string): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null | undefined;
  if (!anchor) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false;
  if (!isShellNavigable(anchor.href, origin)) return false;
  event.preventDefault();
  navigate(`${anchor.pathname}${anchor.search}`);
  return true;
}
