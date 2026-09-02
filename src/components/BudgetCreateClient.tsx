"use client";

// Real-screen conversion (2026-08-30) -- replaces BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same
// live VERIDIAN lookups, same blocked-reason honesty when fiscal
// years/chart of accounts aren't provisioned.
//
// R67 F-08 (R-112) -- NO ENABLED-THEN-DISABLED FLIP. This form used to render
// four ENABLED selects and then, once its own client-side Promise.all
// returned, flip them to disabled with "No fiscal years found in VERIDIAN"
// inside them. A form that offers a control and then withdraws it is worse
// than one that never offered it: the user has already decided to click.
//
// The four lookups now arrive as props, resolved server-side in
// budgets/new/page.tsx behind a 300 s per-org cache (D-04: the VERIDIAN key
// stays server-side, which is why the browser could not do this itself). So
// the first rendered frame already knows whether the org is set up.
//
// The only client-side fetch left is behind "Reload lists", for the case the
// server lookups reported a FAILURE rather than an empty org -- those are
// different facts and the form says which one it is.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { type Company } from "@/components/company-scope";
import type { Account, BudgetLookups, CostCenter, FiscalYear } from "@/lib/budget-lookups";

export default function BudgetCreateClient({ initialLookups }: { initialLookups: BudgetLookups }) {
  const router = useRouter();
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>(initialLookups.fiscalYears);
  const [costCenters, setCostCenters] = useState<CostCenter[]>(initialLookups.costCenters);
  const [accounts, setAccounts] = useState<Account[]>(initialLookups.accounts);
  const [companies, setCompanies] = useState<Company[]>(initialLookups.companies);
  const [lookupError, setLookupError] = useState<string | null>(initialLookups.errorMessage);
  const [reloading, setReloading] = useState(false);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [budgetCompanyId, setBudgetCompanyId] = useState<string>("__none__");
  const [errors, setErrors] = useState<FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount">>({});
  const [submitting, setSubmitting] = useState(false);

  // Only reachable when the server-side lookups actually FAILED -- an org that
  // simply has no fiscal years has nothing to reload.
  async function reloadLists() {
    setReloading(true);
    try {
      const [fyData, ccData, acData, coData] = await Promise.all([
        fetchJson<{ fiscalYears?: FiscalYear[] }>("/api/fiscal-years"),
        fetchJson<{ costCenters?: CostCenter[] }>("/api/cost-centers"),
        fetchJson<{ accounts?: Account[] }>("/api/accounts"),
        fetchJson<{ companies?: Company[] }>("/api/companies"),
      ]);
      setFiscalYears(fyData.fiscalYears ?? []);
      setCostCenters(ccData.costCenters ?? []);
      setAccounts(acData.accounts ?? []);
      setCompanies(coData.companies ?? []);
      setLookupError(null);
    } catch (err) {
      setLookupError(errorMessage(err, "Couldn't load fiscal years / cost centers / accounts from VERIDIAN"));
    } finally {
      setReloading(false);
    }
  }

  const missingLookups = [
    fiscalYears.length === 0 ? "fiscal years" : null,
    accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  // A failed lookup and an unconfigured org are DIFFERENT facts and must not
  // share a message: the first is a retry, the second is a setup task.
  const blockedReason = lookupError
    ? `${lookupError}. Nothing has been saved — use Reload lists to try again.`
    : missingLookups.length
      ? `This organisation has no ${missingLookups.join(" and ")} in VERIDIAN's ERP module yet, and both are required to create a budget. They must be set up in VERIDIAN before a budget can be created here.`
      : null;

  async function createBudget() {
    const errs: FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount"> = {};
    if (!name.trim()) errs.name = "Budget name is required.";
    if (!fiscalYearId) errs.fiscalYearId = fiscalYears.length ? "Select a fiscal year." : "No fiscal years exist in VERIDIAN for this organisation.";
    if (!accountId.trim()) errs.accountId = accounts.length ? "Select an account." : "No chart of accounts exists in VERIDIAN for this organisation.";
    if (!annualAmount) errs.annualAmount = "Annual amount is required.";
    else if (Number.isNaN(Number(annualAmount))) errs.annualAmount = "Annual amount must be a number.";
    setErrors(errs);
    if (hasErrors(errs)) return;
    setSubmitting(true);
    try {
      const data = await fetchJson<{ id: string }>("/api/project-budgets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, fiscalYearId, costCenterId: costCenterId || undefined,
          companyId: budgetCompanyId === "__none__" ? undefined : budgetCompanyId,
          lineItems: [{ accountId, annualAmount: Number(annualAmount) }],
        }),
      });
      toast.success("Budget created");
      router.push(`/budgets/${data.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create budget"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Budgets / New Budget"
      title="New Budget"
      mode="create"
      hasDraft={false}
      onSave={createBudget}
      onCancel={() => router.push("/budgets")}
      onBack={() => router.push("/budgets")}
      saveDisabled={submitting || reloading || blockedReason !== null}
      saveDisabledReason={submitting ? "Creating…" : reloading ? "Reloading lists…" : blockedReason ?? undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {blockedReason && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {blockedReason}
            {lookupError && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={reloadLists}
                  disabled={reloading}
                  className="underline underline-offset-2 disabled:opacity-60"
                >
                  {reloading ? "Reloading…" : "Reload lists"}
                </button>
              </>
            )}
          </p>
        )}
        <FormField label="Budget Name" required error={errors.name}>
          {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField label="Fiscal Year" required error={errors.fiscalYearId}>
          {(f) => (
            <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
              <SelectTrigger {...f} disabled={fiscalYears.length === 0}><SelectValue placeholder={fiscalYears.length ? "Select a fiscal year" : "No fiscal years found in VERIDIAN"} /></SelectTrigger>
              <SelectContent>{fiscalYears.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.yearName}{fy.isClosed ? " (closed)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Cost Center (optional)">
          {(f) => (
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger {...f} disabled={costCenters.length === 0}><SelectValue placeholder={costCenters.length ? "Select a cost center" : "No cost centers found in VERIDIAN"} /></SelectTrigger>
              <SelectContent>{costCenters.map((cc) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Account" required error={errors.accountId}>
          {(f) => (
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger {...f} disabled={accounts.length === 0}><SelectValue placeholder={accounts.length ? "Select an account" : "No chart of accounts found in VERIDIAN"} /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Annual Amount" required error={errors.annualAmount}>
          {(f) => <Input {...f} type="number" value={annualAmount} onChange={(e) => setAnnualAmount(e.target.value)} />}
        </FormField>
        {companies.length > 0 && (
          <div className="space-y-1.5">
            <Label>Company / Office (optional)</Label>
            <Select value={budgetCompanyId} onValueChange={setBudgetCompanyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Org-wide (no specific company)</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
