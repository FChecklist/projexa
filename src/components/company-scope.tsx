"use client";

// Priority 17 Wave 1 built this pattern for AccountingClient.tsx (erp_
// companies -- a legal entity/office WITHIN this org's ERP, distinct from
// the org itself; VERIDIAN's resolveCompanyScope rolls a report up through
// the parent-child company tree at report-runtime when consolidate=true,
// never a stored "group GL"). Priority 17's remaining-gap pass (2026-07-15)
// extracted it here so Reports & Analysis/Budgets/Sales-CRM/HR can REUSE the
// same selector instead of each page growing its own copy -- AccountingClient.tsx
// itself was refactored to import from here, not left with a second parallel
// definition.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";

export type Company = {
  id: string;
  companyName: string;
  abbr: string | null;
  parentCompanyId: string | null;
  isGroup: boolean;
  defaultCurrencyId: string | null;
  country: string | null;
  dateOfIncorporation: string | null;
  isActive: boolean;
};

export type CompanyScope = { companyId: string | null; consolidate: boolean };

export function companyScopeQuery(scope: CompanyScope): string {
  if (!scope.companyId) return "";
  return `&companyId=${scope.companyId}&consolidate=${scope.consolidate}`;
}

// Same helper, but for a caller building its OWN querystring from scratch
// (no leading `&`) -- Leads/Employees/Leave/Budgets don't already have a
// query string in progress the way the Accounting report panels do.
export function companyIdParam(scope: CompanyScope): string {
  return scope.companyId ? `companyId=${scope.companyId}` : "";
}

// ---------------------------------------------------------------------------
// Company / office selector. Shared across every page that can filter by
// erp_companies -- do not fork a second copy of this component; add a prop
// here if a page needs different behavior.
// ---------------------------------------------------------------------------
export function CompanySelector({
  companies,
  scope,
  onChange,
  showConsolidateToggle = true,
}: {
  companies: Company[];
  scope: CompanyScope;
  onChange: (scope: CompanyScope) => void;
  // Consolidate ("+ sub-companies") only makes sense for financial roll-up
  // reports (Trial Balance/P&L/Balance Sheet) where erp_journal_entries
  // aggregates across a company tree. Leads/Employees/Leave/Budgets filter
  // by a single company's own companyId column directly -- there is no
  // tree-walk for those tables, so this toggle is hidden by default for
  // non-Accounting callers rather than shown and silently doing nothing.
  showConsolidateToggle?: boolean;
}) {
  if (companies.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2.5">
      <Building2 className="mt-2 size-4 text-px-muted" />
      <div className="space-y-1.5">
        <Label className="text-xs">Company / Office</Label>
        <Select
          value={scope.companyId ?? "__all__"}
          onValueChange={(v) => onChange({ companyId: v === "__all__" ? null : v, consolidate: scope.consolidate })}
        >
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All companies (org-wide)</SelectItem>
            {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {showConsolidateToggle && scope.companyId && (
        <div className="space-y-1.5">
          <Label className="text-xs">Scope</Label>
          <Select value={scope.consolidate ? "consolidated" : "own"} onValueChange={(v) => onChange({ companyId: scope.companyId, consolidate: v === "consolidated" })}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="own">This company only</SelectItem>
              <SelectItem value="consolidated">Consolidated (+ sub-companies)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
