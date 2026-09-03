"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Wallet, TrendingUp, Receipt, Activity, Building2, Landmark } from "lucide-react";
import { CategoryDistributionCharts } from "@/components/CategoryDistributionCharts";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";
import { mayShowEmptyState, type PaneStatus } from "@/lib/pane-state";

type Company = { id: string; name: string; slug: string; country: string | null; role: string };
type Department = { id: string; name: string; memberCount: number };
/** R67 E-37: why the companies list came back empty, from resolveHierarchyCompanies. */
type EmptyReason = "none" | "no-company" | "not-a-member";
type ProjectSummary = { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number };
type OrgDashboard = { totalProjects: number; totalBudget: number; totalRevenue: number; totalExpenses: number; projects: ProjectSummary[] };
type ProjectDetails = {
  projectId: string; projectName: string; budget: number; budgetIsPeriodTotal: boolean;
  revenue: number; revenueTruncated: boolean; expenses: number; progressPercent: number; dateRangeApplied: boolean;
  // Point 121: COALESCE(user-entered, linked-PO-sum). null (never 0) when
  // neither source exists -- rendered as no card at all, not a zero.
  projectValue: number | null;
};

// R11 point 6b: this was the last hardcoded rupee-glyph formatter in
// projexa/src (Priority 17 already converted every sibling component to
// currencyLabel()). This dashboard aggregates across a company's own
// projects, not one project's own transaction currency, so -- same as
// every other currencyLabel() call site with no per-row currencyId -- id
// is undefined, which resolves to the org's base currency (see
// currencyLabel()'s own comment).
function fmt(n: number, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ─── R67 D-03 (R-002 / R-019 / R-025) ──────────────────────
//
// THE DEFECT. This helper was:
//
//   const res = await fetch(url);
//   if (!res.ok) return null;
//   return res.json();
//
// It DID read res.ok -- and then threw the failure away, which is why the
// repo's own src/lib/no-swallowed-http-errors.test.ts never caught it: that
// guard anchors on the await-then-check shape, on Promise.all([fetch()]) and
// on the fetch().then(r => r.json()) chain, and this is a fourth shape (it is
// covered by that file's fourth check now). Every caller then did
// `.then((data) => { if (!data) return; ... })`, so a 500 from
// /api/dashboard-hierarchy/companies left `companies` at its initial `[]` and
// the page printed "No company memberships found for this account." -- telling
// a user they belong to no company when the service merely refused. The org
// dashboard was worse: it stayed null and its whole section simply VANISHED,
// with no error, no Retry and nothing to indicate a request had been made.
//
// A read now resolves to a discriminated outcome, and the message is the
// backend's OWN words where it sent any, with the status as the fallback --
// never a generic sentence that hides which service failed.
type ReadResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function getJson<T>(url: string): Promise<ReadResult<T>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    // A thrown fetch never reached the server at all. Saying "the request did
    // not complete" is true; saying "there are no companies" would not be.
    return { ok: false, message: err instanceof Error && err.message ? err.message : "the request did not complete" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const said = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
    return { ok: false, message: said ?? `the request failed (${res.status})` };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, message: "the response could not be read" };
  }
}

/**
 * D-03's own words, once, so the four panels on this screen cannot drift into
 * four different ways of admitting the same thing. The second sentence is the
 * point: an empty screen and a failed screen look identical, and only this
 * says which one the reader is looking at.
 */
function DataLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 py-6 text-center">
      <p className="text-sm text-px-error">Could not load live data: {message}. This is not the same as having no projects.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function DashboardHierarchyClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>("__all__");
  const [orgDashboard, setOrgDashboard] = useState<OrgDashboard | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(false);

  // R67 D-03: one outcome per panel, so an empty sentence is reachable only
  // from a 200 and a failure is never reachable at all without saying so.
  const [companiesStatus, setCompaniesStatus] = useState<PaneStatus>("loading");
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  // R67 MERGE (D-11, lane E2's E-37 x lane D0's D-03): the backend
  // (resolveHierarchyCompanies) already tells the caller WHY an empty list is
  // empty -- not-a-member vs no-company vs a real synthesised one -- and D-03's
  // discriminated getJson() carries it through just as cleanly as it carries
  // the failure message. "none" is the ready-and-populated case.
  const [companiesEmptyReason, setCompaniesEmptyReason] = useState<EmptyReason>("none");
  const [orgStatus, setOrgStatus] = useState<PaneStatus>("idle");
  const [orgError, setOrgError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [departmentsFailed, setDepartmentsFailed] = useState(false);
  // Bumped to re-run a panel's own effect -- the Retry the user pressed.
  const [companiesAttempt, setCompaniesAttempt] = useState(0);
  const [orgAttempt, setOrgAttempt] = useState(0);

  // Company level: load the current user's real memberships once, or the one
  // company the server synthesised from their own organisation when no
  // membership row names one (R67 E-37 -- see resolveHierarchyCompanies).
  useEffect(() => {
    let live = true;
    setCompaniesStatus("loading");
    setCompaniesError(null);
    void getJson<{ companies: Company[]; emptyReason?: EmptyReason }>("/api/dashboard-hierarchy/companies").then((result) => {
      if (!live) return;
      if (!result.ok) {
        // The rows are NOT cleared: a failed refresh must not destroy a list
        // the user could read a second ago.
        setCompaniesError(result.message);
        setCompaniesStatus("error");
        return;
      }
      const loaded = result.data.companies ?? [];
      setCompanies(loaded);
      setCompaniesEmptyReason(result.data.emptyReason ?? "none");
      setCompaniesStatus("ready");
      if (loaded.length > 0) setCompanyId((current) => current || loaded[0].id);
    });
    return () => {
      live = false;
    };
  }, [companiesAttempt]);

  // Department level: real HR departments for the selected company. This one
  // is a genuine convenience -- "All departments" is always available and the
  // dashboard below does not depend on it -- so its failure narrows the filter
  // rather than blocking the screen, and it says so beside the control.
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    setDepartmentId("__all__");
    setDepartmentsFailed(false);
    void getJson<{ departments: Department[] }>(`/api/dashboard-hierarchy/companies/${companyId}/departments`).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setDepartments([]);
        setDepartmentsFailed(true);
        return;
      }
      setDepartments(result.data.departments ?? []);
    });
    return () => {
      live = false;
    };
  }, [companyId]);

  // Project level: the company's (optionally department-filtered) project
  // list. R67 MERGE (D-11, lane E2's E-23): the From/To range is sent to this
  // SAME call, not just to the per-project Details read below -- it narrows
  // revenue and expenses server-side for the whole company chart too, and the
  // backend route already forwards `from`/`to` alongside `departmentId` (see
  // [companyId]/dashboard/route.ts). The BOQ-derived budget stays a property
  // of the BOQ line, not of a period, so a range does not touch it.
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    setProjectId("");
    setDetails(null);
    setOrgStatus("loading");
    setOrgError(null);
    const qs = new URLSearchParams();
    if (departmentId !== "__all__") qs.set("departmentId", departmentId);
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    void getJson<OrgDashboard>(`/api/dashboard-hierarchy/companies/${companyId}/dashboard${suffix}`).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setOrgError(result.message);
        setOrgStatus("error");
        return;
      }
      setOrgDashboard(result.data);
      setOrgStatus("ready");
    });
    return () => {
      live = false;
    };
  }, [companyId, departmentId, fromDate, toDate, orgAttempt]);

  // Details view: Revenue/Budget/Expense/Progress for the selected project, date-range filtered.
  function loadDetails() {
    if (!companyId || !projectId) return;
    setLoading(true);
    setDetailsError(null);
    const qs = new URLSearchParams();
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    void getJson<ProjectDetails>(`/api/dashboard-hierarchy/companies/${companyId}/projects/${projectId}?${qs.toString()}`)
      .then((result) => {
        // Without this branch a failed read left `details` null with `loading`
        // false, and the panel sat on the word "Loading..." for ever.
        if (!result.ok) {
          setDetailsError(result.message);
          setDetails(null);
          return;
        }
        setDetails(result.data);
      })
      .finally(() => setLoading(false));
  }
  useEffect(loadDetails, [companyId, projectId, fromDate, toDate]);

  // Point 121: a user-entered value always wins over the PO-derived
  // fallback -- editing it here is a deliberate human override.
  async function editProjectValue() {
    if (!projectId) return;
    const raw = window.prompt("Project value (leave blank to clear and fall back to linked purchase orders):", details?.projectValue?.toString() ?? "");
    if (raw === null) return;
    const projectValue = raw.trim() === "" ? null : Number(raw);
    if (projectValue !== null && !Number.isFinite(projectValue)) return;
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectValue }),
    });
    loadDetails();
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label className="text-xs">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.country ? ` (${c.country})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={!companyId}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {departmentsFailed && (
              <p className="text-xs" style={{ color: "var(--status-needs-you-text)" }}>
                Departments could not be loaded &mdash; showing all departments.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* R67 D-03: the sentence "No company memberships found for this
          account." is a statement about the ACCOUNT, and it may only be made
          on the strength of a 200 that carried no rows. mayShowEmptyState()
          decides that, here as on every other pane, so it cannot regress into
          a bare `companies.length === 0` again.
          R67 MERGE (D-11, lane E2's E-37): "no rows" is not one fact -- the
          backend now says WHICH of three it is, and this renders each with
          its own next step rather than the one flat sentence above. */}
      {companiesStatus === "error" && companiesError && (
        <DataLoadFailure message={companiesError} onRetry={() => setCompaniesAttempt((n) => n + 1)} />
      )}
      {mayShowEmptyState(companiesStatus, companies.length) && companiesEmptyReason === "no-company" && (
        <div className="space-y-2" data-testid="hierarchy-no-company">
          <p className="text-sm text-px-ink">This organisation is not set up as a company yet</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild><Link href="/settings">Set up company</Link></Button>
            <Button size="sm" variant="outline" asChild><Link href="/dashboard">Back to Dashboard</Link></Button>
          </div>
        </div>
      )}
      {mayShowEmptyState(companiesStatus, companies.length) && companiesEmptyReason === "not-a-member" && (
        <p className="text-sm text-px-ink" data-testid="hierarchy-not-a-member">
          Your account is not a member of any company yet. Ask an administrator to add you under{" "}
          <Link href="/settings" className="underline">Settings › Companies</Link>.
        </p>
      )}
      {mayShowEmptyState(companiesStatus, companies.length) && companiesEmptyReason === "none" && (
        <p className="text-sm text-px-muted">No company memberships found for this account.</p>
      )}

      {orgStatus === "error" && orgError && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <DataLoadFailure message={orgError} onRetry={() => setOrgAttempt((n) => n + 1)} />
          </CardContent>
        </Card>
      )}

      {orgStatus === "ready" && orgDashboard && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {mayShowEmptyState(orgStatus, orgDashboard.projects.length) ? (
              <p className="py-6 text-center text-sm text-px-muted">No projects in this scope.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Expenses</TableHead>
                    <TableHead>Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgDashboard.projects.map((p) => (
                    <TableRow
                      key={p.id}
                      data-state={p.id === projectId ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setProjectId(p.id)}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{fmt(p.revenue, currencies)}</TableCell>
                      <TableCell>{fmt(p.expenses, currencies)}</TableCell>
                      <TableCell>{p.taskCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {projectId && (
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading text-base">{details?.projectName ?? "Project details"}</CardTitle>
            {/* Real screen navigation (2026-08-30) -- cross-linking fix
                (module #36): this hierarchy drill-down never linked into the
                real per-project dashboard (/dashboard/project), which has its
                own richer KPI-tile view of the same project. */}
            <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/project?projectId=${projectId}`)}>Open Project Dashboard</Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9 w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9 w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              {details?.budgetIsPeriodTotal && (
                <p className="text-xs text-px-muted">Budget is an annual allocation and is not affected by the date range.</p>
              )}
              {details && (
                <Button variant="outline" size="sm" onClick={editProjectValue}>
                  {details.projectValue !== null ? "Edit Project Value" : "Set Project Value"}
                </Button>
              )}
            </div>

            {detailsError ? (
              // The KPI tiles below read money and a percentage. Rendering
              // them from a failed read is R-002/R-019 exactly, and worse than
              // a false empty list, because a figure carries no hint that
              // anything was ever asked for.
              <DataLoadFailure message={detailsError} onRetry={loadDetails} />
            ) : loading || !details ? (
              <p className="py-6 text-center text-sm text-px-muted">Loading...</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {details.projectValue !== null && (
                    <DashboardCard title="Project Value" value={fmt(details.projectValue, currencies)} icon={Landmark} variant="total" />
                  )}
                  <DashboardCard title="Revenue" value={fmt(details.revenue, currencies)} icon={TrendingUp} variant="completed" />
                  <DashboardCard title="Budget" value={fmt(details.budget, currencies)} icon={Wallet} variant="total" />
                  <DashboardCard title="Expenses" value={fmt(details.expenses, currencies)} icon={Receipt} variant="pending" />
                  <DashboardCard title="Progress" value={`${details.progressPercent}%`} icon={Activity} variant="total" />
                </div>
                {details.revenueTruncated && (
                  <p className="text-xs text-destructive">Revenue figures may be incomplete for this date range (too many invoices to load in full).</p>
                )}
              </div>
            )}

            <CategoryDistributionCharts companyId={companyId} projectId={projectId} />
          </CardContent>
        </Card>
      )}

      {!projectId && orgStatus === "ready" && orgDashboard && orgDashboard.projects.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-px-muted"><Building2 className="size-4" /> Select a project above to see its graphical detail report.</p>
      )}
    </div>
  );
}
