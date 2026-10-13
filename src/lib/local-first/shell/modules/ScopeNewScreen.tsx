"use client";

// LOCAL-FIRST shell, New BOQ (/scope/new): the online create screen's title and line grid with its own checks and words, kept on the
// laptop at once as create_boq in the outbox (scope-writes.ts). The new BOQ appears in the Scope list straight away, marked "Waiting to
// sync"; the server decides again when it is sent, and a refusal comes back as a card with nothing stored. Excel import stays online.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyLine, formatAmount, type LineItemDraft } from "@/lib/boq-helpers";
import { importBoqFromBytes, type BoqExcelImport } from "../../boq-excel/boq-excel-import";
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
  const [excel, setExcel] = useState<BoqExcelImport | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="scope-new-screen" state="no_project" title="New BOQ" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="scope-new-screen" state="not_synced" title="New BOQ" back={BACK}>{NOT_SYNCED}</StateMessage>;
  const { projectId } = data;
  const back = { href: `/scope${projectQuery(projectId)}`, label: BACK.label };
  if (!mayOffer(shell.data.role, "create_boq")) {
    return <StateMessage testId="scope-new-screen" state="role" title="New BOQ" back={back}>Your role can read BOQs but not create them.</StateMessage>;
  }

  async function chooseFile(file: File | undefined) {
    setExcel(null);
    setExcelError(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setExcelError("This file is larger than 10 MB, too large to read on the laptop.");
    const result = await importBoqFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!result.ok) return setExcelError(result.message);
    setExcel(result.value);
  }

  function useExcelLines() {
    if (!excel || excel.blocking.length > 0) return;
    setLines(excel.drafts);
    if (!title.trim()) setTitle(excel.title);
    setErrors({});
    setNote(`${excel.drafts.length} lines from "${excel.fileName}" are in the grid below. Check them, then save the BOQ.`);
    setExcel(null);
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
        <div className="rounded border border-black/10 p-3" data-testid="scope-new-excel">
          <label className="block text-sm">Import from Excel (works without a connection)
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-1 block text-sm" data-testid="scope-new-excel-file" onChange={(e) => void chooseFile(e.currentTarget.files?.[0])} />
          </label>
          <p className="mt-1 text-xs text-px-muted">The file is read on this laptop and is not sent anywhere. Columns are matched by their headings (Sl No, Description, Sub Task, Unit, Qty, Rate, Breakdown %, Category).</p>
          {excelError ? <p role="alert" className="mt-2 text-xs text-px-error" data-testid="scope-new-excel-error">{excelError}</p> : null}
          {excel ? (
            <div className="mt-2 text-sm" data-testid="scope-new-excel-preview">
              <p>{excel.preview.length} lines from sheet &quot;{excel.sheetName}&quot; ({excel.totalRows} rows read){excel.blocking.length > 0 ? `; ${excel.blocking.length} problem${excel.blocking.length === 1 ? "" : "s"} to fix first` : ""}.</p>
              {excel.issues.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs" data-testid="scope-new-excel-issues">
                  {excel.issues.map((i, k) => <li key={k} className={i.blocking ? "text-px-error" : "text-px-muted"} data-blocking={i.blocking ? "1" : "0"}>{i.message}</li>)}
                </ul>
              ) : null}
              <div className="mt-2 max-h-56 overflow-auto">
                <table className="w-full text-xs" data-testid="scope-new-excel-table">
                  <thead><tr className="text-left text-px-muted"><th className="pr-2">Row</th><th className="pr-2">Code</th><th className="pr-2">Description</th><th className="pr-2">Unit</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {excel.preview.map((r) => (
                      <tr key={r.row} data-testid="scope-new-excel-row" data-sub={r.parentItemCode ? "1" : "0"}>
                        <td className="pr-2">{r.row}</td><td className="pr-2">{r.code ?? ""}</td><td className="pr-2">{r.parentItemCode ? "↳ " : ""}{r.description}</td><td className="pr-2">{r.unit}</td>
                        <td className="pr-2 text-right tabular-nums">{r.quantity}</td><td className="pr-2 text-right tabular-nums">{formatAmount(r.rate)}</td><td className="text-right tabular-nums">{formatAmount(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" data-testid="scope-new-excel-use" disabled={excel.blocking.length > 0} title={excel.blocking.length > 0 ? "Fix the problems in the file and choose it again" : undefined} onClick={useExcelLines}>Use these {excel.drafts.length} lines</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setExcel(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </div>
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
