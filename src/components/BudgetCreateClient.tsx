"use client";

// Real-screen conversion (2026-08-30) -- replaces BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same
// live VERIDIAN lookups, same blocked-reason honesty when fiscal
// years/chart of accounts aren't provisioned.
//
// R67 E-06 (R-108): THE FOUR REFERENCE LOOKUPS ARE NO LONGER FETCHED HERE.
// Fiscal years, cost centres, accounts and companies are org setup data that
// changes about once a year; fetching them from a mount effect meant the form
// rendered EMPTY first, every single time -- with "No fiscal years found in
// VERIDIAN" and a blocked Save reason on screen -- and then repainted itself
// a second later with the real lists. A reader who acted on the first paint
// was told this org cannot create a budget, which was not true.
//
// They now arrive as props, resolved server-side in budgets/new/page.tsx with
// one Promise.all behind a 5-minute per-org cache, so the form renders ONCE,
// in its true state. This component keeps every other behaviour it had.
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

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };

export type BudgetLookups = {
  fiscalYears: FiscalYear[];
  costCenters: CostCenter[];
  accounts: Account[];
  companies: Company[];
  /**
   * The backend's own sentence when a lookup could not be read. It is
   * rendered, not swallowed: "we could not ask" and "there are none" are
   * different facts and the blocked reason below must not claim the second
   * when the first happened.
   */
  errorMessage: string | null;
};

export default function BudgetCreateClient({ lookups }: { lookups: BudgetLookups }) {
  const router = useRouter();
  const { fiscalYears, costCenters, accounts, companies } = lookups;

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [budgetCompanyId, setBudgetCompanyId] = useState<string>("__none__");
  const [errors, setErrors] = useState<FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount">>({});
  const [submitting, setSubmitting] = useState(false);

  const missingLookups = [
    fiscalYears.length === 0 ? "fiscal years" : null,
    accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  // A read that FAILED may not report "this org has none" -- it reports that
  // it could not ask, in the backend's own words.
  const blockedReason = lookups.errorMessage
    ? `Could not load fiscal years / cost centres / accounts from VERIDIAN: ${lookups.errorMessage}`
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
      saveDisabled={submitting || blockedReason !== null}
      saveDisabledReason={submitting ? "Creating…" : blockedReason ?? undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {blockedReason && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">{blockedReason}</p>
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
