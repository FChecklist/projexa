"use client";

// Real-screen conversion (2026-08-30) -- replaces BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same
// live VERIDIAN lookups, same blocked-reason honesty when fiscal
// years/chart of accounts aren't provisioned.
//
// R67 D-42 (audit R-109/R-111/R-116, and correction C-15). The block itself
// was CORRECT -- an org with no fiscal year and no chart of accounts genuinely
// cannot have a budget -- but everything around it was wrong, in four ways
// that all come down to the same thing: the screen knew what was wrong and
// gave the user nothing to do about it.
//
//   * A 200-character explanation lived INSIDE the Save button's label. A
//     button says what it does; it is not a paragraph. The button now carries
//     the short reason, "Save (needs fiscal year and account)", and the
//     explanation lives in an alert where an explanation belongs.
//   * The alert repeated the same sentence and offered no way forward. It now
//     carries an ACTION: an admin gets "Set up in Accounting →"; everyone else
//     gets "Ask your administrator", which files a real task rather than
//     telling a site engineer to go and do something their role forbids.
//   * The two text inputs stayed enabled while the form could not be saved, so
//     a user could type a budget name and an amount into a form that was never
//     going to accept them. They are disabled with the short reason as their
//     title -- and disabled from the FIRST paint, while the lookups are still
//     in flight, so the form never flips from enabled to blocked in front of
//     someone mid-keystroke.
//   * When the org is NOT blocked, the Save button counted nothing: it was
//     enabled and failed on click. It now carries this product's counting form
//     ("Save (2 required fields)", matching /labour/new) and each field
//     validates on blur, at the field.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatMoney, resolveCurrencyCode } from "@/lib/format-money";
import { useCurrencies } from "@/lib/currency";
import { ROLE_GROUPS } from "@/lib/authz/roles";
import { type Company } from "@/components/company-scope";

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };

/** The button's half of the block. A label, not a paragraph. */
export const BLOCKED_SHORT_REASON = "needs fiscal year and account";

/** The alert's half. The whole sentence, once, where it can be read. */
export const BLOCKED_ALERT_TITLE = "This organisation is not set up for budgets yet";
export const BLOCKED_ALERT_BODY =
  "This organisation has no fiscal year or chart of accounts yet, so a budget cannot be saved.";

export const ADMIN_ACTION_LABEL = "Set up in Accounting →";
export const NON_ADMIN_ACTION_LABEL = "Ask your administrator";

// The task filed on a non-admin's behalf. Deliberately the sentence a person
// would write, because it is read by a person in the left pane.
export const ADMIN_TASK_TEXT = "Set up fiscal year — needs admin";

// PROJEXA has no fiscal-year or chart-of-accounts CREATE screen of its own --
// both are provisioned in VERIDIAN's ERP -- so this link goes to the Accounting
// module, which is PROJEXA's surface onto it and the place an admin starts.
// Deliberately a route that exists: a "next step" that 404s is worse than none.
export const ACCOUNTING_SETUP_ROUTE = "/accounting";

/** Only the org's own admins can provision an ERP fiscal year. */
function canSetUpAccounting(role: string | null | undefined): boolean {
  return !!role && (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(role);
}

export default function BudgetCreateClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const currencyCode = resolveCurrencyCode(currencies);

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [budgetCompanyId, setBudgetCompanyId] = useState<string>("__none__");
  const [errors, setErrors] = useState<FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount">>({});
  const [submitting, setSubmitting] = useState(false);
  const [askState, setAskState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [askError, setAskError] = useState<string | null>(null);

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

  // The acting user's own role decides which way forward this screen can offer.
  // A failure here is not fatal: the non-admin path (filing a task) is the safe
  // default, because it never sends someone to a screen their role rejects.
  useEffect(() => {
    fetchJson<{ role?: string | null }>("/api/organization")
      .then((data) => setRole(data.role ?? null))
      .catch(() => setRole(null));
  }, []);

  const blockedReason = useMemo(() => {
    if (lookupsLoading) return null;
    return fiscalYears.length === 0 || accounts.length === 0 ? BLOCKED_SHORT_REASON : null;
  }, [lookupsLoading, fiscalYears.length, accounts.length]);

  // Disabled from the first paint and only ever RELAXED, never tightened --
  // that is what stops the form flipping from enabled to blocked mid-keystroke.
  const fieldsDisabled = lookupsLoading || blockedReason !== null;
  const fieldsDisabledTitle = lookupsLoading ? "Loading…" : blockedReason ?? undefined;

  const missingFields = useMemo(
    () => missingRequiredFields({ name, fiscalYearId, accountId, annualAmount }),
    [name, fiscalYearId, accountId, annualAmount]
  );

  const saveDisabledReason = submitting
    ? "Creating…"
    : lookupsLoading
      ? "Loading…"
      : blockedReason
        ? blockedReason
        : requiredFieldsReason(missingFields.length);

  function validateOnBlur(field: "name" | "fiscalYearId" | "accountId" | "annualAmount") {
    setErrors((prev) => ({ ...prev, [field]: fieldError(field) }));
  }

  function fieldError(field: "name" | "fiscalYearId" | "accountId" | "annualAmount"): string | undefined {
    switch (field) {
      case "name":
        return name.trim() ? undefined : "Budget name is required.";
      case "fiscalYearId":
        return fiscalYearId ? undefined : "Select a fiscal year.";
      case "accountId":
        return accountId ? undefined : "Select an account.";
      case "annualAmount": {
        const raw = parseAmount(annualAmount);
        if (!annualAmount.trim()) return "Annual amount is required.";
        if (raw === null) return "Annual amount must be a number.";
        return undefined;
      }
    }
  }

  // The stored value is always the plain number; the DISPLAY groups thousands
  // once the field loses focus, so a user editing "150000" is never fighting
  // separators mid-keystroke.
  const amountDisplay = amountFocused || !annualAmount.trim()
    ? annualAmount
    : (() => {
        const parsed = parseAmount(annualAmount);
        return parsed === null ? annualAmount : formatMoney(parsed, null);
      })();

  const askAdministrator = useCallback(async () => {
    setAskState("sending");
    setAskError(null);
    try {
      // A real pipeline task, on the same surface the left pane reads, so the
      // request appears under "Waiting on others" rather than evaporating.
      await fetchJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: ADMIN_TASK_TEXT, mode: "projects", projectId: null }),
      });
      setAskState("sent");
    } catch (err) {
      setAskState("failed");
      setAskError(errorMessage(err, "Couldn't send that request"));
    }
  }, []);

  async function createBudget() {
    const errs: FieldErrors<"name" | "fiscalYearId" | "accountId" | "annualAmount"> = {
      name: fieldError("name"),
      fiscalYearId: fieldError("fiscalYearId"),
      accountId: fieldError("accountId"),
      annualAmount: fieldError("annualAmount"),
    };
    setErrors(errs);
    if (hasErrors(errs)) return;
    setSubmitting(true);
    try {
      const data = await fetchJson<{ id: string }>("/api/project-budgets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, fiscalYearId, costCenterId: costCenterId || undefined,
          companyId: budgetCompanyId === "__none__" ? undefined : budgetCompanyId,
          lineItems: [{ accountId, annualAmount: parseAmount(annualAmount) }],
        }),
      });
      // The receipt names the thing that was created and travels with the
      // navigation, so it is on the object page the user actually lands on.
      router.push(`/budgets/${data.id}?created=${encodeURIComponent(name)}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create budget"));
    } finally {
      setSubmitting(false);
    }
  }

  const isAdmin = canSetUpAccounting(role);

  return (
    <ObjectScreen
      breadcrumb="Budgets / New Budget"
      title="New Budget"
      mode="create"
      hasDraft={false}
      onSave={createBudget}
      onCancel={() => router.push("/budgets")}
      onBack={() => router.push("/budgets")}
      saveDisabled={submitting || lookupsLoading || blockedReason !== null || missingFields.length > 0}
      saveDisabledReason={saveDisabledReason}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {blockedReason && (
          <div
            role="alert"
            className="space-y-2 rounded-md border p-3 text-xs"
            style={{ borderColor: "var(--color-veri-status-late)", color: "var(--color-veri-status-late)" }}
          >
            <p className="font-semibold">{BLOCKED_ALERT_TITLE}</p>
            <p>{BLOCKED_ALERT_BODY}</p>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin ? (
                <Button type="button" variant="outline" size="sm" onClick={() => router.push(ACCOUNTING_SETUP_ROUTE)}>
                  {ADMIN_ACTION_LABEL}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={askState === "sending" || askState === "sent"}
                  onClick={askAdministrator}
                >
                  {askState === "sending"
                    ? "Sending…"
                    : askState === "sent"
                      ? "Sent — your administrator has been asked"
                      : NON_ADMIN_ACTION_LABEL}
                </Button>
              )}
            </div>
            {askError && <p className="text-px-error">{askError}</p>}
          </div>
        )}

        <FormField label="Budget Name" required error={errors.name}>
          {(f) => (
            <Input
              {...f}
              value={name}
              disabled={fieldsDisabled}
              title={fieldsDisabledTitle}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => validateOnBlur("name")}
            />
          )}
        </FormField>
        <FormField label="Fiscal Year" required error={errors.fiscalYearId}>
          {(f) => (
            <Select value={fiscalYearId} onValueChange={(next) => { setFiscalYearId(next); setErrors((p) => ({ ...p, fiscalYearId: undefined })); }}>
              <SelectTrigger {...f} disabled={fiscalYears.length === 0} title={fieldsDisabledTitle}><SelectValue placeholder={fiscalYears.length ? "Select a fiscal year" : "No fiscal years found in VERIDIAN"} /></SelectTrigger>
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
            <Select value={accountId} onValueChange={(next) => { setAccountId(next); setErrors((p) => ({ ...p, accountId: undefined })); }}>
              <SelectTrigger {...f} disabled={accounts.length === 0} title={fieldsDisabledTitle}><SelectValue placeholder={accounts.length ? "Select an account" : "No chart of accounts found in VERIDIAN"} /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Annual Amount" required error={errors.annualAmount}>
          {(f) => (
            // The currency is a FIXED prefix rather than something the user has
            // to type or guess: materials, budgets and the dashboard all read
            // in the org's own currency, and a bare number in a money field is
            // the ambiguity this programme is removing everywhere else.
            <div className="flex items-center gap-2">
              {currencyCode && <span className="text-[13px] text-px-muted" aria-hidden>{currencyCode}</span>}
              <Input
                {...f}
                type="text"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={amountDisplay}
                disabled={fieldsDisabled}
                title={fieldsDisabledTitle}
                onFocus={() => setAmountFocused(true)}
                onChange={(e) => setAnnualAmount(e.target.value)}
                onBlur={() => { setAmountFocused(false); validateOnBlur("annualAmount"); }}
              />
            </div>
          )}
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

/**
 * The four fields a budget cannot be saved without. Pure and exported so the
 * Save label's counting form can be exercised directly -- this repo's test
 * environment cannot type into a field (see MaterialIssueCreateClient.test.tsx's
 * header for the measured reason), so the count is proved here and the label
 * that renders it is proved in the component test.
 */
export function missingRequiredFields(values: {
  name: string;
  fiscalYearId: string;
  accountId: string;
  annualAmount: string;
}): string[] {
  return [
    values.name.trim() ? null : "name",
    values.fiscalYearId ? null : "fiscalYearId",
    values.accountId ? null : "accountId",
    values.annualAmount.trim() ? null : "annualAmount",
  ].filter(Boolean) as string[];
}

/** "2 required fields", "1 required field", or undefined when nothing is missing. */
export function requiredFieldsReason(missingCount: number): string | undefined {
  if (missingCount <= 0) return undefined;
  return `${missingCount} required field${missingCount === 1 ? "" : "s"}`;
}

/**
 * "150,000.00" and "150000" both mean 150000. Returns null when the text is not
 * a number at all, which is a different answer from 0.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
