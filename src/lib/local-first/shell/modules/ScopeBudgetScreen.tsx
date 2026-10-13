"use client";

// LOCAL-FIRST shell, Line budgets (/scope/:id/budget, Sumeet R-C09): each line's budget % (25 unless set), vendor and vendor amount, edited with no
// network. A save is ONE update_line_item_budget op for that line (scope-writes.ts setLineBudgetOffline); the line keeps what the server last said and
// is marked "Waiting to sync" until the server answers. Manager rank only (the registry's min_role_rank 3, decided again by the server). The budget
// is amount x % / 100, shown from the laptop's copy; the server computes its own.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/lib/boq-helpers";
import type { ShellScreenProps } from "../types";
import type { BudgetLine, ScopeBudgetData } from "./scope-adapter";
import { computedBudget, scopeNotQueuedMessage, setLineBudgetOffline, validateBudgetEdit, type BudgetErrors } from "./scope-writes";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

type Draft = { budgetPercentage: string; vendorId: string; vendorAmount: string };

export default function ScopeBudgetScreen({ shell, data }: ShellScreenProps<ScopeBudgetData>) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, BudgetErrors>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="scope-budget-screen" state="no_project" title="Line budgets" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="scope-budget-screen" state="not_synced" title="Line budgets" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="scope-budget-screen" state="not_found" title="Line budgets" back={BACK}>This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;
  if (data.state === "parent_waiting") return <StateMessage testId="scope-budget-screen" state="parent_waiting" title="Line budgets" back={BACK}>This BOQ is still waiting to be sent. Its line budgets can be set once the server has accepted it.</StateMessage>;
  if (data.state === "money_hidden") return <StateMessage testId="scope-budget-screen" state="money_hidden" title="Line budgets" back={BACK}>Budgets are hidden for your role.</StateMessage>;
  const { projectId, boq, lines, vendors } = data;
  const back = { href: `/scope/${encodeURIComponent(boq.id)}${projectQuery(projectId)}`, label: "Back to this BOQ" };
  if (!mayOffer(shell.data.role, "update_line_item_budget")) {
    return <StateMessage testId="scope-budget-screen" state="role" title="Line budgets" back={back}>Setting a line budget needs the manager role.</StateMessage>;
  }

  const draftOf = (l: BudgetLine): Draft => drafts[l.id] ?? { budgetPercentage: l.budgetPercentage, vendorId: l.vendorId ?? "", vendorAmount: l.vendorAmount ?? "" };
  const setDraft = (l: BudgetLine, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [l.id]: { ...draftOf(l), ...patch } }));

  async function save(l: BudgetLine) {
    const d = draftOf(l);
    const edit = { projectId, lineId: l.id, current: { budgetPercentage: l.budgetPercentage, vendorId: l.vendorId, vendorAmount: l.vendorAmount }, ...d };
    const errs = validateBudgetEdit(edit);
    setErrors((e) => ({ ...e, [l.id]: errs }));
    if (Object.keys(errs).length > 0) return;
    setBusy(l.id);
    const result = await setLineBudgetOffline(edit, writeAccess(shell));
    setBusy(null);
    if (!result.queued) return setNote(result.reason === "invalid" ? "Please check the highlighted fields." : scopeNotQueuedMessage(result.reason));
    setDrafts((cur) => {
      const next = { ...cur };
      delete next[l.id];
      return next;
    });
    setNote(keptNote(shell));
    shell.refresh();
  }

  return (
    <section data-testid="scope-budget-screen" data-state="ready" data-boq-id={boq.id}>
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>{boq.title}</a></p>
      <h1 className="font-heading text-2xl text-px-ink">Line budgets</h1>
      <p className="mt-1 text-xs text-px-muted">Budget % is 25 until you set it. The line&apos;s budget is its amount x Budget % / 100.</p>
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
                    <Input className="w-[80px] text-right tabular-nums" aria-label={`Budget %, ${l.description}`} data-testid={`scope-budget-${l.id}-pct`} inputMode="decimal" value={d.budgetPercentage} {...textInput((v) => setDraft(l, { budgetPercentage: v }))} />
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
                    <Input className="w-[110px] text-right tabular-nums" aria-label={`Vendor amount, ${l.description}`} data-testid={`scope-budget-${l.id}-vamount`} inputMode="decimal" value={d.vendorAmount} {...textInput((v) => setDraft(l, { vendorAmount: v }))} />
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
