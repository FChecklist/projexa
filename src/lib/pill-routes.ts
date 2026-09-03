// R67 WS-A (A-17) -- WHERE EVERY PILL GOES, WRITTEN DOWN ONCE.
//
// THE DEFECT THIS CLOSES. A pill's destination used to be decided inside a
// click handler by a chain of conditions -- does the catalogue know a module
// for this key, is there a functionId, is there a route -- and the branch that
// caught everything else TYPED THE PILL'S OWN NAME INTO THE TEXTAREA. So
// "Analysis" put the word "Analysis" in the box and handed it to a classifier,
// while a real analytics screen sat one URL away. A-17's answer is a table: a
// pill key maps to a destination, the mapping is data, and a key with no
// destination cannot render at all (A-11).
//
// WHAT COUNTS AS A DESTINATION, AND WHY THERE ARE FOUR KINDS:
//
//   "module"    the second level is VERBS, not a page. Picking Permits writes
//               "Permits" into the strip and offers New · Expiring soon · Open
//               underneath it, and it is the VERB that opens a route. This is
//               binding (D-08, correction C-09), and it is why A-17's own
//               "module pills open their real route" rule survives here only
//               for the kinds below: A-11/A-12 already moved module pills to
//               the verb model, and A-17 says itself that it "remains the rule
//               for multi-field leaves per C-09".
//
//   "view"      a NAMED VIEW rather than a module -- Analysis, Tasks, Calendar,
//               Dashboard. "Analysis" is not a noun you build a sentence from;
//               it IS the screen. These navigate directly, exactly as A-17
//               asks, carrying the current project where the view is
//               project-scoped, and they never touch the input.
//
//   "rail"      "Projects" has no /projects page in PROJEXA; the control that
//               chooses a project is the top rail. The click moves keyboard
//               focus there -- a pointer at the real control, not a dead end.
//
//   "platform"  the name belongs to VERIDIAN and has no PROJEXA screen at all.
//               A-17: "otherwise the band-2 line 'Not part of PROJEXA — open
//               VERIDIAN' with the platform link". It is a real destination,
//               which is what lets it stay in the list under owner approval
//               D-10 ("the same name still reaches the same destination")
//               without becoming a permanent non-control.
//
// TWO OF THE FOUR "no PROJEXA screen" PILLS TURN OUT TO HAVE ONE. A-17 says
// "their platform routes where nav-routes has one", so the registry was
// checked rather than assumed: Policies is /grc?tab=policies and Department is
// /employees?tab=departments, both shipped, both real tabs of shipped screens.
// Only Email and Teams have nothing, and only those two get the VERIDIAN line.

import { MODULE_CATALOGUE, moduleHref, normalisePillKey, normalisePathname } from "./module-catalogue";

export type PillTarget =
  /** The second level is this module's verbs (D-08 / C-09). */
  | { kind: "module"; moduleId: string }
  /** A named view. Navigates straight there. */
  | { kind: "view"; path: string; query?: Readonly<Record<string, string>>; needsProject?: boolean }
  /** The top rail's own project control. */
  | { kind: "rail" }
  /** Not part of PROJEXA. Offers the VERIDIAN link in band 2. */
  | { kind: "platform" };

/** The words band 2 shows for a platform-only name (A-17, verbatim). */
export const NOT_IN_PROJEXA = "Not part of PROJEXA — open VERIDIAN";

/**
 * The link itself is a REDIRECT ROUTE, not a hard-coded origin. VERIDIAN's
 * origin is a server-side environment value (VERIDIAN_API_BASE_URL, read in
 * src/lib/veridian-client.ts, which imports the database and can never run in
 * the browser). Writing the production hostname into a client component would
 * be a guess about the deployment that goes stale silently; a redirect that
 * resolves the configured origin server-side cannot.
 */
export const VERIDIAN_LINK = "/api/veridian-link";

/**
 * THE TABLE. Keys are the free-text pillKey values compliance.pill_usage may
 * hold and the kit's own universal pill keys; they are matched after
 * normalisation, so "Minutes of Meeting" and "minutes_of_meeting" are one key.
 */
export const PILL_ROUTES: Readonly<Record<string, PillTarget>> = {
  // Sumeet's modules -- verbs, per D-08.
  permits: { kind: "module", moduleId: "permits" },
  drawings: { kind: "module", moduleId: "drawings" },
  drawings_and_3d: { kind: "module", moduleId: "drawings" },
  documents: { kind: "module", moduleId: "documents" },
  minutes_of_meeting: { kind: "module", moduleId: "moms" },
  moms: { kind: "module", moduleId: "moms" },
  scope: { kind: "module", moduleId: "scope" },
  scope_of_work: { kind: "module", moduleId: "scope" },
  work_progress: { kind: "module", moduleId: "work-progress" },
  manpower: { kind: "module", moduleId: "labour" },
  labour: { kind: "module", moduleId: "labour" },
  materials: { kind: "module", moduleId: "materials" },
  material: { kind: "module", moduleId: "materials" },
  budget: { kind: "module", moduleId: "budgets" },
  budgets: { kind: "module", moduleId: "budgets" },
  schedule: { kind: "module", moduleId: "schedule" },
  reports: { kind: "module", moduleId: "reports" },
  customers: { kind: "module", moduleId: "customers" },
  vendors: { kind: "module", moduleId: "vendors" },

  // Named views. Each is a screen, not a noun you build a sentence from.
  dashboard: { kind: "view", path: "/dashboard" },
  analysis: { kind: "view", path: "/work-progress", query: { tab: "analytics" } },
  // The kit merges task_master and to_do into ONE pill labelled "Tasks"
  // (pillConfig.ts MERGED_TASKS_PILL / TASKS_PILL_MERGED), which is the pill
  // A-17 maps; both keys resolve to the same board so a stored usage row under
  // either one still reaches it.
  task_master: { kind: "view", path: "/schedule", query: { tab: "board" } },
  tasks: { kind: "view", path: "/schedule", query: { tab: "board" } },
  to_do: { kind: "view", path: "/schedule", query: { tab: "board" } },
  calendar: { kind: "view", path: "/schedule" },
  // Checked against nav-routes rather than assumed: both are shipped tabs of
  // shipped screens, so neither needs the VERIDIAN line.
  policies: { kind: "view", path: "/grc", query: { tab: "policies" }, needsProject: false },
  department: { kind: "view", path: "/employees", query: { tab: "departments" }, needsProject: false },

  // The rail is the control that answers this one.
  projects: { kind: "rail" },

  // No PROJEXA screen of any kind.
  email: { kind: "platform" },
  teams: { kind: "platform" },
};

/** The destination for a pill key or a rendered label, or null if it has none. */
export function pillTargetFor(key: string, label?: string): PillTarget | null {
  const candidates = [normalisePillKey(key), label ? normalisePillKey(label) : ""].filter(Boolean);
  for (const candidate of candidates) {
    const direct = PILL_ROUTES[candidate];
    if (direct) return direct;
  }
  return null;
}

/**
 * The URL a "view" pill opens. The project is carried where the view is
 * project-scoped and omitted where it means nothing (the org's own GRC and
 * employee screens), so a pill never adds a parameter the screen ignores.
 */
export function pillHref(target: PillTarget, projectId: string | null): string | null {
  if (target.kind !== "view") return null;
  return moduleHref({ path: target.path, query: target.query, needsProject: target.needsProject }, projectId);
}

/**
 * A-17: "The pill carries aria-pressed while its route is open."
 *
 * For a VIEW that is the pathname plus every query value the view names -- a
 * pill for /schedule?tab=board is not "open" while the timeline tab is showing,
 * because the user is looking at a different screen than the one the pill
 * opens. For a MODULE it is the module the user is standing in, since a module
 * pill navigates nowhere itself; its verbs do.
 */
export function isPillRouteOpen(
  target: PillTarget,
  pathname: string,
  search: string | URLSearchParams = ""
): boolean {
  const path = normalisePathname(pathname);
  if (target.kind === "view") {
    if (path !== normalisePathname(target.path)) return false;
    const params = typeof search === "string" ? new URLSearchParams(search) : search;
    return Object.entries(target.query ?? {}).every(([k, v]) => params.get(k) === v);
  }
  if (target.kind === "module") {
    const mod = MODULE_CATALOGUE.find((m) => m.id === target.moduleId);
    if (!mod) return false;
    return mod.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
  return false;
}

/** Every distinct path a "view" pill can open (used by this module's test). */
export function pillViewRoutes(): string[] {
  const routes = new Set<string>();
  for (const target of Object.values(PILL_ROUTES)) {
    if (target.kind === "view") routes.add(target.path);
  }
  return [...routes].sort();
}
