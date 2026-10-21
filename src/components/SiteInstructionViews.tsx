"use client";

// R-C14: the list and the single-instruction view for site instructions. Read-only screens over GET /api/site-instructions
// (list, one project) and GET /api/site-instructions/[id]. Creating one is the sibling screen, SiteInstructionCreateClient.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/fetch-json";
// GUIDED ERRORS (G2): a failed read or a refused "Add file" is the guide panel (what happened in full, why, numbered steps, the exact place to fix it,
// the way back), not a single red line.
import { GuidedError } from "@/components/GuidedError";
import { contextFromError, currentScreen } from "@/lib/error-guide/context";
import { siteInstructionFileFault } from "@/lib/error-guide/g2-faults";
import { faultContext } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";
import { takeScreenMessage, type ScreenMessage } from "@/lib/screen-message";
import { SI_DOCUMENT_ENTITY_TYPE, SI_MAX_FILE_MB, siLabel, siteInstructionFileError } from "@/lib/site-instruction-form";

export type SiteInstructionRow = {
  id: string;
  siNumber: number | null;
  issueDate: string | null;
  toContractor: string | null;
  description: string | null;
  drawingRef?: string | null;
  costImpact?: boolean | null;
  timeImpact?: boolean | null;
  boqId?: string | null;
};

const DASH = "–";
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : DASH);

export function SiteInstructionsList({ projectId, projectName }: { projectId: string; projectName?: string | null }) {
  const [rows, setRows] = useState<SiteInstructionRow[] | null>(null);
  const [error, setError] = useState<GuideContext | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchJson<{ siteInstructions?: SiteInstructionRow[] }>(`/api/site-instructions?projectId=${encodeURIComponent(projectId)}`)
      .then((body) => { if (!cancelled) setRows(body.siteInstructions ?? []); })
      .catch((err) => { if (!cancelled) setError(contextFromError(err, { projectId, entityType: "site_instruction" })); });
    return () => { cancelled = true; };
  }, [projectId, attempt]);

  const newHref = `/site-instructions/new?projectId=${encodeURIComponent(projectId)}`;
  return (
    <div className="space-y-4" data-testid="si-list">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ct-navy">Site Instructions</h1>
          {projectName ? <p className="text-sm text-px-muted">{projectName}</p> : null}
        </div>
        <Link href={newHref} className="rounded-md bg-ct-navy px-3 py-2 text-sm text-white">+ New</Link>
      </div>
      {error ? <GuidedError ctx={error} onRetry={() => setAttempt((a) => a + 1)} /> : null}
      {!error && rows === null ? <p className="text-sm text-px-muted">Loading site instructions…</p> : null}
      {rows && rows.length === 0 ? <p className="text-sm text-px-muted">No site instructions in this project yet.</p> : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>To</TableHead><TableHead>Instruction</TableHead><TableHead>Drawing</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((si) => (
                <TableRow key={si.id} data-testid="si-row">
                  <TableCell><Link className="underline" href={`/site-instructions/${si.id}?projectId=${encodeURIComponent(projectId)}`}>{siLabel(si.siNumber)}</Link></TableCell>
                  <TableCell>{day(si.issueDate)}</TableCell>
                  <TableCell>{si.toContractor ?? DASH}</TableCell>
                  <TableCell className="max-w-xs truncate">{si.description ?? DASH}</TableCell>
                  <TableCell>{si.drawingRef || DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Add file" on a site instruction that already exists: the PDF or photo for an instruction written on the laptop-first form (which cannot
 * carry a file). Posts to the existing POST /api/documents, shows the server's own refusal text as it is, and says what was stored.
 */
export function SiteInstructionAddFile({ id }: { id: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [failure, setFailure] = useState<GuideContext | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const fileFault = siteInstructionFileFault(file ? { name: file.name, size: file.size } : null, "si-add-file-input");
  const fileError = fileFault?.message;

  async function add() {
    setFailure(null);
    if (!file || fileFault) {
      // Nothing is sent. The guide panel names the problem and its "Fix it now" outlines the file box.
      const fault = fileFault ?? { code: "SI_FILE_NONE", field: "si-add-file-input", message: "Choose the PDF or photo to add to this instruction." };
      setFailure(faultContext(fault, { entityId: id, entityType: "site_instruction" }));
      const el = findFocusTarget("si-add-file-input");
      if (el) highlightElement(el);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      // The same documents write the create form's file makes (POST /api/site-instructions, multipart): a document linked to this instruction.
      const form = new FormData();
      form.set("file", file);
      form.set("name", file.name);
      form.set("category", "site_instruction");
      form.set("linkedEntityType", SI_DOCUMENT_ENTITY_TYPE);
      form.set("linkedEntityId", id);
      await fetchJson("/api/documents", { method: "POST", body: form });
      setNote({ ok: true, text: `Added ${file.name} to this instruction` });
      setFile(null);
      setInputKey((k) => k + 1);
    } catch (err) {
      setFailure(contextFromError(err, { entityId: id, entityType: "site_instruction" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t border-black/10 pt-3" data-testid="si-add-file">
      <label htmlFor="si-add-file-input" className="text-px-muted">Add file (PDF or photo, up to {SI_MAX_FILE_MB} MB)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={inputKey}
          id="si-add-file-input"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => { setFile(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null); setNote(null); }}
        />
        <button type="button" data-testid="si-add-file-button" disabled={busy} onClick={() => void add()} className="rounded-md bg-ct-navy px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy ? "Adding…" : "Add file"}
        </button>
      </div>
      {fileError ? <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{fileError}</p> : null}
      {failure ? <GuidedError ctx={failure} onRetry={failure.status === 0 && failure.code?.startsWith("SI_FILE") ? undefined : () => void add()} /> : null}
      {note ? <p role={note.ok ? "status" : "alert"} data-testid="si-add-file-note" data-ok={note.ok ? "1" : "0"} className="text-sm">{note.text}</p> : null}
    </div>
  );
}

export function SiteInstructionView({ id, projectId }: { id: string; projectId?: string | null }) {
  const [si, setSi] = useState<SiteInstructionRow | null>(null);
  const [error, setError] = useState<GuideContext | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [handed, setHanded] = useState<ScreenMessage | null>(null);

  useEffect(() => {
    // The receipt the create screen left for this one, shown once.
    setHanded(takeScreenMessage("site-instructions.object"));
    let cancelled = false;
    fetchJson<SiteInstructionRow | { siteInstruction?: SiteInstructionRow }>(`/api/site-instructions/${encodeURIComponent(id)}`)
      .then((body) => {
        if (cancelled) return;
        const row = (body as { siteInstruction?: SiteInstructionRow }).siteInstruction ?? (body as SiteInstructionRow);
        setSi(row);
      })
      .catch((err) => { if (!cancelled) setError(contextFromError(err, { projectId: projectId ?? undefined, entityId: id, entityType: "site_instruction" })); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  const listHref = projectId ? `/site-instructions?projectId=${encodeURIComponent(projectId)}` : "/site-instructions";
  const facts: [string, string][] = si
    ? [
        ["Issue date", day(si.issueDate)],
        ["To contractor", si.toContractor ?? DASH],
        ["Drawing reference", si.drawingRef || DASH],
        ["Changes the cost", si.costImpact ? "Yes" : "No"],
      ]
    : [];
  return (
    <div className="space-y-4" data-testid="si-view">
      <p className="text-sm"><Link className="underline" href={listHref}>Back to Site Instructions</Link></p>
      <h1 className="text-xl font-semibold text-ct-navy">{si ? `Site Instruction ${siLabel(si.siNumber)}` : "Site Instruction"}</h1>
      {handed ? (
        <p role="status" className={`rounded-md border p-3 text-sm ${handed.level === "warning" ? "border-amber-400" : "border-emerald-400"}`}>{handed.text}</p>
      ) : null}
      {error ? <GuidedError ctx={error} onRetry={() => setAttempt((a) => a + 1)} /> : null}
      {!error && !si ? <p className="text-sm text-px-muted">Loading…</p> : null}
      {si ? (
        <div className="max-w-xl space-y-3 rounded-lg border border-black/10 bg-white p-4 text-sm">
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
            {facts.map(([k, v]) => (<><dt key={`${k}-k`} className="text-px-muted">{k}</dt><dd key={`${k}-v`}>{v}</dd></>))}
          </dl>
          <div><p className="text-px-muted">Instruction</p><p className="whitespace-pre-wrap">{si.description ?? DASH}</p></div>
          {si.boqId ? <p><Link className="underline" href={`/scope/${si.boqId}`}>Open the linked BOQ</Link></p> : null}
          <SiteInstructionAddFile id={si.id} />
        </div>
      ) : null}
    </div>
  );
}
