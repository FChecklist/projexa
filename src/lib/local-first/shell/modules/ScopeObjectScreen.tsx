"use client";

// LOCAL-FIRST shell, one BOQ: its lines from the laptop's own copy, and a Category the person can change with no network. The change
// is kept on the laptop at once and sent when the laptop can reach the server (shell/pending-edits.ts); the line says "Waiting to
// sync" until it has been. Everything else on the online BOQ page (submit, approve, revise, the money grid) stays on the server.

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import { formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import type { ScopeObjectData } from "./scope-adapter";

function Message({ state, children }: { state: string; children: string }) {
  return (
    <section data-testid="scope-object" data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">BOQ</h1>
      <p className="mt-3 text-sm text-px-muted">{children}</p>
      <p className="mt-3 text-sm">
        <a className="text-px-ink underline underline-offset-2" href="/scope">Back to Scope of Work</a>
      </p>
    </section>
  );
}

export default function ScopeObjectScreen({ shell, data }: ShellScreenProps<ScopeObjectData>) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  if (data.state === "no_project") return <Message state="no_project">There is no project on this laptop yet. Open PROJEXA once while you are online.</Message>;
  if (data.state === "not_synced") return <Message state="not_synced">This BOQ&apos;s project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.</Message>;
  if (data.state === "not_found") return <Message state="not_found">This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</Message>;

  const { boq, lines } = data;
  const waiting = new Set(data.waitingLineIds);

  async function save(lineId: string) {
    const raw = drafts[lineId];
    if (raw === undefined) return;
    setSaving(lineId);
    try {
      await shell.writer.enqueue({ lineId, boqId: boq.id, projectId: boq.projectId, patch: { category: raw.trim() === "" ? null : raw.trim() } });
      setDrafts((d) => {
        const next = { ...d };
        delete next[lineId];
        return next;
      });
      setNote(shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.");
      shell.refresh();
    } catch {
      setNote("This change could not be saved on this laptop. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section data-testid="scope-object" data-state="local" data-boq-id={boq.id}>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="boq-local-title">{boq.title}</h1>
      <p className="mt-1 text-sm text-px-muted">
        {revisionLabel(boq.version)} · <span className="capitalize">{boq.status}</span> · {lines.length} {lines.length === 1 ? "line" : "lines"}
      </p>
      <p className="mt-1 text-xs text-px-muted" data-testid="boq-local-copy-note">
        Saved on this laptop{data.syncedAt ? ` · last copied ${formatDateTime(data.syncedAt)}` : ""}
      </p>
      {note ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-px-ink" data-testid="boq-local-note">{note}</p>
      ) : null}
      <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const draft = drafts[line.id];
              const changed = draft !== undefined && draft.trim() !== (line.category ?? "");
              return (
                <TableRow key={line.id} data-testid="boq-local-line" data-line-id={line.id}>
                  <TableCell>{line.itemCode ?? ""}</TableCell>
                  <TableCell className={line.parentLineItemId ? "pl-6" : undefined}>{line.description}</TableCell>
                  <TableCell>{line.unit}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{formatAmount(line.rate)}</TableCell>
                  <TableCell className="text-right">{formatAmount(line.amount)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Category for ${line.description}`}
                        data-testid="boq-line-category-input"
                        className="h-8 w-36"
                        value={draft ?? line.category ?? ""}
                        // The same handler on both events: a real keystroke raises both (the second is a no-op), and onInput is what
                        // the repo's test environment can drive (see src/lib/mom-form.ts's header).
                        onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.currentTarget.value }))}
                        onInput={(e) => setDrafts((d) => ({ ...d, [line.id]: e.currentTarget.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && changed) void save(line.id);
                        }}
                      />
                      {changed ? (
                        <Button type="button" size="sm" data-testid="boq-line-save" disabled={saving === line.id} onClick={() => void save(line.id)}>
                          Save
                        </Button>
                      ) : null}
                      {waiting.has(line.id) ? (
                        <span className="text-xs text-px-muted" data-testid="boq-line-waiting">Waiting to sync</span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-right text-sm font-medium text-px-ink" data-testid="boq-local-total">Total {formatAmount(data.total)}</p>
    </section>
  );
}
