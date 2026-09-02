"use client";

// Real-screen conversion (2026-08-30) -- replaces BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same
// live VERIDIAN lookups, same blocked-reason honesty when fiscal
// years/chart of accounts aren't provisioned.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { isAbortError } from "@/lib/module-list-state";
import { type Company } from "@/components/company-scope";

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };

export default function BudgetCreateClient() {
  const router = useRouter();
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [budgetCompanyId, setBudgetCompanyId] = useState<string>("__none__");
  const [failedLookups, setFailedLookups] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount">>({});
  const [submitting, setSubmitting] = useState(false);

  // R67 F-19 (R-245). THIS WAS Promise.all, AND THAT WAS THE BUG: one failed
  // lookup rejected the whole batch, so a 500 on /api/companies -- a field
  // that is optional on this form -- blanked the fiscal years and the chart of
  // accounts too, and the screen then told the user this organisation HAS no
  // fiscal years. That is a failed read reported as a fact about their data
  // (the empty-state-honesty rule in read-outcome.ts).
  //
  // allSettled keeps each lookup's outcome separate, and `failed` records
  // which ones did not answer, so "we could not find out" and "there are none"
  // are never again the same sentence.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLookupsLoading(true);
      const [fyR, ccR, acR, coR] = await Promise.allSettled([
        fetchJson<{ fiscalYears?: FiscalYear[] }>("/api/fiscal-years", { signal: controller.signal }),
        fetchJson<{ costCenters?: CostCenter[] }>("/api/cost-centers", { signal: controller.signal }),
        fetchJson<{ accounts?: Account[] }>("/api/accounts", { signal: controller.signal }),
        fetchJson<{ companies?: Company[] }>("/api/companies", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      const failures: string[] = [];
      if (fyR.status === "fulfilled") setFiscalYears(fyR.value.fiscalYears ?? []);
      else if (!isAbortError(fyR.reason, controller.signal)) failures.push("fiscal years");

      if (ccR.status === "fulfilled") setCostCenters(ccR.value.costCenters ?? []);
      else if (!isAbortError(ccR.reason, controller.signal)) failures.push("cost centres");

      if (acR.status === "fulfilled") setAccounts(acR.value.accounts ?? []);
      else if (!isAbortError(acR.reason, controller.signal)) failures.push("the chart of accounts");

      if (coR.status === "fulfilled") setCompanies(coR.value.companies ?? []);
      else if (!isAbortError(coR.reason, controller.signal)) failures.push("companies");

      setFailedLookups(failures);
      if (failures.length) toast.error(`Couldn't load ${failures.join(", ")} from VERIDIAN`);
      setLookupsLoading(false);
    })();
    return () => controller.abort();
  }, []);

  // A lookup that FAILED is not a lookup that came back empty. The first is a
  // fault to retry; the second is a real org-setup precondition.
  const failedRequired = failedLookups.filter((f) => f === "fiscal years" || f === "the chart of accounts");
  const missingLookups = [
    !failedLookups.includes("fiscal years") && fiscalYears.length === 0 ? "fiscal years" : null,
    !failedLookups.includes("the chart of accounts") && accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  const blockedReason = failedRequired.length
    ? `Couldn't load ${failedRequired.join(" and ")} from VERIDIAN, so this form can't tell whether a budget can be created yet. Reload to retry.`
    : missingLookups.length
    ? `This organisation has no ${missingLookups.join(" and ")} in VERIDIAN's ERP module yet, and both are required to create a budget. They must be set up in VERIDIAN before a budget can be created here.`
    : null;

  async function createBudget() {
    const errs: FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount"> = {};
    if (!name.trim()) errs.name = "Budget name is required.";
    if (!fiscalYearId) errs.fiscalYearId = fiscalYears.length
      ? "Select a fiscal year."
      : failedLookups.includes("fiscal years")
        ? "Couldn't load fiscal years from VERIDIAN."
        : "No fiscal years exist in VERIDIAN for this organisation.";
    if (!accountId.trim()) errs.accountId = accounts.length
      ? "Select an account."
      : failedLookups.includes("the chart of accounts")
        ? "Couldn't load the chart of accounts from VERIDIAN."
        : "No chart of accounts exists in VERIDIAN for this organisation.";
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
      saveDisabled={submitting || lookupsLoading || blockedReason !== null}
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
