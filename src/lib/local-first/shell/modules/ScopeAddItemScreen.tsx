"use client";

// LOCAL-FIRST shell, Add a scope item (/scope/:id/add-item, Sumeet R-96; with a change order, R-98). Works with no network. A scope item is a new
// BOQ line; online it is added by a new revision that keeps every line and adds the new ones, so that is what is kept here: ONE
// create_boq_revision (scope-writes.ts addScopeItemsOffline). Nothing existing is changed or removed by this screen, so work already recorded on
// site is never reduced by it. The optional change order is the approved one this scope comes from (CHANGE OF SCOPE): the server links the two when
// it accepts the revision. A BOQ can be revised only once, so while a revision of it is waiting to be sent this screen says so instead of saving.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
// GUIDED ERRORS (G1): faults on the new rows are named on their input AND told in the guided panel; the new rows are kept in a draft.
import { ActionFailurePanel, codedFailure, type ActionFailureState } from "@/components/ActionFailure";
import { FaultPanel } from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { boqDraftFaults, faultsByField, newLineFaults, stillTrue, type Fault } from "@/lib/error-guide/g1-faults";
import { ScopeState, scopeWriteFailure } from "./ScopeGuided";
import { emptyLine, toDrafts, type LineItemDraft } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import type { ShellScreenProps } from "../types";
import type { ScopeReviseData } from "./scope-adapter";
import { addScopeItemsOffline, scopeNotQueuedMessage, validateBoqDraft } from "./scope-writes";
import { ScopeLinesEditor, money } from "./ScopeEditorParts";
import { NOT_SYNCED, NO_PROJECT, Note, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

export default function ScopeAddItemScreen({ shell, data }: ShellScreenProps<ScopeReviseData>) {
  const draftKey = `boq-add-item:${data.state === "ready" ? data.boq.id : "none"}`;
  const draft = useDraft<{ items: LineItemDraft[] }>(draftKey, { items: [emptyLine()] });
  const items = draft.value.items;
  const setItems = (next: LineItemDraft[] | ((prev: LineItemDraft[]) => LineItemDraft[])) => draft.set({ items: typeof next === "function" ? next(items) : next });
  const [changeOrderId, setChangeOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<ActionFailureState | null>(null);
  const readyData = data.state === "ready" ? data : null;
  const parentDrafts = readyData ? toDrafts([...readyData.parent]) : [];

  // a fixed fault leaves the panel as soon as it is fixed
  useEffect(() => {
    if (faults.length === 0 || !readyData) return;
    setFaults((prev) => stillTrue(prev, newLineFaults(boqDraftFaults(readyData.boq.title, [...parentDrafts, ...items]), parentDrafts.length)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.value.items]);

  if (data.state === "no_project") return <ScopeState testId="scope-additem-screen" state="no_project" title="Add a scope item" back={BACK} sentence={NO_PROJECT} />;
  if (data.state === "not_synced") return <ScopeState testId="scope-additem-screen" state="not_synced" title="Add a scope item" back={BACK} sentence={NOT_SYNCED} projectId={data.projectId ?? undefined} />;
  if (data.state === "not_found") return <ScopeState testId="scope-additem-screen" state="not_found" title="Add a scope item" back={BACK} sentence="This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet." projectId={data.projectId ?? undefined} />;
  if (data.state === "parent_waiting") return <ScopeState testId="scope-additem-screen" state="parent_waiting" title="Add a scope item" back={BACK} sentence="This BOQ is still waiting to be sent. A scope item can be added once the server has accepted it." projectId={data.projectId} />;
  if (data.state === "money_hidden") return <ScopeState testId="scope-additem-screen" state="money_hidden" title="Add a scope item" back={BACK} sentence="Quantities and rates are hidden for your role, so a scope item cannot be added from the laptop." projectId={data.projectId} />;
  const { projectId, boq, parent, progress, changeOrders, revisionWaiting } = data;
  const back = { href: `/scope/${encodeURIComponent(boq.id)}${projectQuery(projectId)}`, label: "Back to this BOQ" };
  if (!mayOffer(shell.data.role, "create_boq_revision")) {
    return <ScopeState testId="scope-additem-screen" state="role" title="Add a scope item" back={back} sentence="Your role can read BOQs but not change them." projectId={projectId} entityId={boq.id} />;
  }

  async function save() {
    // the whole set is checked as the server will see it: a repeated item code or a parent code that matches nothing is told in words now
    const filled = items.filter((l) => l.description.trim() || (l.itemCode ?? "").trim() || l.quantity.trim() || l.rate.trim());
    if (filled.length === 0) {
      const message = "Write the new scope item first: what it is, its unit, quantity and rate.";
      setError(message);
      setFaults([{ code: "BOQ_LINE_DESCRIPTION_REQUIRED", line: 1, field: "boq-line-0-description", message: `${message} Nothing was saved.` }]);
      setAttempt((n) => n + 1);
      return;
    }
    const errs = validateBoqDraft(boq.title, [...toDrafts([...parent]), ...filled]);
    const found = newLineFaults(boqDraftFaults(boq.title, [...toDrafts([...parent]), ...items]), parent.length);
    setFailure(null);
    if (errs.lines || found.length > 0) {
      setError(errs.lines ?? null);
      setFaults(found);
      setAttempt((n) => n + 1);
      return;
    }
    setError(null);
    setFaults([]);
    setBusy(true);
    const result = await addScopeItemsOffline(
      {
        projectId, parentBoqId: boq.id, parent, parentVersion: boq.version, boqTitle: boq.title, items, progress: new Map(Object.entries(progress ?? {})),
        ...(changeOrderId ? { sourceChangeOrderId: changeOrderId, linkable: changeOrders } : {}),
      },
      writeAccess(shell)
    );
    setBusy(false);
    if (!result.queued) {
      setFailure(scopeWriteFailure(result.reason, scopeNotQueuedMessage(result.reason), result.reason === "change_order" ? "scope-additem-change-order" : undefined));
      return;
    }
    draft.clear();
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
        {draft.restored ? (
          <p className="text-[12.5px] text-px-muted" data-testid="draft-restored">
            We kept the item(s) you typed earlier.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => { draft.startFresh(); setFaults([]); setError(null); setFailure(null); }}>Start fresh</button>
          </p>
        ) : null}
        <FaultPanel faults={faults} attempt={attempt} entityType="boq" entityId={boq.id} projectId={projectId} draftKey={draftKey} />
        {faults.length === 0 ? <ActionFailurePanel failure={failure} entityType="boq" entityId={boq.id} projectId={projectId} draftKey={draftKey} sentence={failure?.message} /> : null}
        <ScopeLinesEditor lines={items} onChange={setItems} testIdPrefix="scope-additem" faultMessages={faultsByField(faults)} />
        <Button type="button" variant="outline" size="sm" data-testid="scope-additem-more" onClick={() => setItems((prev) => [...prev, emptyLine()])}>+ Add another item</Button>
        {revisionWaiting ? (
          <div data-testid="scope-additem-waiting">
            <ActionFailurePanel
              failure={codedFailure("REVISION_WAITING", "A revision of this BOQ is already waiting to be sent, and a BOQ can be revised only once. Wait until it has been sent, then add the item to the new revision.")}
              sentence="A revision of this BOQ is already waiting to be sent, and a BOQ can be revised only once. Wait until it has been sent, then add the item to the new revision."
              entityType="boq"
              entityId={boq.id}
              projectId={projectId}
            />
          </div>
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
