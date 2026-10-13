"use client";

// LOCAL-FIRST shell, New BOQ (/scope/new): the online create screen's title and line grid with its own checks and words, kept on the
// laptop at once as create_boq in the outbox (scope-writes.ts). The new BOQ appears in the Scope list straight away, marked "Waiting to
// sync"; the server decides again when it is sent, and a refusal comes back as a card with nothing stored. Excel import stays online.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyLine, type LineItemDraft } from "@/lib/boq-helpers";
import type { ShellScreenProps } from "../types";
import type { ScopeNewData } from "./scope-adapter";
import { createBoqOffline, scopeNotQueuedMessage, validateBoqDraft, type BoqDraftErrors } from "./scope-writes";
import { ScopeLinesEditor } from "./ScopeEditorParts";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

export default function ScopeNewScreen({ shell, data }: ShellScreenProps<ScopeNewData>) {
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [errors, setErrors] = useState<BoqDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="scope-new-screen" state="no_project" title="New BOQ" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="scope-new-screen" state="not_synced" title="New BOQ" back={BACK}>{NOT_SYNCED}</StateMessage>;
  const { projectId } = data;
  const back = { href: `/scope${projectQuery(projectId)}`, label: BACK.label };
  if (!mayOffer(shell.data.role, "create_boq")) {
    return <StateMessage testId="scope-new-screen" state="role" title="New BOQ" back={back}>Your role can read BOQs but not create them.</StateMessage>;
  }

  async function save() {
    const errs = validateBoqDraft(title, lines);
    setErrors(errs);
    if (errs.title || errs.lines) return;
    setBusy(true);
    const result = await createBoqOffline({ projectId, title, lines }, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(scopeNotQueuedMessage(result.reason));
    setNote(keptNote(shell));
    shell.navigate(`/scope/${encodeURIComponent(result.tempId)}${projectQuery(projectId)}`);
  }

  return (
    <section data-testid="scope-new-screen" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>Scope of Work</a></p>
      <h1 className="font-heading text-2xl text-px-ink">New Bill of Quantities</h1>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block max-w-xl text-sm">Title *
          <Input className="mt-1" data-testid="scope-new-title" placeholder="e.g. Civil Works - Phase 1" value={title} {...textInput(setTitle)} />
        </label>
        {errors.title ? <p className="text-xs text-px-error" data-testid="scope-error-title">{errors.title}</p> : null}
        <p className="text-xs text-px-muted">
          Item Code identifies the line in reports. Parent Item Code links a sub-task to its root line; Breakdown % is its share of the root line&apos;s amount.
          The shares are not forced to add up to 100.
        </p>
        <ScopeLinesEditor lines={lines} onChange={setLines} testIdPrefix="scope-new" />
        <Button type="button" variant="outline" size="sm" data-testid="scope-new-add" onClick={() => setLines((prev) => [...prev, emptyLine()])}>+ Add Line</Button>
        {errors.lines ? <p role="alert" className="text-xs text-px-error" data-testid="scope-error-lines">{errors.lines}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="scope-new-save" disabled={busy || !title.trim()} title={!title.trim() ? "Title is required" : undefined}>Save BOQ</Button>
          <a className="px-2 py-1.5 text-sm underline underline-offset-2" href={back.href}>Cancel</a>
        </div>
      </form>
      <Note text={note} />
    </section>
  );
}
