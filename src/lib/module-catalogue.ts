// R67 WS-A (A-01, A-02) -- PROJEXA'S OWN MODULE CATALOGUE.
//
// WHY IT LIVES HERE AND NOT IN THE KIT OR IN THE DATABASE (correction C-12,
// decision D-09): the card/leaf catalogue is PRODUCT data, not a generic
// mechanism. @fchecklist/veridian-ui-kit is a shared release dependency whose
// source is not in this repo, and platform.mode_pills has no reader in any
// codebase today -- a row there is governance documentation, not a source of
// truth. So the one place a route, its module name, its leaf actions and its
// example prompts are written down is this file.
//
// WHAT IT IS FOR:
//   A-01  the composer must never offer a pill whose only destination is the
//         screen the user is already standing on ("Dashboard" on /dashboard).
//   A-02  on a module route the composer must ALREADY KNOW the module: the
//         strip reads "<project> > Permits" the moment the screen opens, the
//         placeholder is the module's own, and its leaves are real routes --
//         the same URLs the screen's own header buttons produce, so the same
//         name reaches the same destination whichever path you took.
//
// EVERY ROUTE BELOW IS A REAL, SHIPPED page.tsx. module-catalogue.test.ts
// asserts that against nav-routes.ts's SHIPPED_ROUTES in both directions, so a
// leaf can never point at a page that does not exist.

export type ModuleLeaf = {
  /** Stable id; also the chain segment id, so a leaf appears once in the strip. */
  id: string;
  /** The word the user reads. Verb-first where the leaf is an action. */
  label: string;
  /** The real route, exactly as the screen's own control produces it. */
  path: string;
  /** Extra query the leaf carries beyond projectId (e.g. withinDays=30). */
  query?: Readonly<Record<string, string>>;
  /** False for leaves that are meaningful org-wide (a catalogue, a list). */
  needsProject?: boolean;
};

export type ModuleDef = {
  /** Stable id, used as the chain segment id for the module itself. */
  id: string;
  /** The word the user reads, and the strip's second segment. */
  label: string;
  /** The module's own list route. */
  route: string;
  /**
   * Every route prefix that belongs to this module, longest first. A create or
   * object route ("/permits/new", "/permits/abc") is the same module as its
   * list, which is what stops the strip describing another screen's task.
   */
  prefixes: readonly string[];
  /**
   * Keys the SERVER may use for this module in compliance.pill_usage.pillKey
   * (free text, so it can carry anything), plus the kit's own universal pill
   * keys where one maps. Labels are matched separately, case- and
   * separator-insensitively, so "Minutes of Meeting" finds this module too.
   */
  pillKeys: readonly string[];
  /** The composer's placeholder on this module's routes (A-02). */
  placeholder: string;
  /** Shown under the input as two worked examples (A-02). */
  examples: readonly [string, string];
  /** The module's leaf actions, in the order the strip offers them. */
  leaves: readonly ModuleLeaf[];
  /**
   * A-02. FALSE for a screen that is not a module you build a task in --
   * today only the Dashboard, which IS the grouped module directory rather
   * than a module of its own. Such a screen still matches pills (so
   * "Dashboard" is not offered on /dashboard) but never becomes a fixed
   * segment in the strip, because "Dashboard >" is not the start of a
   * sentence anyone finishes.
   */
  chainModule?: boolean;
  /**
   * The words used when a leaf needs a project and none is resolved (A-02,
   * A-03). Defaults to "Choose a project for <label>" when absent.
   */
  noProjectPrompt?: string;
};

export const MODULE_CATALOGUE: readonly ModuleDef[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    route: "/dashboard",
    prefixes: ["/dashboard"],
    chainModule: false,
    pillKeys: ["dashboard"],
    placeholder: "Ask about this project, or type what you need.",
    examples: ["how much of the BOQ is complete", "which permits expire this month"],
    leaves: [
      { id: "dashboard.project", label: "Project dashboard", path: "/dashboard/project" },
      { id: "dashboard.hierarchy", label: "Company hierarchy", path: "/dashboard/hierarchy", needsProject: false },
    ],
  },
  {
    id: "permits",
    label: "Permits",
    route: "/permits",
    prefixes: ["/permits"],
    pillKeys: ["permits", "permit"],
    placeholder: "e.g. add the building permit for Villa 21, expiring 30 Nov",
    examples: ["add the building permit for Villa 21, expiring 30 Nov", "which permits expire in the next 30 days"],
    leaves: [
      { id: "permits.new", label: "New", path: "/permits/new" },
      { id: "permits.expiring", label: "Expiring soon", path: "/permits", query: { withinDays: "30" } },
      { id: "permits.open", label: "Open", path: "/permits" },
    ],
  },
  {
    id: "drawings",
    label: "Drawings & 3D",
    route: "/drawings",
    prefixes: ["/drawings", "/floor-plans"],
    pillKeys: ["drawings", "drawings_3d"],
    placeholder: "e.g. upload revision C of the ground floor plan",
    examples: ["upload revision C of the ground floor plan", "which drawings changed this week"],
    leaves: [
      { id: "drawings.new", label: "New", path: "/drawings/new" },
      { id: "drawings.open", label: "Open", path: "/drawings" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    route: "/documents",
    prefixes: ["/documents"],
    pillKeys: ["documents"],
    placeholder: "e.g. file the signed contract under this project",
    examples: ["file the signed contract under this project", "which documents were added this month"],
    leaves: [
      { id: "documents.upload", label: "Upload", path: "/documents/upload" },
      { id: "documents.open", label: "Open", path: "/documents" },
    ],
  },
  {
    id: "moms",
    label: "Minutes of Meeting",
    route: "/moms",
    prefixes: ["/moms", "/meetings"],
    pillKeys: ["minutes_of_meeting", "moms", "mom"],
    noProjectPrompt: "Choose a project for these minutes",
    placeholder: "Ask about this project's meetings, or type minutes to file…",
    examples: ["file the minutes of today's site meeting", "what was decided about the lift shaft"],
    leaves: [
      { id: "moms.new", label: "New Meeting", path: "/moms/new" },
      { id: "moms.open", label: "Open", path: "/moms" },
    ],
  },
  {
    id: "scope",
    label: "Scope of Work",
    route: "/scope",
    prefixes: ["/scope"],
    pillKeys: ["scope", "scope_of_work", "boq"],
    placeholder: "e.g. create a revision of the current BOQ",
    examples: ["create a revision of the current BOQ", "what is the contract value of this project"],
    leaves: [
      { id: "scope.new", label: "New BOQ", path: "/scope/new" },
      { id: "scope.open", label: "Open", path: "/scope" },
    ],
  },
  {
    id: "work-progress",
    label: "Work Progress",
    route: "/work-progress",
    prefixes: ["/work-progress"],
    pillKeys: ["work_progress", "progress", "analysis"],
    placeholder: "e.g. 12 nos of R60SK-A done today, 40%",
    examples: ["12 nos of R60SK-A done today, 40%", "run the WPR for this month"],
    leaves: [
      { id: "work-progress.entry", label: "Record progress", path: "/work-progress", query: { tab: "entry" } },
      { id: "work-progress.report", label: "Run WPR", path: "/work-progress", query: { tab: "report", run: "1" } },
      { id: "work-progress.analytics", label: "Analytics", path: "/work-progress", query: { tab: "analytics" } },
    ],
  },
  {
    id: "labour",
    label: "Manpower",
    route: "/labour",
    prefixes: ["/labour"],
    pillKeys: ["labour", "manpower"],
    placeholder: "e.g. mark all masons present today",
    examples: ["mark all masons present today", "who was absent yesterday"],
    leaves: [
      { id: "labour.attendance", label: "Mark attendance", path: "/labour/attendance/new" },
      { id: "labour.new", label: "New worker", path: "/labour/new" },
      { id: "labour.open", label: "Open", path: "/labour" },
    ],
  },
  {
    id: "materials",
    label: "Material",
    route: "/materials",
    prefixes: ["/materials", "/site-materials"],
    pillKeys: ["materials", "material"],
    placeholder: "e.g. record 20 bags of cement received today",
    examples: ["record 20 bags of cement received today", "what is the current stock of TMT bars"],
    leaves: [
      { id: "materials.receipt", label: "Record receipt", path: "/materials/receipts/new" },
      { id: "materials.new", label: "New material", path: "/materials/new" },
      { id: "materials.open", label: "Open", path: "/materials" },
    ],
  },
  {
    id: "budgets",
    label: "Budget",
    route: "/budgets",
    prefixes: ["/budgets"],
    pillKeys: ["budget", "budgets"],
    placeholder: "e.g. what is budget versus actual on this project",
    examples: ["what is budget versus actual on this project", "add a budget line for site overheads"],
    leaves: [
      { id: "budgets.new", label: "New budget", path: "/budgets/new" },
      { id: "budgets.open", label: "Open", path: "/budgets" },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    route: "/schedule",
    prefixes: ["/schedule"],
    pillKeys: ["schedule", "calendar", "task_master", "tasks"],
    placeholder: "e.g. log 2 hours on the shuttering task today",
    examples: ["log 2 hours on the shuttering task today", "which tasks are late this week"],
    leaves: [
      { id: "schedule.task", label: "New task", path: "/schedule/tasks/new" },
      { id: "schedule.time", label: "Log time", path: "/schedule/log-time" },
      { id: "schedule.open", label: "Open", path: "/schedule" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    route: "/reports",
    prefixes: ["/reports"],
    pillKeys: ["reports", "report"],
    placeholder: "e.g. run the work progress report for January",
    examples: ["run the work progress report for January", "show me the vendor cost report"],
    leaves: [{ id: "reports.open", label: "Open", path: "/reports", needsProject: false }],
  },
] as const;

/** Normalises a pill key or a human label to the catalogue's own key shape. */
export function normalisePillKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * The module a pathname belongs to. Longest prefix wins, so "/work-progress"
 * is never mistaken for a prefix of another module and "/permits/new" resolves
 * to Permits rather than to nothing.
 */
export function moduleForPathname(pathname: string): ModuleDef | null {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  let best: ModuleDef | null = null;
  let bestLength = -1;
  for (const mod of MODULE_CATALOGUE) {
    for (const prefix of mod.prefixes) {
      if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = mod;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * The module a pill stands for. The server's pillKey is free text
 * (compliance.pill_usage.pillKey), so both the key and the rendered label are
 * tried -- a backend that ranks "Minutes of Meeting" and one that ranks
 * "minutes_of_meeting" must reach the same module.
 */
export function moduleForPill(pillKey: string, label?: string): ModuleDef | null {
  const candidates = [normalisePillKey(pillKey), label ? normalisePillKey(label) : ""].filter(Boolean);
  for (const candidate of candidates) {
    for (const mod of MODULE_CATALOGUE) {
      if (mod.id === candidate) return mod;
      if (normalisePillKey(mod.label) === candidate) return mod;
      if (mod.pillKeys.some((k) => normalisePillKey(k) === candidate)) return mod;
    }
  }
  return null;
}

/**
 * A-01: TRUE when a pill's only destination is the screen already on show.
 * "Dashboard" must never be offered on /dashboard, nor "Work Progress" on
 * /work-progress -- a control that cannot change anything is a dead end.
 */
export function pillPointsAtCurrentScreen(pillKey: string, label: string | undefined, pathname: string): boolean {
  const screen = moduleForPathname(pathname);
  if (!screen) return false;
  return moduleForPill(pillKey, label)?.id === screen.id;
}

/** Builds a real href, carrying the project the user is working in. */
export function moduleHref(
  target: { path: string; query?: Readonly<Record<string, string>>; needsProject?: boolean },
  projectId: string | null
): string {
  const params = new URLSearchParams(target.query ?? {});
  if (projectId && target.needsProject !== false) params.set("projectId", projectId);
  const qs = params.toString();
  return qs ? `${target.path}?${qs}` : target.path;
}

/** The module's own list route, with the project carried. */
export function moduleRoute(mod: ModuleDef, projectId: string | null): string {
  return moduleHref({ path: mod.route }, projectId);
}

/**
 * A-02. The module the composer's strip should ALREADY be describing on this
 * pathname -- the screen's own module, unless the screen is not a module you
 * build a task in (the Dashboard). Distinct from moduleForPathname(), which
 * answers the pill question and must still match the Dashboard.
 */
export function chainModuleForPathname(pathname: string): ModuleDef | null {
  const mod = moduleForPathname(pathname);
  return mod && mod.chainModule !== false ? mod : null;
}

/** The words shown when a leaf needs a project and none is resolved. */
export function noProjectPromptFor(mod: ModuleDef): string {
  return mod.noProjectPrompt ?? `Choose a project for ${mod.label}`;
}

/**
 * A-03 -- THE SEAM FOR WS-B'S CHAIN-OPTIONS ENDPOINT.
 *
 * The second level of the chain (Permits > New | Expiring soon | Open) is
 * server-owned in the finished design: WS-B is building an endpoint that
 * answers "what are this module's next options for this user". It does not
 * exist yet -- the repo has capability-tree and module-chain, which return the
 * WHOLE tree, and nothing that answers one level.
 *
 * So the leaves are hard-coded in the catalogue above, but every caller asks
 * for them THROUGH this function rather than reading `.leaves` directly. When
 * the endpoint lands, this body is the only thing that changes.
 */
export function chainOptionsFor(mod: ModuleDef): readonly ModuleLeaf[] {
  return mod.leaves;
}

/** Every distinct route the catalogue can navigate to (used by its test). */
export function catalogueRoutes(): string[] {
  const routes = new Set<string>();
  for (const mod of MODULE_CATALOGUE) {
    routes.add(mod.route);
    for (const leaf of mod.leaves) routes.add(leaf.path);
  }
  return [...routes].sort();
}
