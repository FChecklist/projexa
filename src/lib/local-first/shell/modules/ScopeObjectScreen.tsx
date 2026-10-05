"use client";

// LOCAL-FIRST shell, one BOQ: its lines from the laptop's own copy, and a Category the person can change with no network. The change
// is kept on the laptop at once and sent when the laptop can reach the server (shell/pending-edits.ts); the line says "Waiting to
// sync" until it has been. Everything else on the online BOQ page (submit, approve, revise, the money grid) stays on the server.

import { memo, useCallback, useEffect, useRef, useState } from "react";
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

type RowLine = {
  id: string; itemCode?: string | null; description: string; parentLineItemId?: string | null; unit: string; quantity: string | number;
  rate: string | number; amount: string | number; category?: string | null;
};

// AUDIT-100 B15: one memoised row. A keystroke in one Category box used to re-render EVERY row (5,000 lines: a 0.5-0.9 s freeze per key,
// measured in real Chromium, e2e/lf-lifecycle-large-project.spec.ts). Now only the row whose draft, saving or waiting state changed renders.
const LineRow = memo(function LineRow({ line, draft, waiting, saving, onDraft, onSave }: {
  line: RowLine; draft: string | undefined; waiting: boolean; saving: boolean;
  onDraft: (lineId: string, value: string) => void; onSave: (lineId: string, raw: string) => void;
}) {
  const changed = draft !== undefined && draft.trim() !== (line.category ?? "");
  return (
    <TableRow data-testid="boq-local-line" data-line-id={line.id}>
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
            // The value is read HERE, while the event is being dispatched, never inside the state updater: React runs an
            // updater later when another update is already queued (the second of the two events above), and by then the
            // event's currentTarget is null -- in Chromium every keystroke crashed the screen ("This page couldn't load",
            // lf-e8, e2e/offline-local-first.spec.ts).
            onChange={(e) => onDraft(line.id, e.currentTarget.value)}
            onInput={(e) => onDraft(line.id, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && changed && draft !== undefined) onSave(line.id, draft);
            }}
          />
          {changed ? (
            <Button type="button" size="sm" data-testid="boq-line-save" disabled={saving} onClick={() => { if (draft !== undefined) onSave(line.id, draft); }}>
              Save
            </Button>
          ) : null}
          {waiting ? (
            <span className="text-xs text-px-muted" data-testid="boq-line-waiting">Waiting to sync</span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
});

export default function ScopeObjectScreen({ shell, data }: ShellScreenProps<ScopeObjectData>) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /** `value` must be read from the event by the caller, synchronously (see the category input below). */
  const setDraft = useCallback((lineId: string, value: string) => setDrafts((d) => ({ ...d, [lineId]: value })), []);

  // One function for every row, and its identity NEVER changes: the shell hands each screen a new `shell` object whenever it renders, so a
  // callback that depended on it would be new each time and every memoised row would render again (5,000 lines: 0.6-1 s per keystroke).
  // It reads the latest shell and data from a ref instead, and gets the draft from the row, so it never depends on the drafts state either.
  const latest = useRef({ shell, data });
  useEffect(() => {
    latest.current = { shell, data };
  });
  const onSave = useCallback(async (lineId: string, raw: string) => {
    const { shell: sh, data: d } = latest.current;
    if (d.state !== "local") return;
    const boq = d.boq;
    setSaving(lineId);
    try {
      await sh.writer.enqueue({ lineId, boqId: boq.id, projectId: boq.projectId, patch: { category: raw.trim() === "" ? null : raw.trim() } });
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[lineId];
        return next;
      });
      setNote(sh.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.");
      sh.refresh();
    } catch {
      setNote("This change could not be saved on this laptop. Please try again.");
    } finally {
      setSaving(null);
    }
  }, []);

  if (data.state === "no_project") return <Message state="no_project">There is no project on this laptop yet. Open PROJEXA once while you are online.</Message>;
  if (data.state === "not_synced") return <Message state="not_synced">This BOQ&apos;s project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.</Message>;
  if (data.state === "not_found") return <Message state="not_found">This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</Message>;

  const { boq, lines } = data;
  const waiting = new Set(data.waitingLineIds);

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
            {lines.map((line) => (
              <LineRow key={line.id} line={line} draft={drafts[line.id]} waiting={waiting.has(line.id)} saving={saving === line.id} onDraft={setDraft} onSave={onSave} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-right text-sm font-medium text-px-ink" data-testid="boq-local-total">Total {formatAmount(data.total)}</p>
    </section>
  );
}
