"use client";

// R67 E-02 (R-012): "/dashboard/hierarchy is retired as a destination -- move
// its Company and Department selects into a Filter drawer on the home that
// re-queries the org payload with ?companyId&departmentId (add the date range
// there too)".
//
// This IS those selects, not a reimplementation: same two endpoints
// DashboardHierarchyClient called (/api/dashboard-hierarchy/companies and
// .../companies/{id}/departments), same meaning for "Company" (a PROJEXA org
// the signed-in user is a member of -- see src/lib/company-scope.ts for why
// that is not VERIDIAN's erp_companies).
//
// THE STATE LIVES IN THE URL, deliberately. The home page is a Server
// Component that fetches the payload itself, so a filter held in React state
// could only ever filter what had already arrived. Pushing the parameters into
// the URL re-runs the real server fetch, makes the filtered view shareable,
// and makes Back undo the filter -- three things a drawer-local useState gives
// away for nothing.
//
// The date range is captioned for exactly what it does. It narrows revenue and
// spend; it does not narrow contract value, earned value or the percentages,
// because those are point-in-time facts about the current BOQ rather than sums
// over a window (see compliance-tracker OrgDashboardFilters).

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";

type Company = { id: string; name: string };
type Department = { id: string; name: string };

/** The "no choice made" value: shadcn's Select cannot hold an empty-string item value. */
const ALL = "__all__";

export const DASHBOARD_FILTER_PARAMS = ["companyId", "departmentId", "from", "to"] as const;

/** Turns the drawer's four fields into the querystring the home page reads. Exported so it can be tested without a DOM. */
export function buildDashboardFilterQuery(fields: {
  companyId?: string | null;
  departmentId?: string | null;
  from?: string | null;
  to?: string | null;
}): string {
  const params = new URLSearchParams();
  if (fields.companyId && fields.companyId !== ALL) params.set("companyId", fields.companyId);
  if (fields.departmentId && fields.departmentId !== ALL) params.set("departmentId", fields.departmentId);
  if (fields.from) params.set("from", fields.from);
  if (fields.to) params.set("to", fields.to);
  return params.toString();
}

/** The words under the figures a range really narrowed. Null when no range is set, so nothing is captioned that was not filtered. */
export function dateRangeCaption(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  if (from && to) return `Revenue and spend shown for ${from} to ${to}. Contract value and progress are current figures and are not date-filtered.`;
  if (from) return `Revenue and spend shown from ${from}. Contract value and progress are current figures and are not date-filtered.`;
  return `Revenue and spend shown up to ${to}. Contract value and progress are current figures and are not date-filtered.`;
}

export function DashboardFilterDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyId, setCompanyId] = useState(searchParams.get("companyId") ?? ALL);
  const [departmentId, setDepartmentId] = useState(searchParams.get("departmentId") ?? ALL);
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  const activeCount = DASHBOARD_FILTER_PARAMS.filter((p) => searchParams.get(p)).length;

  // Only fetched once the drawer is actually opened -- the home page's job is
  // to render the reader's numbers fast, and two lookups nobody has asked for
  // yet are two lookups competing with that.
  useEffect(() => {
    if (!open || companies.length > 0) return;
    let cancelled = false;
    fetch("/api/dashboard-hierarchy/companies")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setCompanies(Array.isArray(d.companies) ? d.companies : []); })
      .catch(() => { if (!cancelled) setCompanies([]); });
    return () => { cancelled = true; };
  }, [open, companies.length]);

  useEffect(() => {
    if (!open || companyId === ALL) { setDepartments([]); return; }
    let cancelled = false;
    fetch(`/api/dashboard-hierarchy/companies/${encodeURIComponent(companyId)}/departments`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setDepartments(Array.isArray(d.departments) ? d.departments : []); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, [open, companyId]);

  function apply() {
    const qs = buildDashboardFilterQuery({ companyId, departmentId, from, to });
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  function clear() {
    setCompanyId(ALL);
    setDepartmentId(ALL);
    setFrom("");
    setTo("");
    router.push(pathname);
    setOpen(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="dashboard-filter-toggle">
          <SlidersHorizontal className="size-4" />
          {activeCount > 0 ? `Filter (${activeCount})` : "Filter"}
        </Button>
      </div>

      {open && (
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setDepartmentId(ALL); }}>
                <SelectTrigger className="w-60" data-testid="dashboard-filter-company"><SelectValue placeholder="All companies" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId} disabled={companyId === ALL}>
                <SelectTrigger className="w-60" data-testid="dashboard-filter-department">
                  <SelectValue placeholder={companyId === ALL ? "Pick a company first" : "All departments"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>

            <Button onClick={apply} data-testid="dashboard-filter-apply">Apply</Button>
            <Button variant="ghost" onClick={clear} data-testid="dashboard-filter-clear">Clear</Button>

            <p className="w-full text-[11.5px] text-px-muted">
              A date range narrows Revenue and Spend. Contract value, earned value and the progress
              percentages are current figures for the live BOQ and are never date-filtered.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
