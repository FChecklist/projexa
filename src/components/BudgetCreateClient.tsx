"use client";

// Real-screen conversion (2026-08-30) -- replaced BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same live
// VERIDIAN lookups, same blocked-reason honesty when fiscal years / chart of
// accounts aren't provisioned.
//
// ─── R67 D-67 + correction C-15 ──────────────────────────────────────────
//
// C-15's finding, in full: "the block is an org-setup precondition surfaced
// correctly (disabled-with-reason), but THE REASON IS A PARAGRAPH INSIDE A
// BUTTON." The Save control's own label carried 200 characters of
// explanation. Its resolution: "keep the banner, shorten the button to 'Save
// (needs a fiscal year and an account)', and add a 'Set up in VERIDIAN' link
// that opens the ERP setup screen."
//
// So: the paragraph stays, once, in the banner where a paragraph belongs; the
// button says the short thing; and the link goes to VERIDIAN's real
// /erp/periods screen -- the page that actually creates fiscal years -- so
// the dead end has an exit. The asterisks are gone with it: D-67's convention
// is that a required field is named in the Save label and nowhere else.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson } from "@/lib/fetch-json";
import { useOrgMoney } from "@/lib/use-org-money";
import { useSubmit } from "@/lib/use-submit";
import { type Company } from "@/components/company-scope";
import type { CreateField } from "@/lib/create-screen";

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };

// The ERP that owns fiscal years and the chart of accounts is a different
// deployment, so its address is configuration. The fallback is the same
// production host veridian-client.ts already defaults its API base to.
const VERIDIAN_APP_URL = (
  process.env.NEXT_PUBLIC_VERIDIAN_APP_URL ?? "https://veridian-compliance-ai.vercel.app"
).replace(/\/+$/, "");
const FISCAL_SETUP_URL = `${VERIDIAN_APP_URL}/erp/periods`;

/** C-15's exact wording for the shortened primary. */
export const BUDGET_PRECONDITION_LABEL = "needs a fiscal year and an account";

export default function BudgetCreateClient() {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});

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
        // A FAILED lookup is not the same fact as "this org has none", and
        // the banner below must not accuse the org of a setup gap that is
        // really a backend error.
        setLookupError(err instanceof Error ? err.message : "the request did not complete");
      } finally {
        setLookupsLoading(false);
      }
    })();
  }, []);

  const missingLookups = [
    fiscalYears.length === 0 ? "fiscal years" : null,
    accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  // Only a SUCCESSFUL lookup may claim the org has none -- the same rule
  // src/lib/read-outcome.ts states for every list in this product.
  const blocked = !lookupsLoading && !lookupError && missingLookups.length > 0;

  const fields: CreateField[] = [
    // While blocked, no field is marked required: the primary must read
    // exactly "Save (needs a fiscal year and an account)" per C-15, not that
    // sentence plus four field names the user cannot fill in anyway.
    { name: "name", label: "Budget Name", kind: "text", required: !blocked, placeholder: "e.g. FY2026 Site Overheads" },
    {
      name: "fiscalYearId",
      label: "Fiscal Year",
      kind: "select",
      required: !blocked,
      placeholder: fiscalYears.length ? "Select a fiscal year" : "No fiscal years found in VERIDIAN",
      options: fiscalYears.map((fy) => ({ value: fy.id, label: `${fy.yearName}${fy.isClosed ? " (closed)" : ""}` })),
    },
    {
      name: "costCenterId",
      label: "Cost Center",
      kind: "select",
      placeholder: costCenters.length ? "Select a cost center" : "No cost centers found in VERIDIAN",
      options: costCenters.map((cc) => ({ value: cc.id, label: cc.name })),
    },
    {
      name: "accountId",
      label: "Account",
      kind: "select",
      required: !blocked,
      placeholder: accounts.length ? "Select an account" : "No chart of accounts found in VERIDIAN",
      options: accounts.map((a) => ({
        value: a.id,
        label: `${a.accountNumber ? `${a.accountNumber} — ` : ""}${a.accountName}`,
      })),
    },
    {
      name: "annualAmount",
      label: "Annual Amount",
      // R67 D-39 / G-05: a money box carries the org's currency CODE inside
      // it, beside the caret, for as long as the number is being typed. This
      // was kind "number", so the amount was entered with nothing on screen
      // saying what unit it was in -- and the cell that reads it back is
      // labelled.
      kind: "money",
      required: !blocked,
      placeholder: "e.g. 250000",
      validate: (value) =>
        value.trim() && Number.isNaN(Number(value)) ? "Annual amount must be a number." : null,
    },
    ...(companies.length > 0
      ? [
          {
            name: "companyId",
            label: "Company / Office",
            kind: "select" as const,
            placeholder: "Org-wide (no specific company)",
            options: companies.map((c) => ({
              value: c.id,
              label: `${c.abbr ? `${c.abbr} — ` : ""}${c.companyName}`,
            })),
          },
        ]
      : []),
  ];

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Budget",
    buildRequest: () => ({
      input: "/api/project-budgets",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (values.name ?? "").trim(),
          fiscalYearId: values.fiscalYearId,
          costCenterId: values.costCenterId || undefined,
          companyId: values.companyId || undefined,
          lineItems: [{ accountId: values.accountId, annualAmount: Number(values.annualAmount) }],
        }),
      },
    }),
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved budget");
      router.replace(createdHref("/budgets", id, (values.name ?? "").trim()));
    },
  });

  return (
    <CreateScreen
      module="Budgets"
      moduleHref="/budgets"
      objectLabel="Budget"
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      money={{ currency: orgMoney.currency, loaded: orgMoney.loaded, currencySet: orgMoney.currencySet }}
      // C-15: the short label. The paragraph lives in the banner.
      extraMissing={blocked ? [BUDGET_PRECONDITION_LABEL] : []}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving || lookupsLoading}
      saved={submit.saved}
      onSubmit={submit.submit}
      onCancel={() => router.push("/budgets")}
      secondaryAction={
        blocked ? (
          <a
            href={FISCAL_SETUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-ct-navy underline"
          >
            Set up in VERIDIAN
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : undefined
      }
      banner={
        <>
          {blocked && (
            <div role="alert" className="max-w-3xl rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm text-px-error">
              This organisation has no {missingLookups.join(" and ")} in VERIDIAN&apos;s ERP module yet, and both are
              required to create a budget. They must be set up in VERIDIAN before a budget can be created here.
            </div>
          )}
          {lookupError && (
            <div role="alert" className="max-w-3xl rounded-lg border border-px-error-border bg-px-error-light p-3 text-sm text-px-error">
              Could not load fiscal years, cost centres or accounts from VERIDIAN: {lookupError}. This screen cannot
              tell whether they exist, so nothing here is a statement about your setup.
            </div>
          )}
        </>
      }
    />
  );
}
