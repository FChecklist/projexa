"use client";

// R67 D-01: this view became a client component when the Projects table's
// rows became real, clickable rows (a server component cannot carry an
// onClick). Every prop it receives is still plain JSON resolved server-side
// in dashboard/page.tsx -- no data fetching moved into the browser.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import { BulletChart, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// R67 D-02: the FORKED KpiCard (src/components/screens/KpiCard.tsx, per
// decision D-09), not the kit's -- the fork is what allows a card with no
// real 30-day delta behind it to render no arrow and no status colour
// instead of an invented one. Everything else here still comes from the kit.
import { KpiCard } from "@/components/screens/KpiCard";
import {
  budgetBaseline,
  formatProjectValue,
  portfolioTotals,
  projectValueCaption,
  spendTone,
  type ProjectValueSource,
} from "@/lib/dashboard-kpi";
// R67 G-05 / D-61: one money format for the whole product. Imported from the
// server-safe module, not from @/lib/currency ("use client"), so the same
// helper serves this view and the Server Components around it. D-61 shipped a
// second copy of this module before lane G merged; G-05's is the one that
// survived (it is a superset -- pending state, unknown-currency glyph, signed
// money) and D-61's copy is gone.
import { MONEY_CELL_CLASS, currencyUnitSuffix, formatMoney, hasCurrency } from "@/lib/format-money";
import { dashboardSummary, mayAssertEmpty } from "@/lib/read-outcome";

/** Money column headers align with their cells. */
const MONEY_HEAD_CLASS = "text-right";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// R46 P8 seq123: presentational body extracted out of (app)/dashboard/page.tsx
// so that route file could stay a thin server resolver (same split as every
// other registry-driven screen this session -- PermitsListClient,
// DocumentsClient, ScopeClient). Nothing about data-fetching, values, or
// structure moved here changed -- this is a 1:1 lift of the original JSX.
export type OrgDashboard = {
  totalProjects: number;
  // R67 D-02: widened to match compliance-tracker's getOrgDashboard(), which
  // now returns null (never 0) when NO erp_budget_line_items row exists for
  // any project in scope. "Nobody has set a budget" and "the budget is zero"
  // are different facts and this screen was rendering both as "AED 0".
  totalBudget: number | null;
  totalRevenue: number;
  totalExpenses: number;
  // R38 (R-50/TC-40): contractValue is the project's active BOQ root-total,
  // null (not 0) when the project has no BOQ at all yet -- see
  // construction-dashboard-service.ts#getOrgDashboard's own comment.
  // R39 (R-51): earnedValue/percentByValue reuse that SAME service's
  // earnedValueReport() (D-3, single source of truth with the WPR report) --
  // null (not 0) when construction isn't enabled or there's no BOQ yet.
  //
  // R67 D-62 (audit R-202): the row now carries BOTH money facts under their
  // real names, from getOrgDashboard's resolveProjectMoney() -- the same helper
  // /dashboard/project reads. Before this, the home showed the BOQ total in a
  // column headed "Value" while the project dashboard showed the entered/PO
  // figure under the same word, so one project told two different money stories
  // one click apart. `value` is the backend's own deprecated alias of
  // contractValue and is deliberately not read here any more.
  projects: {
    id: string;
    name: string;
    revenue: number;
    expenses: number;
    taskCount: number;
    delayedTaskCount: number;
    contractValue: number | null;
    projectValue: number | null;
    projectValueSource: ProjectValueSource;
    earnedValue: number | null;
    percentByValue: number | null;
  }[];
};
// The currencies list this screen is handed. Still resolved server-side in
// dashboard/page.tsx via callVeridian (same backing call as /api/currencies),
// still passed down as a plain prop -- only the formatting moved.
export type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };
// R51 (R-62): the fallback was the literal "₹". This component IS the
// landing screen, so that constant was the single most visible instance of
// the bug -- a UAE buyer's first view of the product showed rupees whenever
// the currencies list was empty, which for an org with no erp_currencies
// base row (4 of 5 real orgs, measured 2026-08-26) is permanently. Same
// rule as @/lib/currency: never render a currency token we cannot source.
// The value is duplicated rather than imported because that module is
// "use client" and this is a Server Component -- see the note above; the
// two must be kept in step.
// R67 G-05 (R-260): this file's own local formatCurrency() is gone. It was
// the third independent copy of the same logic in this app, and it disagreed
// with the other two in two ways that showed on screen: 0 decimals here
// against 2 elsewhere, so one amount read "AED 1,200" on the home page and
// "AED 1,200.00" one click away; and a null value fell through to the same
// rendering as zero. src/lib/format-money.ts is now the only copy. It has no
// "use client" and no React, precisely so this Server Component can use it.
//
// NEXT_PUBLIC_DEFAULT_CURRENCY_CODE is deliberately NOT consulted: it is a
// deployment-wide guess, and R-260's rule is that a screen with no per-org
// currency renders the number behind a warning glyph and says so once,
// rather than labelling an amount with a code nobody confirmed. The
// CurrencyNotSetNotice at the foot of the page is that sentence.
function orgCurrency(currencies: CurrencyRow[]): string | null {
  return currencies.find((c) => c.isBaseCurrency)?.code ?? null;
}
/** KPI tiles show whole units -- the fraction is noise at that size. Every table cell keeps two decimals. */
function formatKpi(n: number | null, currencies: CurrencyRow[]) {
  return formatMoney(n, { currency: orgCurrency(currencies), fractionDigits: 0 });
}
function formatCurrency(n: number | null, currencies: CurrencyRow[]) {
  return formatMoney(n, { currency: orgCurrency(currencies) });
}

// R46 P8 seq123 (M28 registry-model, DASHBOARD archetype -- function_id
// "dashboard.dashboard"): intentionally the same fields as ScreenColumn so a
// registry row can be passed straight in with no reshaping, same pattern as
// PermitsListClient/ScopeClient's RegistryColumn.
export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and this hardcoded default. Only LABEL text is
// registry-driven here: the KPI cards and Projects table below stay the
// fully hand-built layout that already shipped (not the kit's generic
// DashboardScreen composition -- this is PROJEXA's HOME_ROUTE with its own
// HomeGreeting hero and a real KPI-band + full project-table layout;
// swapping to DashboardScreen's oneNumber/trend/breakdown shape would be a
// much larger visual rewrite of a live production landing page for
// label-only registry gain, same minimal-risk call R46 P8 seq121 made for
// boq.custom).
//
// R67 D-02: totalProjects and totalBudget no longer have a card of their own
// (the project count is in the greeting; the budget is now the Spend card's
// baseline), so their fallback labels are gone with them. The two that
// remain keep the registry mechanism, with this item's own wording as the
// fallback.
const DEFAULT_COLUMNS: ScreenColumn[] = [
  { field: "totalRevenue", label: "Revenue", type: "number", importance: "High" },
  { field: "totalExpenses", label: "Spend", type: "number", importance: "High" },
  { field: "project", label: "Project", type: "text", importance: "High" },
  // R67 D-62: "Value" named neither of the two money facts it might have been.
  // The registry field key is unchanged (an org that has renamed this column
  // keeps its label); only the fallback wording now says which figure it is.
  { field: "value", label: "Contract value", type: "number", importance: "High" },
  { field: "projectValue", label: "Project value", type: "number", importance: "High" },
  { field: "earnedValue", label: "Earned Value", type: "number", importance: "High" },
  { field: "revenue", label: "Revenue", type: "number", importance: "High" },
  { field: "expenses", label: "Expenses", type: "number", importance: "High" },
  { field: "tasks", label: "Tasks", type: "number", importance: "High" },
  { field: "delayed", label: "Delayed", type: "number", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

export default function DashboardHomeView({
  userName,
  data,
  currencies,
  errorMessage,
  registryColumns,
  permitsExpiring,
}: {
  userName: string;
  data: OrgDashboard | null;
  currencies: CurrencyRow[];
  errorMessage: string | null;
  registryColumns?: RegistryColumn[] | null;
  /**
   * R67 D-02: count of permits expiring in the next 30 days across the org,
   * resolved server-side in dashboard/page.tsx. null means THAT read failed --
   * rendered as words, never as a zero, because "no permits are expiring" and
   * "we could not find out" must not look the same.
   */
  permitsExpiring: number | null;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const currencySet = hasCurrency({ currency: orgCurrency(currencies) });
  const unitSuffix = currencyUnitSuffix({ currency: orgCurrency(currencies) }) ?? "";

  // Merged-Home-page greeting (Owner directive 2026-07-18, agreed reference
  // mockup): /dashboard is PROJEXA's designated home route (see
  // (app)/layout.tsx's HOME_ROUTE). Real counts only -- delayedProjectCount
  // reuses the same per-project delayedTaskCount this page already fetches
  // above, never a fabricated number.
  const delayedProjectCount = data?.projects.filter((p) => p.delayedTaskCount > 0).length ?? 0;
  const onTrackProjectCount = (data?.totalProjects ?? 0) - delayedProjectCount;

  // R67 D-02: the portfolio's own earned-value figures, summed from the SAME
  // per-project rows the table below renders (so the band and the table can
  // never disagree), with nulls skipped rather than counted as zero.
  const portfolio = portfolioTotals(data?.projects ?? []);
  const money = (n: number) => formatCurrency(n, currencies);

  return (
    <>
      {/* No PageHeading here -- this is PROJEXA's designated home route
          (see (app)/layout.tsx's HOME_ROUTE), and HomeGreeting below
          already renders a real "Good morning, {name}." heading; a second
          "Dashboard" label above it would be redundant. */}
      {/* R46S11_01: this sentence used to fall through to "No active
          projects yet" whenever `data` was null -- INCLUDING when data was
          null because the read had FAILED. On the primary owner-facing
          screen, for an org with 5 real active projects, a 504 rendered as a
          confident "you have none", directly above an error card saying the
          load failed. Same shape the sibling screen /dashboard/overview was
          fixed for below; this one is the higher-blast-radius instance,
          because it is the first page an owner lands on after login.
          dashboardSummary() (src/lib/read-outcome.ts) will not state a count
          the read could not produce. */}
      <HomeGreeting
        userName={userName}
        summary={dashboardSummary(
          data ? { totalProjects: data.totalProjects, delayedProjectCount } : null,
          errorMessage
        )}
        stats={[
          ...(delayedProjectCount > 0 ? [{ label: `${delayedProjectCount} delayed`, tone: "attention" as const }] : []),
          ...(onTrackProjectCount > 0 ? [{ label: `${onTrackProjectCount} on track`, tone: "onTrack" as const }] : []),
        ]}
      />
      <div className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">
              Could not load live data: {errorMessage}
            </CardContent>
          </Card>
        )}

        {/* R67 D-01 / correction C-01: was <CreateProjectDialog />, the one
            [role=dialog] left in PROJEXA. It is now a real route, so this is
            a plain link in the right-pane header position -- the same "+ New"
            the framed list screens carry. */}
        <div className="flex justify-end">
          <Button size="sm" asChild>
            <Link href="/projects/new">+ New</Link>
          </Button>
        </div>

        {data && (
          <>
            {/* R67 D-02 (audit R-004/R-009). Was four flat DashboardCards --
                a bare number each, no baseline, no destination, and an
                "Active Projects" count whose registry label carried the
                literal string "(HARD-STOP TEST)" onto the live home. That
                count is dropped here: it is already stated in the greeting
                above, and its polluted registry label is C01-22's to fix.
                What replaces them is one primary KPI plus three supporting
                ones, each with a real baseline and a real destination.
                No card emits an arrow or a status colour it cannot measure --
                the backend returns no 30-day delta, so the only tone shown is
                "over budget", and only when a budget actually exists. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)]">
              <KpiCard
                size="primary"
                label="Portfolio earned value"
                value={
                  portfolio.contract === null
                    ? "No BOQ yet"
                    : portfolio.earned !== null
                      ? money(portfolio.earned)
                      : "No progress yet"
                }
                // The only trend on this band: the empty state's own next
                // step. With a BOQ in place the comparison is the bullet
                // chart and the baseline, both measured -- not an arrow.
                trend={portfolio.contract === null ? { direction: "flat", tone: "context", label: "Import a BOQ" } : undefined}
                baseline={
                  portfolio.contract === null
                    ? ""
                    : `of ${money(portfolio.contract)} contract${portfolio.percent !== null ? ` (${portfolio.percent} %)` : ""}`
                }
                visual={
                  portfolio.contract !== null && portfolio.earned !== null ? (
                    <BulletChart value={portfolio.earned} target={portfolio.contract} unit="" />
                  ) : undefined
                }
                onClick={() => router.push("/scope")}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <KpiCard
                  label={columnLabel(columns, "totalRevenue", "Revenue")}
                  value={money(data.totalRevenue)}
                  baseline="invoiced to date"
                  onClick={() => router.push("/invoices")}
                />
                <KpiCard
                  label={columnLabel(columns, "totalExpenses", "Spend")}
                  value={money(data.totalExpenses)}
                  trend={
                    spendTone(data.totalBudget, data.totalExpenses) === "late"
                      ? { direction: "up", tone: "late", label: "over budget" }
                      : undefined
                  }
                  baseline={budgetBaseline(data.totalBudget, money)}
                  onClick={() => router.push("/expenses")}
                />
                <KpiCard
                  label="Permits expiring"
                  value={permitsExpiring === null ? "Not loaded" : String(permitsExpiring)}
                  trend={permitsExpiring === null ? { direction: "flat", tone: "context", label: "the permits read failed" } : undefined}
                  baseline="next 30 days"
                  onClick={() => router.push("/permits?withinDays=30")}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {/* R67 G-04 (R-231): the second branch used to end "Create
                    another one below.", which referred to nothing -- the
                    only create control is the button to the RIGHT of this
                    sentence, not below it, and the first branch's "create one
                    below" had the same fault. Both now point at the control
                    that actually exists, by its own label. */}
                {data.totalRevenue === 0
                  ? `Total Revenue shows ${formatKpi(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org."}
              </p>
              {/* Real-screen conversion (2026-08-30) -- was a separate,
                  duplicate "Create / Link Invoice" Dialog popup
                  (CreateInvoiceDialog.tsx) with its own copy of the same
                  create-invoice logic InvoicesClient.tsx had; now routes to
                  the one real Invoice create screen instead of maintaining
                  two forms that could drift apart. */}
              <Button variant="outline" size="sm" asChild>
                <Link href="/invoices/new"><Receipt className="size-4" /> Create / Link Invoice</Link>
              </Button>
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Projects</CardTitle>
              </CardHeader>
              <CardContent>
                {data.projects.length === 0 ? (
                  // Same rule as the greeting above: only a read that
                  // succeeded may report "none". Today `data` and
                  // `errorMessage` are mutually exclusive (dashboard/page.tsx
                  // sets one or the other), so this guard costs nothing --
                  // it is here so the honest branch cannot be lost if that
                  // ever changes.
                  <p className="py-8 text-center text-sm text-px-muted">
                    {mayAssertEmpty(errorMessage) ? "No active projects yet." : "Couldn't load the project list — see the error above."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{columnLabel(columns, "project", "Project")}</TableHead>
                        {/* R67 G-05: the unit is stated once, in the header.
                            R67 D-62 splits the old single "Value" column into
                            the two money facts the backend really returns. */}
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "value", "Contract value")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "projectValue", "Project value")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "earnedValue", "Earned Value")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "revenue", "Revenue")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "expenses", "Expenses")}{unitSuffix}</TableHead>
                        <TableHead className="text-right">{columnLabel(columns, "tasks", "Tasks")}</TableHead>
                        <TableHead className="text-right">{columnLabel(columns, "delayed", "Delayed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.projects.map((p) => (
                        // R67 D-01: the WHOLE row opens the project, not just
                        // the six characters of its name -- a row that
                        // navigates must advertise it (cursor) and be
                        // reachable from the keyboard (Enter), which a bare
                        // <tr> is not. The inner name Link stays so
                        // middle-click/ctrl-click still opens a tab, and stops
                        // the click propagating so the row handler does not
                        // fire a second navigation on top of it.
                        <TableRow
                          key={p.id}
                          tabIndex={0}
                          aria-label={`Open ${p.name}`}
                          className="cursor-pointer"
                          onClick={() => router.push(`/dashboard/project?projectId=${p.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              router.push(`/dashboard/project?projectId=${p.id}`);
                            }
                          }}
                        >
                          {/* R42 seq24: the real per-project DASHBOARD.PROJECT screen this org table had no link to before -- was a dead end otherwise. */}
                          <TableCell className="font-medium">
                            <Link
                              href={`/dashboard/project?projectId=${p.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-px-ink hover:underline"
                            >
                              {p.name}
                            </Link>
                          </TableCell>
                          {/* R67 G-05 / D-61: every money column is right-aligned
                              and tabular (MONEY_CELL_CLASS), so the decimal
                              points form a column the eye can scan down. */}
                          <TableCell className={MONEY_CELL_CLASS}>{p.contractValue === null ? <span className="text-px-muted">No scope yet</span> : formatCurrency(p.contractValue, currencies)}</TableCell>
                          {/* R67 D-62: the OTHER money fact, under its own name
                              and with its source stated, so a figure derived
                              from purchase orders is never read as one somebody
                              typed. null is the words "Not set", never 0. */}
                          <TableCell className={MONEY_CELL_CLASS}>
                            {p.projectValue === null ? (
                              <span className="text-px-muted">Not set</span>
                            ) : (
                              <>
                                {formatProjectValue(p.projectValue, (n) => formatCurrency(n, currencies))}
                                <span className="text-px-muted"> ({projectValueCaption(p.projectValueSource)})</span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>
                            {p.earnedValue === null ? (
                              <span className="text-px-muted">No progress yet</span>
                            ) : (
                              <>
                                {formatCurrency(p.earnedValue, currencies)}
                                <span className="text-px-muted"> ({p.percentByValue}%)</span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>{formatCurrency(p.revenue, currencies)}</TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>{formatCurrency(p.expenses, currencies)}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.taskCount}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.delayedTaskCount > 0 ? (
                              // R67 WS-G: the glyph and the number both carry
                              // it; the tone is the readable rose text token,
                              // not the raw error red.
                              <span className="inline-flex items-center gap-1" style={{ color: "var(--status-late-text)" }}>
                                <AlertTriangle className="size-3.5" /> {p.delayedTaskCount}
                              </span>
                            ) : (
                              <span className="text-px-muted">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            {/* R67 G-05: said once, at the foot of the page. */}
            <CurrencyNotSetNotice currencySet={currencySet} />
          </>
        )}
      </div>
    </>
  );
}
