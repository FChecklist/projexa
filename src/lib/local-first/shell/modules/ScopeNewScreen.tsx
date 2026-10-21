"use client";

// LOCAL-FIRST shell, New BOQ (/scope/new): the online create screen's title and line grid with its own checks and words, kept on the
// laptop at once as create_boq in the outbox (scope-writes.ts). The new BOQ appears in the Scope list straight away, marked "Waiting to
// sync"; the server decides again when it is sent, and a refusal comes back as a card with nothing stored. Excel import stays online.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// GUIDED ERRORS (G1): every fault the form can see is named on its input AND told in the guided panel (what happened, why, what to do, the exact
// place); the title and every line are kept in a draft, so a "Fix it now" trip loses nothing. See src/lib/error-guide/g1-faults.ts.
import { ActionFailurePanel, type ActionFailureState } from "@/components/ActionFailure";
import { FaultPanel } from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { BOQ_TITLE_ID, boqDraftFaults, faultsByField, stillTrue, type Fault } from "@/lib/error-guide/g1-faults";
import { ScopeState, scopeWriteFailure } from "./ScopeGuided";
import { emptyLine, formatAmount, type LineItemDraft } from "@/lib/boq-helpers";
import { importBoqFromBytes, type BoqExcelImport } from "../../boq-excel/boq-excel-import";
import type { ShellScreenProps } from "../types";
import type { ScopeNewData } from "./scope-adapter";
import { createBoqOffline, scopeNotQueuedMessage, validateBoqDraft, type BoqDraftErrors } from "./scope-writes";
import { ScopeLinesEditor } from "./ScopeEditorParts";
import { NOT_SYNCED, NO_PROJECT, Note, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/scope", label: "Back to Scope of Work" };

export default function ScopeNewScreen({ shell, data }: ShellScreenProps<ScopeNewData>) {
  // the same draft as the online New BOQ screen (same key and shape): what was typed there is here, and the other way round
  const draftKey = `boq-new:${data.state === "ready" ? data.projectId : "none"}`;
  const draft = useDraft<{ title: string; lines: LineItemDraft[] }>(draftKey, { title: "", lines: [emptyLine()] });
  const title = draft.value.title;
  const lines = draft.value.lines;
  const setTitle = (v: string) => draft.set({ title: v });
  const setLines = (next: LineItemDraft[] | ((prev: LineItemDraft[]) => LineItemDraft[])) => draft.set({ lines: typeof next === "function" ? next(lines) : next });
  const [errors, setErrors] = useState<BoqDraftErrors>({});
  const [faults, setFaults] = useState<Fault[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<ActionFailureState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [excel, setExcel] = useState<BoqExcelImport | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelFaults, setExcelFaults] = useState<Fault[]>([]);

  // a fixed fault leaves the panel as soon as it is fixed (nothing new is shouted while a line is still being typed)
  useEffect(() => {
    if (faults.length === 0) return;
    setFaults((prev) => stillTrue(prev, boqDraftFaults(title, lines)));
  }, [draft.value.title, draft.value.lines]);

  if (data.state === "no_project") return <ScopeState testId="scope-new-screen" state="no_project" title="New BOQ" back={BACK} sentence={NO_PROJECT} />;
  if (data.state === "not_synced") return <ScopeState testId="scope-new-screen" state="not_synced" title="New BOQ" back={BACK} sentence={NOT_SYNCED} projectId={data.projectId ?? undefined} />;
  const { projectId } = data;
  const back = { href: `/scope${projectQuery(projectId)}`, label: BACK.label };
  if (!mayOffer(shell.data.role, "create_boq")) {
    return <ScopeState testId="scope-new-screen" state="role" title="New BOQ" back={back} sentence="Your role can read BOQs but not create them." projectId={projectId} />;
  }

  async function chooseFile(file: File | undefined) {
    setExcel(null);
    setExcelError(null);
    setExcelFaults([]);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      const message = "This file is larger than 10 MB, too large to read on the laptop.";
      setExcelError(message);
      setExcelFaults([{ code: "IMPORT_TOO_BIG", field: "scope-new-excel-file", message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. ${message} Remove pictures and unused sheets, or split it, and choose it again. Nothing was read.` }]);
      return;
    }
    const result = await importBoqFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!result.ok) {
      setExcelError(result.message);
      setExcelFaults([{ code: file.size === 0 ? "IMPORT_EMPTY_FILE" : "IMPORT_FILE_UNREADABLE", field: "scope-new-excel-file", message: `${file.name} could not be read: ${result.message} Save the workbook again from Excel as .xlsx and choose it again. Nothing was read.` }]);
      return;
    }
    setExcel(result.value);
    if (result.value.blocking.length > 0) {
      setExcelFaults([{ code: "IMPORT_ROWS_BLOCKED", field: "scope-new-excel-file", message: `${result.value.blocking.length} problem${result.value.blocking.length === 1 ? "" : "s"} in ${file.name} must be fixed before its lines can be used. The first: ${result.value.blocking[0].message} All of them are listed under the file box. Correct them in the spreadsheet, save it, and choose it again. Nothing was added to the BOQ.` }]);
    }
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
    // the legacy sentences (kept: scope-error-title / scope-error-lines) AND the guided faults (the input, the line, what to do)
    const errs = validateBoqDraft(title, lines);
    const found = boqDraftFaults(title, lines);
    setErrors(errs);
    setFaults(found);
    setFailure(null);
    if (errs.title || errs.lines || found.length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    const result = await createBoqOffline({ projectId, title, lines }, writeAccess(shell));
    setBusy(false);
    if (!result.queued) {
      setFailure(scopeWriteFailure(result.reason, scopeNotQueuedMessage(result.reason)));
      return;
    }
    draft.clear();
    setNote(keptNote(shell));
    shell.navigate(`/scope/${encodeURIComponent(result.tempId)}${projectQuery(projectId)}`);
  }

  const faultMessages = faultsByField(faults);

  return (
    <section data-testid="scope-new-screen" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>Scope of Work</a></p>
      <h1 className="font-heading text-2xl text-px-ink">New Bill of Quantities</h1>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {draft.restored ? (
          <p className="text-[12.5px] text-px-muted" data-testid="draft-restored">
            We kept what you typed earlier: the title and {lines.filter((l) => l.description || l.quantity || l.rate).length || "all"} line(s).{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => { draft.startFresh(); setFaults([]); setErrors({}); setFailure(null); }}>Start fresh</button>
          </p>
        ) : null}
        <FaultPanel faults={faults} attempt={attempt} entityType="boq" projectId={projectId} draftKey={draftKey} />
        {faults.length === 0 ? <ActionFailurePanel failure={failure} entityType="boq" projectId={projectId} draftKey={draftKey} sentence={failure?.message} /> : null}
        <label className="block max-w-xl text-sm">Title *
          <Input className="mt-1" id={BOQ_TITLE_ID} aria-invalid={faultMessages[BOQ_TITLE_ID] ? true : undefined} data-testid="scope-new-title" placeholder="e.g. Civil Works - Phase 1" value={title} {...textInput(setTitle)} />
        </label>
        {errors.title ? <p className="text-xs text-px-error" data-testid="scope-error-title">{errors.title}</p> : null}
        <p className="text-xs text-px-muted">
          Item Code identifies the line in reports. Parent Item Code links a sub-task to its root line; Breakdown % is its share of the root line&apos;s amount.
          The shares are not forced to add up to 100.
        </p>
        <div className="rounded border border-black/10 p-3" data-testid="scope-new-excel">
          <label className="block text-sm">Import from Excel (works without a connection)
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-1 block text-sm" data-testid="scope-new-excel-file" id="scope-new-excel-file" onChange={(e) => void chooseFile(e.currentTarget.files?.[0])} />
          </label>
          <p className="mt-1 text-xs text-px-muted">The file is read on this laptop and is not sent anywhere. Columns are matched by their headings (Sl No, Description, Sub Task, Unit, Qty, Rate, Breakdown %, Category).</p>
          {excelError ? <p role="alert" className="mt-2 text-xs text-px-error" data-testid="scope-new-excel-error">{excelError}</p> : null}
          <FaultPanel faults={excelFaults} attempt={excelFaults.length} entityType="import" projectId={projectId} className="mt-2" />
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
        <ScopeLinesEditor lines={lines} onChange={setLines} testIdPrefix="scope-new" faultMessages={faultMessages} />
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
