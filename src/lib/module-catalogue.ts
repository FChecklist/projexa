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
    // R67 B-02 quotes its two prompts for /scope as well as /budgets. Only one
    // of them is a sentence about SCOPE -- budget % is a column on a BOQ line
    // (drizzle/0322_construction_boq_budget_percentage.sql), so "set budget %
    // on all civil lines" is a real scope-of-work edit. The other ("budget vs
    // actual by category") is a budget REPORT and belongs on /budgets, where it
    // ships verbatim; putting it here would advertise the wrong screen. So this
    // route keeps lane A's own scope sentence and gains B-02's scope one.
    placeholder: "e.g. Set budget % to 30 on all civil lines",
    examples: ["Set budget % to 30 on all civil lines", "create a revision of the current BOQ"],
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
    // R67 MERGE (D-11, lane E2's E-27) LEFT THIS HALF BEHIND. "analysis" was
    // listed here from the world in which "Analysis" MEANT this module's own
    // ?tab=analytics leaf. E-27 fixed that on the DESTINATION side --
    // pill-routes.ts now sends the pill to the /analysis hub that lists all
    // four analysis screens -- but the RESOLUTION side still claimed the word,
    // and moduleForPill() scans in array order, so this entry (index 6) beat
    // the `analysis` module's own id (index 38). The consequence was A-01
    // exactly inverted: "Analysis" greyed out as "you are here" on
    // /work-progress, which it does not open, and live on /analysis, which it
    // does. The word belongs to the hub. This module is still found by
    // "work_progress", "progress", its own id and its own label, and its
    // analytics TAB is reached by its leaf and by composer-cards.ts's
    // route+tab table -- neither of which goes through moduleForPill().
    pillKeys: ["work_progress", "progress"],
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
    // R80 Part 5 GAP-1: "/budgets" alone was a lie by omission. All three
    // /budgets/* routes are pure redirects into /finance/budgets/* (D-62), and
    // this module's own create leaf sends the user to /finance/budgets/new --
    // a route the catalogue then failed to recognise, so moduleForPathname()
    // returned null the moment the redirect landed and the strip dropped both
    // the module segment AND the project root. The catalogue was navigating
    // the user off itself. The real screens live under /finance/budgets.
    prefixes: ["/budgets", "/finance/budgets"],
    pillKeys: ["budget", "budgets"],
    // R67 B-02: the two prompts the item quotes verbatim. A user standing on a
    // budget had no way to know the composer could CHANGE one -- both of lane
    // A's originals here were questions, so the screen only ever advertised
    // reading. One of these two is a write, which is the point.
    placeholder: "e.g. Set budget % to 30 on all civil lines",
    examples: ["Set budget % to 30 on all civil lines", "Show budget vs actual by category for this project"],
    leaves: [
      // R67 lane D22 (item D-41) x R67 D-62, reconciled at the integration
      // merge: both lanes moved the ERP fiscal-year ledger out of "Budgets",
      // and D-62's address is the one that shipped -- /finance/budgets, with
      // /budgets/* kept as redirects so existing links still land. The verb
      // still works; it just leads where the thing being created now lives.
      { id: "budgets.new", label: "New finance budget", path: "/finance/budgets/new", chainLabel: "New finance budget" },
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

  // ==========================================================================
  // R80 Part 5, GAP-2 and GAP-3. Everything below this line closes the single
  // largest left/right sync gap the audit found: 116 of 175 shipped routes
  // (66%) matched no prefix in this array, so moduleForPathname() returned
  // null, chainModuleForPathname() returned null with it, and M24Shell emitted
  // NO module segment. The right-hand screen rendered fine; the left strip
  // simply could not say what the user was looking at.
  //
  // This was never a claim that those screens did not exist -- nav-routes.ts's
  // SHIPPED_ROUTES has listed all 175 for weeks, and module-catalogue.test.ts
  // has been asserting the one direction that was true (no leaf points at a
  // dead page) while the other direction went unmeasured. The catalogue had
  // simply not been extended past the original 14 construction modules as the
  // ERP surface grew underneath it.
  //
  // Two routes are STILL deliberately uncatalogued and that is not an
  // oversight: "/settings" (module-catalogue.test.ts asserts it resolves to
  // null -- it is chrome, not a module you build a task in) and "/copilot"
  // (the assistant surface IS the composer; a "Copilot >" segment would have
  // the strip offer to navigate the user to the thing they are typing into).
  // ==========================================================================

  {
    id: "design-studio",
    label: "Design Studio",
    route: "/design-studio",
    prefixes: ["/design-studio"],
    pillKeys: ["design_studio", "design", "timesheets", "timesheet"],
    placeholder: "e.g. log 6 hours of drafting on the villa elevations",
    examples: ["log 6 hours of drafting on the villa elevations", "show design hours against budget this month"],
    leaves: [
      { id: "design-studio.timesheet", label: "Log timesheet", path: "/design-studio/timesheets/new", chainLabel: "New timesheet" },
      { id: "design-studio.cost", label: "Cost analysis", path: "/design-studio/cost-analysis", chainLabel: "Cost analysis" },
      { id: "design-studio.review", label: "Review", path: "/design-studio/review", chainLabel: "Design review" },
      { id: "design-studio.open", label: "Open", path: "/design-studio" },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    route: "/accounting",
    prefixes: ["/accounting"],
    needsProject: false,
    pillKeys: ["accounting", "journal", "journal_entries", "ledger"],
    placeholder: "e.g. post a journal entry for the October site rent",
    examples: ["post a journal entry for the October site rent", "show the trial balance for this quarter"],
    leaves: [
      { id: "accounting.journal", label: "New journal entry", path: "/accounting/journal-entries/new", needsProject: false, chainLabel: "New journal entry" },
      { id: "accounting.company", label: "New company", path: "/accounting/companies/new", needsProject: false, chainLabel: "New company" },
      { id: "accounting.open", label: "Open", path: "/accounting", needsProject: false },
    ],
  },
  {
    id: "procurement",
    label: "Procurement",
    route: "/procurement",
    // GAP-10: purchase orders are split across two route families -- create and
    // list at /purchase-orders, the object page at /procurement/purchase-orders
    // /[id]. Both belong to this module, so the strip keeps saying "Procurement"
    // across the whole flow instead of losing the module on the object page.
    prefixes: ["/procurement", "/purchase-orders"],
    needsProject: false,
    pillKeys: ["procurement", "purchase_orders", "purchase_order", "po", "buying"],
    placeholder: "e.g. raise a purchase order for 200 bags of cement",
    examples: ["raise a purchase order for 200 bags of cement", "which purchase orders are still awaiting delivery"],
    leaves: [
      { id: "procurement.po", label: "New purchase order", path: "/purchase-orders/new", needsProject: false, chainLabel: "New purchase order" },
      { id: "procurement.requisition", label: "New requisition", path: "/procurement/requisitions/new", needsProject: false, chainLabel: "New requisition" },
      { id: "procurement.rfq", label: "New RFQ", path: "/procurement/rfqs/new", needsProject: false, chainLabel: "New RFQ" },
      { id: "procurement.quotation", label: "New supplier quotation", path: "/procurement/quotations/new", needsProject: false, chainLabel: "New supplier quotation" },
      { id: "procurement.grn", label: "Record goods receipt", path: "/procurement/goods-receipts/new", needsProject: false, chainLabel: "Record goods receipt" },
      { id: "procurement.open", label: "Open", path: "/procurement", needsProject: false },
    ],
  },
  {
    id: "invoices",
    label: "Invoices",
    route: "/invoices",
    prefixes: ["/invoices"],
    needsProject: false,
    pillKeys: ["invoices", "invoice", "billing", "credit_notes", "credit_note"],
    placeholder: "e.g. raise an invoice for the Phase 1 milestone",
    examples: ["raise an invoice for the Phase 1 milestone", "which invoices are overdue"],
    leaves: [
      { id: "invoices.new", label: "New invoice", path: "/invoices/new", needsProject: false, chainLabel: "New invoice" },
      { id: "invoices.credit-note", label: "New credit note", path: "/invoices/credit-notes/new", needsProject: false, chainLabel: "New credit note" },
      { id: "invoices.open", label: "Open", path: "/invoices", needsProject: false },
    ],
  },
  {
    id: "quotations",
    label: "Quotations",
    route: "/quotations",
    // Sales quotations only. The PURCHASE quotation at
    // /procurement/quotations/new is a different entity on a different table
    // that happens to share the word (GAP-10), and it belongs to Procurement.
    prefixes: ["/quotations"],
    needsProject: false,
    pillKeys: ["quotations", "quotation", "quote", "sales_quotation"],
    placeholder: "e.g. quote the interior fit-out for Cedar Heights",
    examples: ["quote the interior fit-out for Cedar Heights", "which quotations have not been accepted yet"],
    leaves: [
      { id: "quotations.new", label: "New quotation", path: "/quotations/new", needsProject: false, chainLabel: "New quotation" },
      { id: "quotations.open", label: "Open", path: "/quotations", needsProject: false },
    ],
  },
  {
    id: "sales-orders",
    label: "Sales Orders",
    route: "/sales-orders",
    prefixes: ["/sales-orders"],
    needsProject: false,
    pillKeys: ["sales_orders", "sales_order", "order", "orders"],
    placeholder: "e.g. convert the Cedar Heights quotation into an order",
    examples: ["convert the Cedar Heights quotation into an order", "which sales orders are not yet invoiced"],
    leaves: [
      { id: "sales-orders.new", label: "New sales order", path: "/sales-orders/new", needsProject: false, chainLabel: "New sales order" },
      { id: "sales-orders.open", label: "Open", path: "/sales-orders", needsProject: false },
    ],
  },
  {
    id: "sales",
    label: "Sales Pipeline",
    route: "/sales",
    prefixes: ["/sales"],
    needsProject: false,
    pillKeys: ["sales", "leads", "lead", "opportunities", "opportunity", "crm", "pipeline"],
    placeholder: "e.g. add a lead for the Marina tower fit-out",
    examples: ["add a lead for the Marina tower fit-out", "which opportunities are closing this month"],
    leaves: [
      { id: "sales.lead", label: "New lead", path: "/sales/leads/new", needsProject: false, chainLabel: "New lead" },
      { id: "sales.opportunity", label: "New opportunity", path: "/sales/opportunities/new", needsProject: false, chainLabel: "New opportunity" },
      // A-06: both of these are real pages of their own, so each needs the word
      // the STRIP uses when the user is standing on it -- without a chainLabel
      // the sentence would end at "Sales Pipeline >" and go no further.
      { id: "sales.leads", label: "Leads", path: "/sales/leads", needsProject: false, chainLabel: "Leads" },
      { id: "sales.opportunities", label: "Opportunities", path: "/sales/opportunities", needsProject: false, chainLabel: "Opportunities" },
      { id: "sales.open", label: "Open", path: "/sales", needsProject: false },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    route: "/inventory",
    prefixes: ["/inventory"],
    needsProject: false,
    pillKeys: ["inventory", "stock", "warehouse", "warehouses", "items"],
    placeholder: "e.g. move 50 bags of cement to the north warehouse",
    examples: ["move 50 bags of cement to the north warehouse", "what is on hand across all warehouses"],
    leaves: [
      { id: "inventory.item", label: "New item", path: "/inventory/items/new", needsProject: false, chainLabel: "New item" },
      { id: "inventory.stock-entry", label: "New stock entry", path: "/inventory/stock-entries/new", needsProject: false, chainLabel: "New stock entry" },
      { id: "inventory.warehouse", label: "New warehouse", path: "/inventory/warehouses/new", needsProject: false, chainLabel: "New warehouse" },
      { id: "inventory.open", label: "Open", path: "/inventory", needsProject: false },
    ],
  },
  {
    id: "expenses",
    label: "Expenses",
    route: "/expenses",
    prefixes: ["/expenses"],
    needsProject: false,
    pillKeys: ["expenses", "expense", "claim", "claims", "reimbursement"],
    placeholder: "e.g. claim the site travel expense from Tuesday",
    examples: ["claim the site travel expense from Tuesday", "which expenses are still unapproved"],
    leaves: [
      { id: "expenses.new", label: "New expense", path: "/expenses/new", needsProject: false, chainLabel: "New expense" },
      { id: "expenses.open", label: "Open", path: "/expenses", needsProject: false },
    ],
  },
  {
    id: "employees",
    label: "Employees",
    route: "/employees",
    // "/hr" is this module's own hub screen, not a module of its own -- it has
    // no create route and no object route, so giving it a segment of its own
    // would put a dead end in the strip.
    prefixes: ["/employees", "/hr"],
    needsProject: false,
    pillKeys: ["employees", "employee", "hr", "people", "staff", "leave", "departments"],
    placeholder: "e.g. add a site engineer to the payroll",
    examples: ["add a site engineer to the payroll", "who is on leave next week"],
    leaves: [
      { id: "employees.new", label: "New employee", path: "/employees/new", needsProject: false, chainLabel: "New employee" },
      { id: "employees.department", label: "New department", path: "/employees/departments/new", needsProject: false, chainLabel: "New department" },
      { id: "employees.leave", label: "Apply for leave", path: "/employees/leave/new", needsProject: false, chainLabel: "New leave request" },
      { id: "employees.leave-balance", label: "New leave balance", path: "/employees/leave/balance/new", needsProject: false, chainLabel: "New leave balance" },
      { id: "employees.open", label: "Open", path: "/employees", needsProject: false },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    route: "/payroll",
    prefixes: ["/payroll"],
    needsProject: false,
    pillKeys: ["payroll", "payslip", "payslips", "salary", "salaries"],
    placeholder: "e.g. run payroll for September",
    examples: ["run payroll for September", "show the salary structure for site engineers"],
    leaves: [
      { id: "payroll.run", label: "New payroll run", path: "/payroll/runs/new", needsProject: false, chainLabel: "New payroll run" },
      { id: "payroll.component", label: "New salary component", path: "/payroll/components/new", needsProject: false, chainLabel: "New salary component" },
      { id: "payroll.structure", label: "New salary structure", path: "/payroll/structures/new", needsProject: false, chainLabel: "New salary structure" },
      { id: "payroll.tax-slab", label: "New tax slab", path: "/payroll/tax-slabs/new", needsProject: false, chainLabel: "New tax slab" },
      { id: "payroll.statutory", label: "New statutory rule", path: "/payroll/statutory-rules/new", needsProject: false, chainLabel: "New statutory rule" },
      { id: "payroll.open", label: "Open", path: "/payroll", needsProject: false },
    ],
  },
  {
    id: "recruitment",
    label: "Recruitment",
    route: "/recruitment",
    prefixes: ["/recruitment"],
    needsProject: false,
    pillKeys: ["recruitment", "hiring", "openings", "candidates", "applications"],
    placeholder: "e.g. open a vacancy for a quantity surveyor",
    examples: ["open a vacancy for a quantity surveyor", "which applications are waiting on an interview"],
    leaves: [
      { id: "recruitment.opening", label: "New opening", path: "/recruitment/openings/new", needsProject: false, chainLabel: "New opening" },
      { id: "recruitment.application", label: "New application", path: "/recruitment/applications/new", needsProject: false, chainLabel: "New application" },
      { id: "recruitment.candidate", label: "New candidate", path: "/recruitment/candidates/new", needsProject: false, chainLabel: "New candidate" },
      { id: "recruitment.open", label: "Open", path: "/recruitment", needsProject: false },
    ],
  },
  {
    id: "grc",
    label: "Governance & Risk",
    route: "/grc",
    prefixes: ["/grc"],
    needsProject: false,
    pillKeys: ["grc", "governance", "risk", "risks", "policies", "policy", "compliance", "audit", "audits"],
    placeholder: "e.g. raise a risk for the delayed steel delivery",
    examples: ["raise a risk for the delayed steel delivery", "which policies are due for review"],
    leaves: [
      { id: "grc.policy", label: "New policy", path: "/grc/policies/new", needsProject: false, chainLabel: "New policy" },
      { id: "grc.risk", label: "New risk", path: "/grc/risks/new", needsProject: false, chainLabel: "New risk" },
      { id: "grc.case", label: "New case", path: "/grc/cases/new", needsProject: false, chainLabel: "New case" },
      { id: "grc.access-review", label: "New access review", path: "/grc/access-review/new", needsProject: false, chainLabel: "New access review" },
      { id: "grc.audit", label: "New audit", path: "/grc/audits/new", needsProject: false, chainLabel: "New audit" },
      { id: "grc.finding", label: "New finding", path: "/grc/findings/new", needsProject: false, chainLabel: "New finding" },
      { id: "grc.vendor-risk", label: "New vendor risk", path: "/grc/vendors/new", needsProject: false, chainLabel: "New vendor risk" },
      { id: "grc.open", label: "Open", path: "/grc", needsProject: false },
    ],
  },
  {
    id: "kpis",
    label: "KPIs",
    route: "/kpis",
    prefixes: ["/kpis"],
    pillKeys: ["kpis", "kpi", "metrics", "targets"],
    placeholder: "e.g. set a monthly concrete pour target for this project",
    examples: ["set a monthly concrete pour target for this project", "which KPIs are below target"],
    leaves: [
      { id: "kpis.new", label: "New KPI", path: "/kpis/new", chainLabel: "New KPI" },
      { id: "kpis.open", label: "Open", path: "/kpis" },
    ],
  },
  {
    id: "change-orders",
    label: "Change Orders",
    route: "/change-orders",
    prefixes: ["/change-orders"],
    pillKeys: ["change_orders", "change_order", "variation", "variations", "vo"],
    placeholder: "e.g. raise a change order for the revised lobby finish",
    examples: ["raise a change order for the revised lobby finish", "what is the approved variation value on this project"],
    leaves: [
      { id: "change-orders.new", label: "New change order", path: "/change-orders/new", chainLabel: "New change order" },
      { id: "change-orders.open", label: "Open", path: "/change-orders" },
    ],
  },
  {
    id: "punch-list",
    label: "Punch List",
    route: "/punch-list",
    prefixes: ["/punch-list"],
    pillKeys: ["punch_list", "punch", "snag", "snags", "snagging", "defects"],
    placeholder: "e.g. log a snag for the cracked tile in unit 4B",
    examples: ["log a snag for the cracked tile in unit 4B", "how many punch items are still open"],
    leaves: [
      { id: "punch-list.new", label: "New punch item", path: "/punch-list/new", chainLabel: "New punch item" },
      { id: "punch-list.open", label: "Open", path: "/punch-list" },
    ],
  },
  {
    id: "rfis",
    label: "RFIs",
    route: "/rfis",
    prefixes: ["/rfis"],
    pillKeys: ["rfis", "rfi", "queries", "information_request"],
    placeholder: "e.g. raise an RFI about the beam reinforcement detail",
    examples: ["raise an RFI about the beam reinforcement detail", "which RFIs are still unanswered"],
    leaves: [
      { id: "rfis.new", label: "New RFI", path: "/rfis/new", chainLabel: "New RFI" },
      { id: "rfis.open", label: "Open", path: "/rfis" },
    ],
  },
  {
    id: "submittals",
    label: "Submittals",
    route: "/submittals",
    prefixes: ["/submittals"],
    pillKeys: ["submittals", "submittal", "approvals", "material_approval"],
    placeholder: "e.g. submit the tile sample for approval",
    examples: ["submit the tile sample for approval", "which submittals are pending with the consultant"],
    leaves: [
      { id: "submittals.new", label: "New submittal", path: "/submittals/new", chainLabel: "New submittal" },
      { id: "submittals.open", label: "Open", path: "/submittals" },
    ],
  },
  {
    id: "site-diary",
    label: "Site Diary",
    route: "/site-diary",
    prefixes: ["/site-diary"],
    pillKeys: ["site_diary", "diary", "daily_report", "day_report"],
    placeholder: "e.g. record today's site diary entry",
    examples: ["record today's site diary entry", "show the site diary for last week"],
    leaves: [
      { id: "site-diary.new", label: "New entry", path: "/site-diary/new", chainLabel: "New diary entry" },
      { id: "site-diary.open", label: "Open", path: "/site-diary" },
    ],
  },
  {
    id: "ffe",
    label: "FF&E",
    route: "/ffe",
    prefixes: ["/ffe"],
    pillKeys: ["ffe", "furniture", "fixtures", "equipment"],
    placeholder: "e.g. add the lobby seating to the FF&E schedule",
    examples: ["add the lobby seating to the FF&E schedule", "what is the FF&E spend on this project"],
    leaves: [
      { id: "ffe.new", label: "New FF&E item", path: "/ffe/new", chainLabel: "New FF&E item" },
      { id: "ffe.open", label: "Open", path: "/ffe" },
    ],
  },
  {
    id: "mood-boards",
    label: "Mood Boards",
    route: "/mood-boards",
    prefixes: ["/mood-boards"],
    pillKeys: ["mood_boards", "mood_board", "moodboard", "concept"],
    placeholder: "e.g. start a mood board for the master bedroom",
    examples: ["start a mood board for the master bedroom", "show the approved mood boards for this project"],
    leaves: [
      { id: "mood-boards.new", label: "New mood board", path: "/mood-boards/new", chainLabel: "New mood board" },
      { id: "mood-boards.open", label: "Open", path: "/mood-boards" },
    ],
  },
  {
    id: "wiki",
    label: "Wiki",
    route: "/wiki",
    prefixes: ["/wiki"],
    needsProject: false,
    pillKeys: ["wiki", "handbook", "sop", "sops"],
    placeholder: "e.g. write up the concrete pour method statement",
    examples: ["write up the concrete pour method statement", "find the site induction procedure"],
    leaves: [
      { id: "wiki.new", label: "New page", path: "/wiki/new", needsProject: false, chainLabel: "New wiki page" },
      { id: "wiki.open", label: "Open", path: "/wiki", needsProject: false },
    ],
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    route: "/knowledge-base",
    prefixes: ["/knowledge-base"],
    needsProject: false,
    pillKeys: ["knowledge_base", "kb", "help", "articles"],
    placeholder: "e.g. add an article on the material approval process",
    examples: ["add an article on the material approval process", "search the knowledge base for retention terms"],
    leaves: [
      { id: "knowledge-base.new", label: "New article", path: "/knowledge-base/new", needsProject: false, chainLabel: "New article" },
      { id: "knowledge-base.open", label: "Open", path: "/knowledge-base", needsProject: false },
    ],
  },
  {
    // id and label are BOTH deliberately not the bare word "projects", and
    // pillKeys is deliberately empty. moduleForPill() matches a pill against
    // mod.id, normalisePillKey(mod.label) AND mod.pillKeys, so an id of
    // "projects" or a label of "Projects" captures the platform pill on its
    // own no matter how empty pillKeys is.
    id: "project-directory",
    label: "Project Directory",
    route: "/projects",
    prefixes: ["/projects"],
    needsProject: false,
    // DELIBERATELY EMPTY, and this is the whole point of the entry. Two
    // different things share the word "projects":
    //   the PLATFORM PILL "Projects" means "choose which project I am working
    //     on", and this product answers that in the top rail on purpose --
    //     card-catalogue.ts renders it as "pick one in the top rail" rather
    //     than letting a pill compete with the selector;
    //   the MODULE "/projects" means "manage the project list" -- a real
    //     shipped ERP screen with a create route that R80 Part 5 GAP-9 flagged
    //     as reachable-once-created-but-never-openable.
    // Both are true and they must not be conflated. Route coverage is driven
    // by `prefixes`, pill resolution by `pillKeys`, so leaving this empty gives
    // /projects and /projects/new their chain segment WITHOUT making
    // moduleForPill("projects") resolve and silently delete the top-rail
    // guidance. card-catalogue.test.ts asserts that guidance still appears.
    pillKeys: [],
    placeholder: "e.g. set up a new project for the Marina tower",
    examples: ["set up a new project for the Marina tower", "which projects are running behind schedule"],
    leaves: [
      { id: "project-directory.new", label: "New project", path: "/projects/new", needsProject: false, chainLabel: "New project" },
      { id: "project-directory.open", label: "Open", path: "/projects", needsProject: false },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    route: "/analysis",
    prefixes: ["/analysis"],
    needsProject: false,
    pillKeys: ["analysis", "analytics", "insights"],
    placeholder: "e.g. compare planned against actual cost across projects",
    examples: ["compare planned against actual cost across projects", "where is margin slipping this quarter"],
    leaves: [{ id: "analysis.open", label: "Open", path: "/analysis", needsProject: false }],
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
    // A NAME BEATS AN ALIAS, WHATEVER THE ARRAY ORDER. `id` and `label` are a
    // module naming ITSELF; `pillKeys` are aliases it also answers to. This
    // used to be one pass, so the winner was whichever module happened to sit
    // earlier in MODULE_CATALOGUE -- and "analysis" was claimed both as the
    // `analysis` module's id (index 38) and as an alias of `work-progress`
    // (index 6), so the alias won and the Analysis pill resolved to the wrong
    // screen. Two passes make the precedence a RULE rather than a position:
    // moving an entry in the array can no longer change what a pill resolves
    // to. The remaining ambiguity -- one alias claimed by two modules -- is
    // not decidable here and is asserted away in module-catalogue.test.ts.
    const named = MODULE_CATALOGUE.find(
      (mod) => mod.id === candidate || normalisePillKey(mod.label) === candidate
    );
    if (named) return named;
    const aliased = MODULE_CATALOGUE.find((mod) =>
      mod.pillKeys.some((k) => normalisePillKey(k) === candidate)
    );
    if (aliased) return aliased;
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
