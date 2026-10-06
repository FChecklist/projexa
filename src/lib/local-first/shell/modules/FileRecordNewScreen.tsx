"use client";

// LOCAL-FIRST shell: add a PERMIT, a DRAWING or a DOCUMENT with its file (G-15). One form for the three; the file and what was typed are kept on
// this laptop at once, the file goes up when the laptop is connected and only then is the record created (shell/file-queue.ts).
// The record and its fields work with no connection at all; the file's bytes need a connection once.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_CATEGORIES } from "@/lib/document-intake";
import type { FileJobKind } from "../file-queue";
import type { ShellScreenProps } from "../types";
import { CopyNote, ReadOnlyNote, Screen, StateMessage, fieldClass, mayWrite, projectName, textHandlers, withProject } from "./DeliveryParts";
import { FilesWaiting } from "./FilesWaiting";
import { FILE_KIND_WORDS, addFileRecordOffline } from "./file-writes";

type ListData = { state: "no_project" } | { state: "not_synced"; projectId: string } | { state: "local"; projectId: string; syncedAt: number | null };

const BACK: Record<FileJobKind, [string, string]> = { permit: ["/permits", "Back to permits"], drawing: ["/drawings", "Back to drawings"], document: ["/documents", "Back to documents"] };

export default function FileRecordNewScreen({ kind, shell, data }: { kind: FileJobKind; shell: ShellScreenProps["shell"]; data: ListData }) {
  const word = FILE_KIND_WORDS[kind];
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // a new <input type=file> after a save, so the old choice is not shown
  const [number, setNumber] = useState("");
  const [authority, setAuthority] = useState("");
  const [issued, setIssued] = useState("");
  const [expiry, setExpiry] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [rev, setRev] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const testId = `${kind}-new`;

  if (data.state !== "local") return <StateMessage testId={testId} title={word.label} state={data.state} what={word.one} />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r =
        kind === "permit"
          ? await addFileRecordOffline(shell.data, "permit", { projectId, fields: { name, permitNumber: number, permitAuthority: authority, expiryDate: expiry, issueDate: issued }, file }, shell.files)
          : kind === "drawing"
            ? await addFileRecordOffline(shell.data, "drawing", { projectId, fields: { name, drawingNo, rev, discipline }, file }, shell.files)
            : await addFileRecordOffline(shell.data, "document", { projectId, fields: { name, category, expiryDate: expiry }, file }, shell.files);
      if (r.ok) {
        setNote({ ok: true, text: shell.connectivity === "online" ? "Saved on this laptop. The file is being sent." : "Saved on this laptop. The file will be sent when you are connected, and then the record is added." });
        setName(""); setNumber(""); setAuthority(""); setIssued(""); setExpiry(""); setDrawingNo(""); setRev(""); setDiscipline(""); setCategory("");
        setFile(null);
        setFileKey((k) => k + 1);
        shell.refresh();
      } else {
        setNote({ ok: false, text: r.message });
      }
    } catch {
      setNote({ ok: false, text: "This could not be kept on this laptop. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen testId={testId} state="local" title={`${word.label}${label ? ` / ${label}` : ""}`}>
      <CopyNote testId={`${testId}-copy-note`} syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid={`${testId}-form`}>
          <label className="block text-sm">
            Name
            <input aria-label="Name" className={fieldClass} value={name} {...textHandlers(setName)} required />
          </label>
          {kind === "permit" ? (
            <>
              <label className="mt-3 block text-sm">
                Permit number
                <input aria-label="Permit number" className={fieldClass} value={number} {...textHandlers(setNumber)} required />
              </label>
              <label className="mt-3 block text-sm">
                Issued by
                <input aria-label="Issued by" className={fieldClass} value={authority} {...textHandlers(setAuthority)} required />
              </label>
              <label className="mt-3 block text-sm">
                Issue date (optional)
                <input aria-label="Issue date" type="date" className={fieldClass} value={issued} {...textHandlers(setIssued)} />
              </label>
              <label className="mt-3 block text-sm">
                Expiry date
                <input aria-label="Expiry date" type="date" className={fieldClass} value={expiry} {...textHandlers(setExpiry)} required />
              </label>
            </>
          ) : null}
          {kind === "drawing" ? (
            <>
              <label className="mt-3 block text-sm">
                Drawing number (optional)
                <input aria-label="Drawing number" className={fieldClass} value={drawingNo} {...textHandlers(setDrawingNo)} />
              </label>
              <label className="mt-3 block text-sm">
                Revision (optional)
                <input aria-label="Revision" className={fieldClass} value={rev} {...textHandlers(setRev)} />
              </label>
              <label className="mt-3 block text-sm">
                Discipline (optional)
                <input aria-label="Discipline" className={fieldClass} value={discipline} {...textHandlers(setDiscipline)} />
              </label>
            </>
          ) : null}
          {kind === "document" ? (
            <>
              <label className="mt-3 block text-sm">
                Category
                <select aria-label="Category" className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value)} required>
                  <option value="">Choose a category</option>
                  {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="mt-3 block text-sm">
                Expiry date (optional)
                <input aria-label="Expiry date" type="date" className={fieldClass} value={expiry} {...textHandlers(setExpiry)} />
              </label>
            </>
          ) : null}
          <label className="mt-3 block text-sm">
            File (up to 25 MB)
            <input key={fileKey} aria-label="File" type="file" className={fieldClass} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} required />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : `Save ${word.one}`}</Button>
          {note ? (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-px-ink" data-testid="save-note" data-ok={note.ok ? "1" : "0"}>{note.text}</p>
          ) : null}
        </form>
      )}
      <FilesWaiting shell={shell} kinds={[kind]} projectId={projectId} tick={data} />
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject(BACK[kind][0], projectId)}>{BACK[kind][1]}</a></p>
    </Screen>
  );
}
