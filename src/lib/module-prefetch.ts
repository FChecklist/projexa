"use client";

// R67 F-22 -- which list call a module route is going to make.
//
// Speculation only helps if it fetches the SAME url the screen will ask for a
// moment later: a near-miss costs bytes and buys nothing. So the mapping lives
// in one place beside the clients that build those urls, and any module not
// listed here is simply not speculated on -- a missing entry is a no-op, never
// a wrong guess.

const q = encodeURIComponent;

/**
 * The primary list request a module route issues on arrival, or null when the
 * module has no single primary list (or none worth speculating on).
 *
 * These must stay identical to the urls the module clients build; the tests
 * assert the pairs that matter.
 */
export function primaryListUrl(route: string, projectId: string | null): string | null {
  if (!projectId) return null;
  const path = route.split("?")[0].replace(/\/+$/, "");
  switch (path) {
    case "/scope":
      return `/api/scope?projectId=${q(projectId)}`;
    case "/work-progress":
      return `/api/work-progress?projectId=${q(projectId)}`;
    case "/permits":
      return `/api/permits?projectId=${q(projectId)}&all=true`;
    case "/moms":
      return `/api/moms?projectId=${q(projectId)}`;
    case "/drawings":
      return `/api/drawings?projectId=${q(projectId)}`;
    case "/documents":
      return `/api/documents?linkedEntityType=project&linkedEntityId=${q(projectId)}`;
    case "/labour":
      return `/api/labour-roster?projectId=${q(projectId)}`;
    case "/materials":
      return `/api/materials/master?projectId=${q(projectId)}`;
    default:
      return null;
  }
}

/**
 * The two screens the dashboard speculates on while the user reads it: the
 * two a site engineer opens most, and the two slowest lists.
 */
export const DASHBOARD_SPECULATION_ROUTES = ["/scope", "/work-progress"] as const;
