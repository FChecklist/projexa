"use client";

// LOCAL-FIRST shell, Add a scope item (/scope/:id/add-item, Sumeet R-96; with a change order, R-98). Works with no network. A scope item is a new
// BOQ line; online it is added by a new revision that keeps every line and adds the new ones, so that is what is kept here: ONE
// create_boq_revision (scope-writes.ts addScopeItemsOffline). Nothing existing is changed or removed by this screen, so work already recorded on
// site is never reduced by it. The optional change order is the approved one this scope comes from (CHANGE OF SCOPE): the server links the two when
// it accepts the revision. A BOQ can be revised only once, so while a revision of it is waiting to be sent this screen says so instead of saving.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { emptyLine, toDrafts, type LineItemDraft } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import type { ShellScreenProps } from "../types";
import type { ScopeReviseData } from "./scope-adapter";
import { addScopeItemsOffline, scopeNotQueuedMessage, validateBoqDraft } from "./scope-writes";
import { ScopeLinesEditor, money } from "./ScopeEditorParts";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

export default function ScopeAddItemScreen({ shell, data }: ShellScreenProps<ScopeReviseData>) {
  const [items, setItems] = useState<LineItemDraft[]>([emptyLine()]);
  const [changeOrderId, setChangeOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="scope-additem-screen" state="no_project" title="Add a scope item" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="scope-additem-screen" state="not_synced" title="Add a scope item" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="scope-additem-screen" state="not_found" title="Add a scope item" back={BACK}>This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;
  if (data.state === "parent_waiting") return <StateMessage testId="scope-additem-screen" state="parent_waiting" title="Add a scope item" back={BACK}>This BOQ is still waiting to be sent. A scope item can be added once the server has accepted it.</StateMessage>;
  if (data.state === "money_hidden") return <StateMessage testId="scope-additem-screen" state="money_hidden" title="Add a scope item" back={BACK}>Quantities and rates are hidden for your role, so a scope item cannot be added from the laptop.</StateMessage>;
  const { projectId, boq, parent, progress, changeOrders, revisionWaiting } = data;
  const back = { href: `/scope/${encodeURIComponent(boq.id)}${projectQuery(projectId)}`, label: "Back to this BOQ" };
  if (!mayOffer(shell.data.role, "create_boq_revision")) {
    return <StateMessage testId="scope-additem-screen" state="role" title="Add a scope item" back={back}>Your role can read BOQs but not change them.</StateMessage>;
  }

  async function save() {
    // the whole set is checked as the server will see it: a repeated item code or a parent code that matches nothing is told in words now
    const filled = items.filter((l) => l.description.trim() || (l.itemCode ?? "").trim() || l.quantity.trim() || l.rate.trim());
    if (filled.length === 0) return setError("Write the new scope item first: what it is, its unit, quantity and rate.");
    const errs = validateBoqDraft(boq.title, [...toDrafts([...parent]), ...filled]);
    if (errs.lines) return setError(errs.lines);
    setError(null);
    setBusy(true);
    const result = await addScopeItemsOffline(
      {
        projectId, parentBoqId: boq.id, parent, parentVersion: boq.version, boqTitle: boq.title, items, progress: new Map(Object.entries(progress ?? {})),
        ...(changeOrderId ? { sourceChangeOrderId: changeOrderId, linkable: changeOrders } : {}),
      },
      writeAccess(shell)
    );
    setBusy(false);
    if (!result.queued) return setNote(scopeNotQueuedMessage(result.reason));
    setNote(keptNote(shell));
    shell.navigate(`/scope/${encodeURIComponent(result.tempId)}${projectQuery(projectId)}`);
  }

  return (
    <section data-testid="scope-additem-screen" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>{boq.title}</a></p>
      <h1 className="font-heading text-2xl text-px-ink">Add a scope item to &quot;{boq.title}&quot; ({revisionLabel(boq.version)})</h1>
      <p className="mt-1 text-xs text-px-muted">
        This keeps every existing line and adds the new one(s) as a new revision ({revisionLabel(boq.version + 1)}). Nothing already in the BOQ is changed or removed.
      </p>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <ScopeLinesEditor lines={items} onChange={setItems} testIdPrefix="scope-additem" />
        <Button type="button" variant="outline" size="sm" data-testid="scope-additem-more" onClick={() => setItems((prev) => [...prev, emptyLine()])}>+ Add another item</Button>
        {revisionWaiting ? (
          <p role="alert" className="rounded border border-px-error-border bg-px-error-light p-3 text-sm text-px-error" data-testid="scope-additem-waiting">
            A revision of this BOQ is already waiting to be sent, and a BOQ can be revised only once. Wait until it has been sent, then add the item to the new revision.
          </p>
        ) : null}
        {changeOrders.length > 0 ? (
          <label className="block max-w-xl text-sm">Because of a change order (optional)
            <select aria-label="Because of a change order" data-testid="scope-additem-change-order" className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm" value={changeOrderId} {...textInput(setChangeOrderId)}>
              <option value="">No change order</option>
              {changeOrders.map((c) => <option key={c.id} value={c.id}>{c.number !== null ? `CO-${c.number} ` : ""}{c.title}</option>)}
            </select>
            <span className="mt-1 block text-xs text-px-muted">Only an approved change order that no revision has been made from yet. The server links the two when it accepts this.</span>
          </label>
        ) : null}
        <p className="text-xs text-px-muted" data-testid="scope-additem-items-total">Quantity x rate of the new item(s): {money(items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0))}</p>
        {error ? <p role="alert" className="text-xs text-px-error" data-testid="scope-additem-error">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="scope-additem-save" disabled={busy || revisionWaiting}>Save scope item</Button>
          <a className="px-2 py-1.5 text-sm underline underline-offset-2" href={back.href}>Cancel</a>
        </div>
      </form>
      <Note text={note} />
    </section>
  );
}
