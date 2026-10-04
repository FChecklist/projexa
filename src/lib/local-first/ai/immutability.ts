// LOCAL-FIRST browser AI: the deny-list that keeps the AI surface away from the SOFTWARE (requirement R5: "the
// external / internal AI CANNOT code on this").
//
// The AI may read and change the person's DATA (R6, R7). It must never be handed anything that writes code, files, the
// service worker, the release bundle, the cache or the app configuration, and the page must never offer an eval-like
// entry point (a function that runs text as code). The surface is built so that no such function exists; this file is
// what the guard test (immutability.test.ts) uses to PROVE it on every build: it enumerates every name the surface
// exposes -- the methods of window.projexa.ai, the WebMCP tool names, the registry function ids the manual lists --
// and fails if any of them matches the deny-list.
//
// PURE.

/** Words that mark a capability over the software itself. Matched case-insensitively anywhere in a name. */
export const DENY_WORDS: readonly string[] = Object.freeze([
  "code", "script", "eval", "file", "cache", "serviceworker", "service_worker", "bundle", "release", "config",
  "function_constructor", "exec", "install", "upgrade", "deploy", "import_module",
]);

const normalise = (name: string) => name.toLowerCase().replace(/[-\s]/g, "_");

export function isDeniedName(name: string): boolean {
  const n = normalise(name);
  const squashed = n.replace(/_/g, "");
  return DENY_WORDS.some((w) => n.includes(w) || squashed.includes(w.replace(/_/g, "")));
}

export function deniedNames(names: Iterable<string>): string[] {
  return [...names].filter(isDeniedName);
}

/** Every property name reachable on an object (own and inherited, non-Object.prototype), depth-first, as dotted paths. */
export function exposedNames(root: unknown, prefix = "", seen = new Set<unknown>()): string[] {
  if ((typeof root !== "object" && typeof root !== "function") || root === null || seen.has(root)) return [];
  seen.add(root);
  const names: string[] = [];
  let proto: object | null = root as object;
  const keys = new Set<string>();
  while (proto && proto !== Object.prototype && proto !== Function.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) if (k !== "constructor" && !(typeof root === "function" && ["length", "name", "prototype"].includes(k))) keys.add(k);
    proto = Object.getPrototypeOf(proto);
  }
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    names.push(path);
    const value = (root as Record<string, unknown>)[k];
    if (typeof value === "object" && value !== null) names.push(...exposedNames(value, path, seen));
  }
  return names;
}
