// Builds the GuideContext (what is known about a failure) from whatever a screen caught: an ApiError from fetchJson, a thrown network error, a
// useSubmit failure, a render error. Pure apart from reading window.location for the screen the person is on.

import type { GuideContext } from "./types";

/** Properties fetch-json.ts attaches to every error it throws. */
export type ErrorFacts = { status?: number; code?: string; apiPath?: string; method?: string };

export function currentScreen(): { route: string; search: string } {
  if (typeof window === "undefined") return { route: "/", search: "" };
  return { route: window.location.pathname || "/", search: window.location.search || "" };
}

/** The path of a request, without host or query. */
export function apiPathOf(input: unknown): string | undefined {
  try {
    let raw = "";
    if (typeof input === "string") raw = input;
    else if (input instanceof URL) raw = input.pathname;
    else if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") raw = (input as { url: string }).url;
    if (!raw) return undefined;
    return raw.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0] || undefined;
  } catch {
    return undefined;
  }
}

/** What the backend named as the field a refusal is about: {field:"name"} or {errors:[{field}]} or {details:{field}}; undefined when it named none. */
export function fieldFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.field === "string" && b.field) return b.field;
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  for (const k of ["errors", "details", "issues"]) {
    const f = first(b[k]);
    if (f && typeof f === "object") {
      const o = f as Record<string, unknown>;
      if (typeof o.field === "string" && o.field) return o.field;
      if (Array.isArray(o.path) && typeof o.path[0] === "string") return o.path[0];
    }
  }
  return undefined;
}

export function projectIdFromSearch(search: string): string | undefined {
  try {
    return new URLSearchParams(search).get("projectId") || undefined;
  } catch {
    return undefined;
  }
}

/** The context for a caught error. `extra` carries what only the screen knows (the field, the entity). */
export function contextFromError(err: unknown, extra: Partial<GuideContext> = {}): GuideContext {
  const screen = currentScreen();
  const facts = (err && typeof err === "object" ? err : {}) as ErrorFacts & { name?: string; message?: string; body?: unknown };
  const name = typeof facts.name === "string" ? facts.name : "";
  let status = typeof facts.status === "number" ? facts.status : undefined;
  let code = typeof facts.code === "string" ? facts.code : undefined;
  if (status === undefined && !code) {
    if (name === "TimeoutError" || name === "AbortError") code = "TIMEOUT";
    else if (name === "TypeError") code = "OFFLINE";
  }
  if (code === "OFFLINE" || code === "TIMEOUT") status = status ?? 0;
  return {
    route: screen.route,
    search: screen.search,
    projectId: projectIdFromSearch(screen.search),
    serverMessage: err instanceof Error ? err.message : typeof err === "string" ? err : undefined,
    status,
    code,
    apiPath: facts.apiPath,
    method: facts.method,
    field: fieldFromBody(facts.body),
    ...extra,
  };
}

/** The context for a failure produced by useSubmit (see SubmitFailure's optional facts). */
export type FailureFacts = { kind: string; message: string; status?: number; code?: string; serverMessage?: string; apiPath?: string; method?: string; field?: string };

export function contextFromFailure(f: FailureFacts, extra: Partial<GuideContext> = {}): GuideContext {
  const screen = currentScreen();
  let code = f.code;
  let status = f.status;
  if (!code) {
    if (f.kind === "timeout") code = "TIMEOUT";
    else if (f.kind === "unreachable") code = "OFFLINE";
    else if (f.kind === "not-sent") code = "NOT_SENT";
    else if (f.kind === "unconfirmed") code = "UNCONFIRMED";
  }
  if ((code === "OFFLINE" || code === "TIMEOUT") && status === undefined) status = 0;
  return {
    route: screen.route,
    search: screen.search,
    projectId: projectIdFromSearch(screen.search),
    // The form's own sentence is the server's words for a refusal the form made itself.
    serverMessage: f.serverMessage ?? (f.kind === "not-sent" || f.kind === "unconfirmed" ? f.message : undefined),
    status,
    code,
    apiPath: f.apiPath,
    method: f.method,
    field: f.field,
    ...extra,
  };
}
