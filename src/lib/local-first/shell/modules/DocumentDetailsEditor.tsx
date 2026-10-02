"use client";

// LOCAL-FIRST shell, documents cluster: the details a person can change on the laptop (update_document_metadata through the outbox,
// documents-writes.ts). Which fields appear is decided by the screen (DETAIL_FIELDS): only what its online screen edits AND the
// registered function takes. The change is shown at once (the row is patched on the laptop) and marked "Waiting to sync".

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShellApi } from "../types";
import { DETAIL_FIELDS, canProposeEdits, editDocumentDetailsOffline, type DetailsScreen, type OutboxPort } from "./documents-writes";

const LABELS: Record<"name" | "category" | "expiryDate", Record<DetailsScreen, string>> = {
  name: { documents: "Name", permits: "Permit name", drawings: "Name" },
  category: { documents: "Category", permits: "Category", drawings: "Category" },
  expiryDate: { documents: "Expiry", permits: "End date", drawings: "Expiry" },
};

export function DocumentDetailsEditor({
  shell,
  screen,
  projectId,
  documentId,
  initial,
  outbox,
}: {
  shell: ShellApi;
  screen: DetailsScreen;
  projectId: string;
  documentId: string;
  initial: { name: string; category: string | null; expiryDate: string | null };
  /** Tests only. */
  outbox?: OutboxPort;
}) {
  const fields = DETAIL_FIELDS[screen] as readonly ("name" | "category" | "expiryDate")[];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: initial.name, category: initial.category ?? "", expiryDate: (initial.expiryDate ?? "").slice(0, 10) });
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!canProposeEdits(shell.data.role)) return null;
  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="outline" size="sm" data-testid="doc-edit-open" onClick={() => setOpen(true)}>Edit details</Button>
        {note ? <p className="mt-2 text-xs text-px-muted" data-testid="doc-edit-note">{note}</p> : null}
      </div>
    );
  }

  async function save() {
    setSaving(true);
    const details: Record<string, string | null> = {};
    if (fields.includes("name") && draft.name !== initial.name) details.name = draft.name;
    if (fields.includes("category") && draft.category !== (initial.category ?? "")) details.category = draft.category;
    if (fields.includes("expiryDate") && draft.expiryDate !== (initial.expiryDate ?? "").slice(0, 10)) details.expiryDate = draft.expiryDate === "" ? null : draft.expiryDate;
    const result = await editDocumentDetailsOffline(shell.data, screen, { projectId, documentId, details }, outbox ? { outbox } : {});
    setSaving(false);
    if (!result.ok) return setNote(result.message);
    setOpen(false);
    setNote(shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.");
    shell.refresh();
  }

  return (
    <form
      className="mt-4 grid max-w-md gap-3 rounded-lg border border-black/10 bg-white p-4"
      data-testid="doc-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((f) => (
        <label key={f} className="grid gap-1 text-sm">
          <span className="text-px-muted">{LABELS[f][screen]}</span>
          <Input
            data-testid={`doc-edit-${f}`}
            type={f === "expiryDate" ? "date" : "text"}
            value={draft[f]}
            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
          />
        </label>
      ))}
      {note ? <p className="text-xs text-px-muted" data-testid="doc-edit-note">{note}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" data-testid="doc-edit-save" disabled={saving}>Save</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
