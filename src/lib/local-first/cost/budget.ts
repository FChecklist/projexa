// LOCAL-FIRST COST (requirements R14 "cost near zero" and G4 "our server minimal"): the request budget a laptop must stay
// inside, and the arithmetic that turns "requests a laptop made in a measured day" into "how many laptops the free plan
// carries". Pure: no clock, no network. The numbers that feed it come from the harness (harness.ts) driving the REAL sync
// client, replica, outbox, scheduler, jobs poller and shell bootstrap against the fake sync server.
//
// THE QUOTA. Supabase free plan: 500,000 Edge Function invocations a month, shared by EVERY laptop of every organisation
// (https://supabase.com/pricing; "to verify" in the backend cost model, scripts/verify/projexa-local-first-cost-model.mjs,
// compliance-tracker). One HTTP request to projexa-sync is one invocation. A push costs MORE than one: the sync function
// runs every op through ai-work-link-exec, one more invocation per op (handler.ts execRun, index.ts) -- so a pushed op is
// counted twice here (`execOps`).
//
// THE MONTH. A working laptop is measured over one 8-hour working day; a month is 22 working days (the backend model's
// `activeDaysPerMonth`). A closed laptop costs nothing (no server, no timer), so the other days add nothing.

/** Supabase free plan Edge Function invocations a month (shared by all laptops). */
export const EDGE_FREE_MONTHLY = 500_000;
/** Working days in a month (the backend cost model uses the same 22). */
export const WORK_DAYS_PER_MONTH = 22;

/** Which projexa-sync route a request went to (the path after the function's base URL). */
export type Route =
  | "manifest" | "pull" | "pull_ids" | "changes" | "ids" | "push" | "attest"
  | "release_current" | "release_register" | "install"
  | "jobs_claim" | "jobs_heartbeat" | "jobs_result" | "jobs_enqueue" | "jobs_get"
  | "other";

export type RouteCounts = Partial<Record<Route, number>> & { execOps?: number };

/** Every Edge invocation these counts cause: one per request, plus one ai-work-link-exec run per pushed op. */
export function invocations(c: RouteCounts): number {
  let n = 0;
  for (const [k, v] of Object.entries(c)) n += typeof v === "number" ? v : 0;
  return n; // execOps is one of the entries: each pushed op is one more invocation
}

export function addCounts(a: RouteCounts, b: RouteCounts): RouteCounts {
  const out: RouteCounts = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof RouteCounts, number | undefined][]) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

export type Projection = {
  perDay: number;
  perMonth: number;
  /** How many laptops, each with this month, fit in the free quota. */
  laptopsAllowed: number;
};

/** A measured working day -> a month and the number of laptops the free quota carries. */
export function project(perWorkingDay: number, quota = EDGE_FREE_MONTHLY, days = WORK_DAYS_PER_MONTH): Projection {
  const perMonth = perWorkingDay * days;
  return { perDay: perWorkingDay, perMonth, laptopsAllowed: perMonth > 0 ? Math.floor(quota / perMonth) : Number.POSITIVE_INFINITY };
}

/**
 * The enforced ceilings, per laptop, per scenario (cost-budget.test.ts fails when a measured scenario goes over). They are set
 * a little above what the harness measures after the fixes in this package, so a future change that adds polling, a sweep or
 * a per-navigation call breaks the build instead of the bill. Raising one is a deliberate act: say why in the commit.
 */
export const SCENARIO_BUDGETS = {
  /** (a) online, tab visible, nothing changes anywhere, 8 hours. */
  idle8h: 60,
  /** (b) an 8-hour working day: 30 own edits and 30 changes made by colleagues. Includes the 30 exec runs of the pushed ops. */
  workday: 260,
  /** (c) the first sync of a person with 5 projects (28 kinds each), until the copy is complete. */
  coldStart5Projects: 5 * 28 + 5 + 4,
  /** (d) reconnecting after 3 days offline (200 changes made meanwhile): the catch-up. */
  reconnectAfter3Days: 25,
  /** (e) 10 laptops of one organisation, peers connected, each a working day of 30 edits: per laptop. */
  tenLaptopsPerLaptop: 260,
  /** The claim loop of the jobs feature, if switched on, per 8 visible hours with no job ever offered. */
  jobsClaimIdle8h: 45,
} as const;

/** The month of one working laptop must leave room for at least this many laptops in the free quota. */
export const MIN_LAPTOPS_IN_FREE_QUOTA = 80;

/** Maps a sync-service request (path relative to the function base, and its body) to its route. */
export function routeOf(path: string, body?: unknown): Route {
  const p = path.replace(/\/+$/, "");
  if (p === "/pull") return body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids) ? "pull_ids" : "pull";
  const map: Record<string, Route> = {
    "/manifest": "manifest", "/changes": "changes", "/ids": "ids", "/push": "push", "/attest": "attest",
    "/release/current": "release_current", "/release/register": "release_register", "/install": "install",
    "/jobs/claim": "jobs_claim", "/jobs/heartbeat": "jobs_heartbeat", "/jobs/result": "jobs_result", "/jobs/enqueue": "jobs_enqueue", "/jobs/get": "jobs_get",
  };
  return map[p] ?? "other";
}
