"use client";

// LOCAL-FIRST shell, New Revision (/scope/:id/revise): the BOQ's own lines seed the form (a revision starts from the existing scope), the
// person adds a line or changes a quantity or rate, and sees the VARIATION against the revision it is made from before saving. Kept on the
// laptop as create_boq_revision (scope-writes.ts). A revision that would remove or reduce a line with progress recorded on site is REFUSED here,
// from the progress this laptop holds -- the online screen's block, with the lines named -- and again by the server on arrival if the laptop's
// copy was behind. The explicit "apply anyway" override stays online.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyLine, toDrafts, type LineItemDraft } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import type { ShellScreenProps } from "../types";
import type { ScopeReviseData } from "./scope-adapter";
import { revisionVariation, reviseBoqOffline, scopeNotQueuedMessage, scopeReductions, validateBoqDraft, type BoqDraftErrors } from "./scope-writes";
import { ScopeLinesEditor, money } from "./ScopeEditorParts";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

export default function ScopeReviseScreen({ shell, data }: ShellScreenProps<ScopeReviseData>) {
  const ready = data.state === "ready" ? data : null;
  const [title, setTitle] = useState(ready?.boq.title ?? "");
  const [lines, setLines] = useState<LineItemDraft[]>(() => (ready ? toDrafts(ready.parent) : []));
  const [errors, setErrors] = useState<BoqDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [changeOrderId, setChangeOrderId] = useState("");
  const progress = useMemo(() => new Map(Object.entries(ready?.progress ?? {})), [ready]);

  if (data.state === "no_project") return <StateMessage testId="scope-revise-screen" state="no_project" title="New Revision" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="scope-revise-screen" state="not_synced" title="New Revision" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="scope-revise-screen" state="not_found" title="New Revision" back={BACK}>This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;
  if (data.state === "parent_waiting") return <StateMessage testId="scope-revise-screen" state="parent_waiting" title="New Revision" back={BACK}>This BOQ is still waiting to be sent. It can be revised once the server has accepted it.</StateMessage>;
  if (data.state === "money_hidden") return <StateMessage testId="scope-revise-screen" state="money_hidden" title="New Revision" back={BACK}>Quantities and rates are hidden for your role, so this BOQ cannot be revised from the laptop.</StateMessage>;
  const { projectId, boq, parent, changeOrders, revisionWaiting } = data;
  const back = { href: `/scope/${encodeURIComponent(boq.id)}${projectQuery(projectId)}`, label: "Back to this BOQ" };
  if (!mayOffer(shell.data.role, "create_boq_revision")) {
    return <StateMessage testId="scope-revise-screen" state="role" title="New Revision" back={back}>Your role can read BOQs but not revise them.</StateMessage>;
  }

  const variation = revisionVariation(parent, lines);
  const reductions = scopeReductions(parent, progress, lines);
  const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

  async function save() {
    const errs = validateBoqDraft(title, lines);
    setErrors(errs);
    if (errs.title || errs.lines) return;
    setBusy(true);
    const result = await reviseBoqOffline({ projectId, parentBoqId: boq.id, parent, parentVersion: boq.version, title, lines, progress, ...(changeOrderId ? { sourceChangeOrderId: changeOrderId, linkable: changeOrders } : {}) }, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(scopeNotQueuedMessage(result.reason));
    setNote(keptNote(shell));
    shell.navigate(`/scope/${encodeURIComponent(result.tempId)}${projectQuery(projectId)}`);
  }

  return (
    <section data-testid="scope-revise-screen" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>{boq.title}</a></p>
      <h1 className="font-heading text-2xl text-px-ink">New Revision from &quot;{boq.title}&quot; ({revisionLabel(boq.version)})</h1>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block max-w-xl text-sm">Revision Title *
          <Input className="mt-1" data-testid="scope-revise-title" value={title} {...textInput(setTitle)} />
        </label>
        {errors.title ? <p className="text-xs text-px-error" data-testid="scope-error-title">{errors.title}</p> : null}
        <ScopeLinesEditor lines={lines} onChange={setLines} testIdPrefix="scope-revise" />
        <Button type="button" variant="outline" size="sm" data-testid="scope-revise-add" onClick={() => setLines((prev) => [...prev, emptyLine()])}>+ Add Line</Button>
        <p className="text-xs text-px-muted">Removing a line, or reducing its quantity or rate, is blocked if that item is already recorded as complete on site.</p>
        {revisionWaiting ? (
          <p role="alert" className="rounded border border-px-error-border bg-px-error-light p-3 text-sm text-px-error" data-testid="scope-revise-waiting">
            A revision of this BOQ is already waiting to be sent, and a BOQ can be revised only once. Wait until it has been sent, then make the next change from the new revision.
          </p>
        ) : null}
        {changeOrders.length > 0 ? (
          <label className="block max-w-xl text-sm">Because of a change order (optional)
            <select aria-label="Because of a change order" data-testid="scope-revise-change-order" className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm" value={changeOrderId} {...textInput(setChangeOrderId)}>
              <option value="">No change order</option>
              {changeOrders.map((c) => <option key={c.id} value={c.id}>{c.number !== null ? `CO-${c.number} ` : ""}{c.title}</option>)}
            </select>
            <span className="mt-1 block text-xs text-px-muted">Only an approved change order that no revision has been made from yet. The server links the two when it accepts this revision.</span>
          </label>
        ) : null}
        {ready?.progress === null ? (
          <p className="text-xs text-px-muted" data-testid="scope-revise-progress-unknown">Site progress has not been copied to this laptop yet, so the server checks it when this is sent.</p>
        ) : null}
        <div className="rounded border border-black/10 p-3 text-sm" data-testid="scope-revise-variation">
          {/* F62: the server's variation counts EVERY line (sub-tasks too); the BOQ total counts main lines only. Both are shown, each named, so
              the two changes are never read as one figure. */}
          <p>Variation against {revisionLabel(boq.version)} <span className="text-xs text-px-muted" data-testid="scope-revise-variation-basis">(all line amounts, sub-tasks included)</span>: <strong data-testid="scope-revise-variation-amount">{signed(variation.variation)}</strong></p>
          <p className="text-xs text-px-muted" data-testid="scope-revise-total-note">BOQ total {money(variation.newTotal)} (was {money(variation.previousTotal)}; change {signed(variation.newTotal - variation.previousTotal)} on main lines only, sub-task amounts are inside their main line)</p>
        </div>
        {reductions.length > 0 ? (
          <div role="alert" className="rounded border border-px-error-border bg-px-error-light p-3 text-sm text-px-error" data-testid="scope-revise-blocked">
            <p>This revision would remove or reduce work already completed on site, so it cannot be saved here. To go ahead anyway, make the revision while you are online.</p>
            <ul className="mt-1 list-disc pl-5">{reductions.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : null}
        {errors.lines ? <p role="alert" className="text-xs text-px-error" data-testid="scope-error-lines">{errors.lines}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="scope-revise-save" disabled={busy || !title.trim() || reductions.length > 0 || revisionWaiting} title={reductions.length > 0 ? "A line with work recorded on site would be removed or reduced" : undefined}>Save revision</Button>
          <a className="px-2 py-1.5 text-sm underline underline-offset-2" href={back.href}>Cancel</a>
        </div>
      </form>
      <Note text={note} />
    </section>
  );
}
