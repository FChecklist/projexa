// Small pure URL helpers shared by the matcher, the catalogue and the return trail. Only same-origin PATHS are ever produced.

/** Adds (or replaces) one query parameter on a relative URL, keeping any #fragment. */
export function withParam(url: string, key: string, value: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = rest.indexOf("?");
  const path = qAt >= 0 ? rest.slice(0, qAt) : rest;
  const params = new URLSearchParams(qAt >= 0 ? rest.slice(qAt + 1) : "");
  params.set(key, value);
  return `${path}?${params.toString()}${hash}`;
}

/** Removes one query parameter from a relative URL. */
export function withoutParam(url: string, key: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = rest.indexOf("?");
  if (qAt < 0) return url;
  const path = rest.slice(0, qAt);
  const params = new URLSearchParams(rest.slice(qAt + 1));
  params.delete(key);
  const q = params.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

export function pathOf(url: string): string {
  return url.split(/[?#]/)[0] || "/";
}

/** Where the screen the person is on lives, as one URL. */
export function hereOf(c: { route: string; search: string }): string {
  const s = c.search ? (c.search.startsWith("?") ? c.search : `?${c.search}`) : "";
  return `${c.route || "/"}${s}`;
}

/**
 * The LIST that a create screen belongs to: "/permits/new" -> "/permits", "/projects/new" -> "/projects"; any other screen is its own list.
 * The project the person is working in is kept.
 */
export function listUrlFor(c: { route: string; projectId?: string }): string {
  const route = (c.route || "/").replace(/\/new\/?$/, "") || "/";
  return c.projectId ? withParam(route, "projectId", c.projectId) : route;
}
