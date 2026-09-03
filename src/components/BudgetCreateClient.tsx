"use client";

// Real-screen conversion (2026-08-30) -- replaced BudgetsClient.tsx's old
// "New Budget" Dialog popup with a real create screen, same fields, same live
// VERIDIAN lookups, same blocked-reason honesty when fiscal years / chart of
// accounts aren't provisioned.
//
// â”€â”€â”€ R67 D-67 + correction C-15 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson } from "@/lib/fetch-json";
import { useOrgMoney } from "@/lib/use-org-money";
import { useSubmit } from "@/lib/use-submit";
import { isAbortError } from "@/lib/module-list-state";
import { type Company } from "@/components/company-scope";
import type { CreateField } from "@/lib/create-screen";
import { ROLE_GROUPS } from "@/lib/authz/roles";

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

// ─── R67 D-42 merge: WHO can act on the block ────────────────────────────
//
// C-15's "Set up in VERIDIAN" is the right destination, and it is kept -- it
// goes to the real ERP provisioning screen, which is better than the guess
// this lane originally shipped (/accounting, PROJEXA's read-only surface onto
// it). What it does not answer is D-42's other half: only an org admin can
// provision a fiscal year, so for everyone else that link opens a screen they
// cannot use. A site engineer gets a way to ASK instead, and the asking files
// a real task rather than telling them to go and do something their role
// forbids.
//
// The group is ROLE_GROUPS.ORG_ADMIN (owner | admin) -- the real group in
// src/lib/authz/roles.ts. D-42's own wording says "ROLE_GROUPS.ADMIN", which
// does not exist in this repo.
export const NON_ADMIN_ACTION_LABEL = "Ask your administrator";

// The task filed on a non-admin's behalf. Deliberately the sentence a person
// would write, because it is read by a person in the left pane.
export const ADMIN_TASK_TEXT = "Set up fiscal year — needs admin";

/** Only the org's own admins can provision an ERP fiscal year. */
function canSetUpAccounting(role: string | null | undefined): boolean {
  return !!role && (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(role);
}

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
  // R67 D-42: the viewer's own role, for the branch below. A failed or missing
  // role read leaves `role` null, which is treated as NOT an admin -- the
  // "ask" path is safe to offer to an admin, whereas sending someone who
  // cannot act to a provisioning screen is not.
  const [role, setRole] = useState<string | null>(null);
  const [askState, setAskState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchJson<{ role?: string | null }>("/api/organization")
      .then((d) => {
        if (live) setRole(d.role ?? null);
      })
      .catch(() => {
        if (live) setRole(null);
      });
    return () => {
      live = false;
    };
  }, []);

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
      setAskError(err instanceof Error && err.message ? err.message : "Could not send that request");
    }
  }, []);

  // R67 MERGE (lane F2's F-19, audit R-245). THIS WAS Promise.all, AND THAT
  // WAS THE BUG: one failed lookup rejected the whole batch, so a 500 on
  // /api/companies -- a field that is OPTIONAL on this form -- blanked the
  // fiscal years and the chart of accounts too, and the screen then told the
  // user this organisation HAS no fiscal years. That is a failed read reported
  // as a fact about their data, which is exactly what src/lib/read-outcome.ts
  // exists to prevent, and what lane D0's own `lookupError` branch below is
  // written to avoid -- it just could not see which lookup failed.
  //
  // allSettled keeps each outcome separate: a lookup that answered fills its
  // field, and only the ones that did not answer are named in the banner. The
  // AbortController stops a form the user has already left from setting state.
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

      const failed: string[] = [];
      if (fyR.status === "fulfilled") setFiscalYears(fyR.value.fiscalYears ?? []);
      else if (!isAbortError(fyR.reason, controller.signal)) failed.push("fiscal years");
      if (ccR.status === "fulfilled") setCostCenters(ccR.value.costCenters ?? []);
      else if (!isAbortError(ccR.reason, controller.signal)) failed.push("cost centres");
      if (acR.status === "fulfilled") setAccounts(acR.value.accounts ?? []);
      else if (!isAbortError(acR.reason, controller.signal)) failed.push("the chart of accounts");
      if (coR.status === "fulfilled") setCompanies(coR.value.companies ?? []);
      else if (!isAbortError(coR.reason, controller.signal)) failed.push("companies");

      // A FAILED lookup is not the same fact as "this org has none", and the
      // banner below must not accuse the org of a setup gap that is really a
      // backend error. Naming WHICH read failed is the part allSettled adds.
      setLookupError(failed.length > 0 ? `${failed.join(", ")} could not be loaded` : null);
      setLookupsLoading(false);
    })();
    return () => controller.abort();
  }, []);

  const missingLookups = [
    fiscalYears.length === 0 ? "fiscal years" : null,
    accounts.length === 0 ? "a chart of accounts" : null,
  ].filter(Boolean) as string[];
  // Only a SUCCESSFUL lookup may claim the org has none -- the same rule
  // src/lib/read-outcome.ts states for every list in this product. With
  // allSettled, `lookupError` is now set only when a read genuinely failed, so
  // a single optional lookup's 500 no longer suppresses this real precondition
  // for the two fields that DID answer.
  const blocked = !lookupsLoading && !lookupError && missingLookups.length > 0;

  // R67 D-42: the two text inputs used to stay LIVE while the form could not be
  // saved, so a user could type a budget name and an amount into a form that was
  // never going to accept them. Every field is disabled while blocked -- and
  // disabled from the FIRST paint, while the lookups are still in flight, so the
  // form only ever RELAXES and never flips from enabled to blocked in front of
  // someone mid-keystroke.
  const fieldsDisabled = lookupsLoading || blocked;
  const fieldsDisabledReason = lookupsLoading ? "Loading…" : blocked ? BUDGET_PRECONDITION_LABEL : undefined;

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

  for (const field of fields) {
    field.disabled = field.disabled || fieldsDisabled;
    field.disabledReason = field.disabledReason ?? fieldsDisabledReason;
  }

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
        // R67 D-42: an admin is sent to the screen that fixes this. Everyone
        // else is given a way to ASK, because the fix is not theirs to make.
        blocked ? (
          canSetUpAccounting(role) ? (
            <a
              href={FISCAL_SETUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-ct-navy underline"
            >
              Set up in VERIDIAN
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : askState === "sent" ? (
            <span role="status" className="text-sm text-px-muted">
              Sent — your administrator has been asked to set this up.
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void askAdministrator()}
                disabled={askState === "sending"}
                className="text-sm font-medium text-ct-navy underline disabled:opacity-60"
              >
                {askState === "sending" ? "Sending…" : NON_ADMIN_ACTION_LABEL}
              </button>
              {askState === "failed" && askError && (
                <span role="alert" className="text-sm text-px-error">
                  {askError}
                </span>
              )}
            </span>
          )
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
