"use client";

// LOCAL-FIRST shell, Line budgets (/scope/:id/budget, Sumeet R-C09): each line's budget % (25 unless set), vendor and vendor amount, edited with no
// network. A save is ONE update_line_item_budget op for that line (scope-writes.ts setLineBudgetOffline); the line keeps what the server last said and
// is marked "Waiting to sync" until the server answers. Manager rank only (the registry's min_role_rank 3, decided again by the server). The budget
// is amount x % / 100, shown from the laptop's copy; the server computes its own.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// GUIDED ERRORS (G1): a wrong budget value is named beside its box AND told in the guided panel (what happened, why, what to do, the box outlined);
// what was typed is kept in a draft. See src/lib/error-guide/g1-faults.ts.
import { ActionFailurePanel, type ActionFailureState } from "@/components/ActionFailure";
import { FaultPanel } from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { budgetPercentFault, moneyAmountFault, type Fault } from "@/lib/error-guide/g1-faults";
import { ScopeState, scopeWriteFailure } from "./ScopeGuided";
import { formatAmount } from "@/lib/boq-helpers";
import type { ShellScreenProps } from "../types";
import type { BudgetLine, ScopeBudgetData } from "./scope-adapter";
import { computedBudget, scopeNotQueuedMessage, setLineBudgetOffline, validateBudgetEdit, type BudgetErrors } from "./scope-writes";
import { NOT_SYNCED, NO_PROJECT, Note, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

type Draft = { budgetPercentage: string; vendorId: string; vendorAmount: string };

export default function ScopeBudgetScreen({ shell, data }: ShellScreenProps<ScopeBudgetData>) {
  const draftKey = `boq-budget:${data.state === "ready" ? data.boq.id : "none"}`;
  const kept = useDraft<{ drafts: Record<string, Draft> }>(draftKey, { drafts: {} });
  const drafts = kept.value.drafts;
  const setDrafts = (next: Record<string, Draft> | ((cur: Record<string, Draft>) => Record<string, Draft>)) => kept.set({ drafts: typeof next === "function" ? next(drafts) : next });
  const [errors, setErrors] = useState<Record<string, BudgetErrors>>({});
  const [faults, setFaults] = useState<Fault[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<ActionFailureState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <ScopeState testId="scope-budget-screen" state="no_project" title="Line budgets" back={BACK} sentence={NO_PROJECT} />;
  if (data.state === "not_synced") return <ScopeState testId="scope-budget-screen" state="not_synced" title="Line budgets" back={BACK} sentence={NOT_SYNCED} projectId={data.projectId ?? undefined} />;
  if (data.state === "not_found") return <ScopeState testId="scope-budget-screen" state="not_found" title="Line budgets" back={BACK} sentence="This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet." projectId={data.projectId ?? undefined} />;
  if (data.state === "parent_waiting") return <ScopeState testId="scope-budget-screen" state="parent_waiting" title="Line budgets" back={BACK} sentence="This BOQ is still waiting to be sent. Its line budgets can be set once the server has accepted it." projectId={data.projectId} />;
  if (data.state === "money_hidden") return <ScopeState testId="scope-budget-screen" state="money_hidden" title="Line budgets" back={BACK} sentence="Budgets are hidden for your role." projectId={data.projectId} />;
  const { projectId, boq, lines, vendors } = data;
  const back = { href: `/scope/${encodeURIComponent(boq.id)}${projectQuery(projectId)}`, label: "Back to this BOQ" };
  if (!mayOffer(shell.data.role, "update_line_item_budget")) {
    return <ScopeState testId="scope-budget-screen" state="role" title="Line budgets" back={back} sentence="Setting a line budget needs the manager role." projectId={projectId} entityId={boq.id} />;
  }

  const draftOf = (l: BudgetLine): Draft => drafts[l.id] ?? { budgetPercentage: l.budgetPercentage, vendorId: l.vendorId ?? "", vendorAmount: l.vendorAmount ?? "" };
  const setDraft = (l: BudgetLine, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [l.id]: { ...draftOf(l), ...patch } }));

  async function save(l: BudgetLine) {
    const d = draftOf(l);
    const edit = { projectId, lineId: l.id, current: { budgetPercentage: l.budgetPercentage, vendorId: l.vendorId, vendorAmount: l.vendorAmount }, ...d };
    const errs = validateBudgetEdit(edit);
    setErrors((e) => ({ ...e, [l.id]: errs }));
    setFailure(null);
    if (Object.keys(errs).length > 0) {
      // the same faults in the guided panel: which line, which box, what to type
      const found: Fault[] = [];
      const label = l.itemCode ? `${l.itemCode} ${l.description}` : l.description;
      if (errs.budgetPercentage) found.push(budgetPercentFault(d.budgetPercentage, `scope-budget-${l.id}-pct`) ?? { code: "BUDGET_PERCENT_RANGE", field: `scope-budget-${l.id}-pct`, message: `${errs.budgetPercentage} Nothing was saved.` });
      if (errs.vendorAmount) found.push(moneyAmountFault("Vendor amount", d.vendorAmount, `scope-budget-${l.id}-vamount`) ?? { code: "BUDGET_AMOUNT_INVALID", field: `scope-budget-${l.id}-vamount`, message: `${errs.vendorAmount} Nothing was saved.` });
      if (errs.nothing) found.push({ code: "BUDGET_NOTHING_CHANGED", field: `scope-budget-${l.id}-pct`, message: `Nothing was changed on "${label}". Change the Budget %, the vendor or the vendor amount, then press Save.` });
      setFaults(found.map((f) => ({ ...f, message: f.message.replace(/^(Budget %|Vendor amount)/, `On "${label}": $1`) })));
      setAttempt((n) => n + 1);
      return;
    }
    setFaults([]);
    setBusy(l.id);
    const result = await setLineBudgetOffline(edit, writeAccess(shell));
    setBusy(null);
    if (!result.queued) {
      setFailure(scopeWriteFailure(result.reason, result.reason === "invalid" ? "Please check the highlighted fields." : scopeNotQueuedMessage(result.reason)));
      return;
    }
    setDrafts((cur) => {
      const next = { ...cur };
      delete next[l.id];
      return next;
    });
    if (Object.keys(drafts).filter((k) => k !== l.id).length === 0) kept.clear();
    setNote(keptNote(shell));
    shell.refresh();
  }

  return (
    <section data-testid="scope-budget-screen" data-state="ready" data-boq-id={boq.id}>
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>{boq.title}</a></p>
      <h1 className="font-heading text-2xl text-px-ink">Line budgets</h1>
      <p className="mt-1 text-xs text-px-muted">Budget % is 25 until you set it. The line&apos;s budget is its amount x Budget % / 100.</p>
      {kept.restored ? (
        <p className="mt-2 text-[12.5px] text-px-muted" data-testid="draft-restored">
          We kept the budget values you typed earlier.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => { kept.startFresh(); setFaults([]); setErrors({}); setFailure(null); }}>Start fresh</button>
        </p>
      ) : null}
      <div className="mt-2 max-w-3xl space-y-2">
        <FaultPanel faults={faults} attempt={attempt} entityType="boq" entityId={boq.id} projectId={projectId} draftKey={draftKey} />
        {faults.length === 0 ? <ActionFailurePanel failure={failure} entityType="boq" entityId={boq.id} projectId={projectId} draftKey={draftKey} sentence={failure?.message} /> : null}
      </div>
      {vendors.state !== "local" ? (
        <p className="mt-1 text-xs text-px-muted" data-testid="scope-budget-no-vendors">The vendor list is not on this laptop yet, so a vendor cannot be chosen here.</p>
      ) : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-[12px] text-px-muted">
              <th className="px-1 pb-1 font-medium">Item</th><th className="px-1 pb-1 font-medium">Description</th>
              <th className="px-1 pb-1 text-right font-medium">Amount</th><th className="px-1 pb-1 text-right font-medium">Budget %</th>
              <th className="px-1 pb-1 text-right font-medium">Budget</th><th className="px-1 pb-1 font-medium">Vendor</th>
              <th className="px-1 pb-1 text-right font-medium">Vendor amount</th><th className="px-1 pb-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const d = draftOf(l);
              const e = errors[l.id] ?? {};
              const pct = Number(d.budgetPercentage);
              const shownBudget = d.budgetPercentage.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? computedBudget(l.amount, pct) : null;
              return (
                <tr key={l.id} className="align-top" data-testid="scope-budget-row" data-line-id={l.id}>
                  <td className="px-1 py-1">{l.itemCode ?? ""}</td>
                  <td className={`px-1 py-1 ${l.isSub ? "pl-5" : ""}`}>{l.description}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{formatAmount(l.amount)}</td>
                  <td className="px-1 py-1">
                    <Input className="w-[80px] text-right tabular-nums" aria-label={`Budget %, ${l.description}`} id={`scope-budget-${l.id}-pct`} aria-invalid={e.budgetPercentage ? true : undefined} data-testid={`scope-budget-${l.id}-pct`} inputMode="decimal" value={d.budgetPercentage} {...textInput((v) => setDraft(l, { budgetPercentage: v }))} />
                    {e.budgetPercentage ? <p className="text-[11px] text-px-error" data-testid={`scope-budget-${l.id}-pct-error`}>{e.budgetPercentage}</p> : null}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums" data-testid={`scope-budget-${l.id}-budget`}>{shownBudget === null ? "-" : formatAmount(shownBudget)}</td>
                  <td className="px-1 py-1">
                    <select className="rounded border border-black/20 p-1.5 text-sm" aria-label={`Vendor, ${l.description}`} data-testid={`scope-budget-${l.id}-vendor`} disabled={vendors.state !== "local"} value={d.vendorId} onChange={(ev) => setDraft(l, { vendorId: ev.currentTarget.value })}>
                      <option value="">{l.vendorId && vendors.state === "local" && !vendors.options.some((o) => o.id === l.vendorId) ? "(a vendor not on this laptop)" : "No vendor"}</option>
                      {vendors.state === "local" ? vendors.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>) : null}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <Input className="w-[110px] text-right tabular-nums" aria-label={`Vendor amount, ${l.description}`} id={`scope-budget-${l.id}-vamount`} aria-invalid={e.vendorAmount ? true : undefined} data-testid={`scope-budget-${l.id}-vamount`} inputMode="decimal" value={d.vendorAmount} {...textInput((v) => setDraft(l, { vendorAmount: v }))} />
                    {e.vendorAmount ? <p className="text-[11px] text-px-error" data-testid={`scope-budget-${l.id}-vamount-error`}>{e.vendorAmount}</p> : null}
                  </td>
                  <td className="px-1 py-1">
                    <Button type="button" size="sm" data-testid={`scope-budget-${l.id}-save`} disabled={busy === l.id} onClick={() => void save(l)}>Save</Button>
                    {l.waiting ? <span className="ml-2 text-xs text-px-muted" data-testid={`scope-budget-${l.id}-waiting`}>Waiting to sync</span> : null}
                    {l.trouble ? <span className="ml-2 text-xs text-px-error" data-testid={`scope-budget-${l.id}-trouble`}>{l.trouble === "blocked" ? "Not accepted by the server" : "Changed on the server too"}</span> : null}
                    {e.nothing ? <p className="text-[11px] text-px-muted" data-testid={`scope-budget-${l.id}-nothing`}>{e.nothing}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note text={note} />
    </section>
  );
}
