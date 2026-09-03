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
  /**
   * A-06. The words the STRIP uses when the user is standing on this leaf's
   * own page, which is not always the words the BUTTON uses. The button sits
   * under a Permits heading and can afford to say "New"; the strip has to read
   * as a whole sentence -- "Cedar Heights Villa - Phase 1 › Permits › New
   * permit" -- so it needs the noun back. Absent means the leaf has no page of
   * its own (it is a filter or a tab on the module's list route) and can never
   * become the third segment.
   */
  chainLabel?: string;
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
  /**
   * FALSE for a module that is org-wide rather than project-scoped -- its
   * route must not carry a ?projectId= that means nothing there (A-05:
   * Customers and Vendors, and the Reports catalogue).
   */
  needsProject?: boolean;
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
      { id: "permits.new", label: "New", path: "/permits/new", chainLabel: "New permit" },
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
      { id: "drawings.new", label: "New", path: "/drawings/new", chainLabel: "New drawing" },
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
      { id: "documents.upload", label: "Upload", path: "/documents/upload", chainLabel: "Upload document" },
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
      { id: "moms.new", label: "New Meeting", path: "/moms/new", chainLabel: "New meeting" },
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
      { id: "scope.new", label: "New BOQ", path: "/scope/new", chainLabel: "New BOQ" },
      { id: "scope.open", label: "Open", path: "/scope" },
    ],
  },
  {
    id: "work-progress",
    label: "Work Progress",
    route: "/work-progress",
    prefixes: ["/work-progress"],
    pillKeys: ["work_progress", "progress", "analysis"],
    // A-10 supersedes A-04's placeholder here: the item names this one
    // explicitly for Work Progress, and A-04's own example survives verbatim
    // as the first of the two worked examples below the input.
    placeholder: "e.g. record 50% on excavation",
    examples: ["12 nos of R60SK-A done today, 40%", "run the WPR for this month"],
    leaves: [
      // A-04: the two verbs are verbs. "Record progress" puts the cursor in
      // the form's first field; "Run WPR" runs the report on arrival rather
      // than landing on a filled-in form with a button still to press.
      {
        id: "work-progress.entry",
        label: "Record progress",
        path: "/work-progress",
        query: { tab: "entry", focus: "activity" },
      },
      { id: "work-progress.report", label: "Run WPR", path: "/work-progress", query: { tab: "report", run: "1" } },
      // A-20: "Export CSV" is a verb too, and the file is the whole point of
      // it -- so the leaf runs the report AND exports it, rather than landing
      // the user on a report they still have to run before the export button
      // stops being useless. WorkProgressReportClient honours both parameters.
      {
        id: "work-progress.export",
        label: "Export CSV",
        path: "/work-progress",
        query: { tab: "report", run: "1", export: "csv" },
      },
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
      { id: "labour.attendance", label: "Mark attendance", path: "/labour/attendance/new", chainLabel: "Mark attendance" },
      { id: "labour.new", label: "New worker", path: "/labour/new", chainLabel: "New worker" },
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
      { id: "materials.receipt", label: "Record receipt", path: "/materials/receipts/new", chainLabel: "Record receipt" },
      { id: "materials.new", label: "New material", path: "/materials/new", chainLabel: "New material" },
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
      // R67 lane D22 (item D-41): /budgets/new no longer exists. /budgets is now
      // the PROJECT's BOQ budget -- a read of a BOQ, with nothing to create --
      // and the ERP fiscal-year ledger this leaf was really about moved intact
      // to /accounting/annual-budgets, where AppSidebar calls it "Finance
      // Budgets (ERP)". The verb still works; it just leads where the thing
      // being created now lives.
      { id: "budgets.new", label: "New finance budget", path: "/accounting/annual-budgets/new", chainLabel: "New finance budget" },
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
      { id: "schedule.task", label: "New task", path: "/schedule/tasks/new", chainLabel: "New task" },
      { id: "schedule.time", label: "Log time", path: "/schedule/log-time", chainLabel: "Log time" },
      { id: "schedule.open", label: "Open", path: "/schedule" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    route: "/reports",
    prefixes: ["/reports"],
    needsProject: false,
    pillKeys: ["reports", "report"],
    placeholder: "e.g. run the work progress report for January",
    examples: ["run the work progress report for January", "show me the vendor cost report"],
    leaves: [{ id: "reports.open", label: "Open", path: "/reports", needsProject: false }],
  },
  // A-05: Customers and Vendors were MODE TABS at the head of every control
  // strip -- three words that changed nothing but their own colour, while the
  // same three words also existed as pills. The tabs are gone and these are
  // now ordinary catalogue entries, so each word appears exactly once on
  // screen and still reaches the same destination.
  {
    id: "customers",
    label: "Customers",
    route: "/customers",
    prefixes: ["/customers"],
    needsProject: false,
    pillKeys: ["customers", "customer"],
    placeholder: "e.g. add a customer, or ask which customers have open quotations",
    examples: ["add a new customer", "which customers have open quotations"],
    leaves: [
      { id: "customers.new", label: "New customer", path: "/customers/new", needsProject: false, chainLabel: "New customer" },
      { id: "customers.open", label: "Open", path: "/customers", needsProject: false },
    ],
  },
  {
    id: "vendors",
    label: "Vendors",
    route: "/vendors",
    prefixes: ["/vendors"],
    needsProject: false,
    pillKeys: ["vendors", "vendor"],
    placeholder: "e.g. add a vendor, or ask what we owe this month",
    examples: ["add a new vendor", "which vendors worked on this project"],
    leaves: [
      { id: "vendors.new", label: "New vendor", path: "/vendors/new", needsProject: false, chainLabel: "New vendor" },
      { id: "vendors.open", label: "Open", path: "/vendors", needsProject: false },
    ],
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
export function normalisePathname(pathname: string): string {
  return pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

export function moduleForPathname(pathname: string): ModuleDef | null {
  const path = normalisePathname(pathname);
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

/** The module's own list route, with the project carried where it means
 *  something (never on an org-wide module such as Customers). */
export function moduleRoute(mod: ModuleDef, projectId: string | null): string {
  return moduleHref({ path: mod.route, needsProject: mod.needsProject }, projectId);
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
 * A-06 -- THE CREATE SENTENCE. A create page is not a different module; it is
 * the third word of the same sentence. Standing on /permits/new the strip must
 * read "Cedar Heights Villa - Phase 1 › Permits › New permit", and band 2 stays
 * empty because the page's own form IS the card -- there is nothing for the
 * composer to ask that the form is not already asking.
 *
 * It is derived from the pathname rather than pushed by a click, so it is
 * identical however the user arrived: the strip leaf, the header button, a
 * bookmark, or a hard reload.
 *
 * Only a leaf with its OWN page qualifies. A leaf that is a filter or a tab on
 * the module's list route ("Expiring soon" -> /permits?withinDays=30) shares
 * the module's pathname and would otherwise turn every visit to /permits into
 * "Permits › Open".
 */
export function createSegmentForPathname(pathname: string): { id: string; label: string } | null {
  const path = normalisePathname(pathname);
  const mod = chainModuleForPathname(path);
  if (!mod) return null;
  for (const leaf of mod.leaves) {
    if (leaf.path === path && leaf.path !== mod.route && leaf.chainLabel) {
      return { id: `screen:${leaf.id}`, label: leaf.chainLabel };
    }
  }
  return null;
}

/**
 * A-06 -- ELLIPSIS AT A WORD, NOT MID-WORD. CSS `truncate` cuts wherever the
 * pixel runs out, so "Cedar Heights Villa - Phase 1" became "Cedar Heights Vil…"
 * -- a project name the user cannot check at a glance, in the one place the
 * product is least able to afford ambiguity about which project is being
 * written to. This cuts at the last whole word that fits and the caller shows
 * the full name as a title tooltip, so nothing is lost, only folded.
 *
 * A single word longer than the budget is still cut hard: there is no word
 * boundary to fall back to, and a name that overflows its line is worse than
 * one that is visibly abbreviated.
 */
export function truncateSegmentLabel(label: string, max = 28): string {
  const text = label.trim();
  if (max <= 1 || text.length <= max) return text;
  const budget = max - 1; // one character is spent on the ellipsis itself
  const head = text.slice(0, budget);
  // If the very next character is a space, the head already ENDS on a word
  // boundary and folding back further would throw away a whole word that fit.
  const endsCleanly = text.charAt(budget) === " ";
  const lastSpace = head.lastIndexOf(" ");
  const cut = endsCleanly || lastSpace <= Math.floor(budget / 2) ? head : head.slice(0, lastSpace);
  // A fold that lands on a dangling separator ("Cedar Heights Villa -…") reads
  // as a broken name rather than a shortened one.
  return `${cut.replace(/[\s\-–—:,;]+$/, "")}…`;
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
