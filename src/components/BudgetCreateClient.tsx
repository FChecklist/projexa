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
import { type Company } from "@/components/company-scope";

/**
 * R67 D-62, correction C-15. The precondition itself is correct and stays: this
 * screen writes an ERP budget, and an ERP budget needs a fiscal year and an
 * account. What was wrong was WHERE it was said -- a 30-word sentence inside the
 * primary button. These two functions are the split: the long form for the
 * banner, the short form for the button.
 *
 * "needs a fiscal year and an account" is the exact wording C-15 specifies, and
 * the singular/plural is deliberate: the button names the THINGS required, not
 * the empty collections behind them.
 */
export function shortBlockedReason(missing: readonly string[]): string {
  const words = missing.map((m) => (m === "fiscal years" ? "a fiscal year" : "an account"));
  return `needs ${words.join(" and ")}`;
}

export function blockedBanner(missing: readonly string[]): string {
  return `This organisation has no ${missing.join(" and ")} in VERIDIAN's ERP module yet, and both are required to create a budget. They must be set up in VERIDIAN before a budget can be created here.`;
}

/**
 * Where the banner's link goes. VERIDIAN's own ERP setup screens live on the
 * compliance-tracker app, whose origin veridian-client already resolves from
 * VERIDIAN_API_BASE_URL -- but that is a SERVER module and this is a client
 * component, so the origin is threaded in as a prop by the page (which can read
 * it). Not a guessed path: /erp/periods is compliance-tracker's real fiscal-year
 * and period screen (src/app/(app)/erp/periods/page.tsx), which is where the
 * first of the two missing things is created.
 */
export const VERIDIAN_ERP_SETUP_PATH = "/erp/periods";

/** The full destination, or null when no VERIDIAN origin was resolvable. */
export function erpSetupHref(veridianOrigin: string | null | undefined): string | null {
  const origin = veridianOrigin?.trim();
  return origin ? `${origin.replace(/\/$/, "")}${VERIDIAN_ERP_SETUP_PATH}` : null;
}

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };

export default function BudgetCreateClient({ veridianOrigin }: { veridianOrigin?: string | null }) {
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
  const [errors, setErrors] = useState<FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount">>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      setLookupsLoading(true);
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
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load fiscal years / cost centers / accounts from VERIDIAN"));
      } finally {
        setLookupsLoading(false);
      }
    })();
  }, []);

  const missingLookups = [
    fiscalYears.length === 0 ? "fiscal years" : null,
    accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  const blockedReason = missingLookups.length ? blockedBanner(missingLookups) : null;
  // R67 D-62 / correction C-15: the 30-word sentence above used to be the
  // BUTTON's label -- "Save (This organisation has no fiscal years and a chart
  // of accounts in VERIDIAN's ERP module yet, and both are ...)". The banner
  // keeps the sentence; the button gets the four words that name what is
  // missing, and the banner gains the link that fixes it.
  const shortReason = missingLookups.length ? shortBlockedReason(missingLookups) : null;

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
      router.push(`/finance/budgets/${data.id}`);
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
      onCancel={() => router.push("/finance/budgets")}
      onBack={() => router.push("/finance/budgets")}
      saveDisabled={submitting || lookupsLoading || blockedReason !== null}
      // C-15: four words, not a paragraph. "Save (needs a fiscal year and an
      // account)" -- the sentence that used to be here is the banner below.
      saveDisabledReason={submitting ? "Creating…" : shortReason ?? undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {blockedReason && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <p>{blockedReason}</p>
            {/* C-15: the banner names the block AND opens the screen that
                clears it. Rendered only when a VERIDIAN origin was actually
                resolved -- a link to nowhere is worse than no link. */}
            {erpSetupHref(veridianOrigin) && (
              <a
                href={erpSetupHref(veridianOrigin)!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-medium underline"
              >
                Set up in VERIDIAN
              </a>
            )}
          </div>
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
