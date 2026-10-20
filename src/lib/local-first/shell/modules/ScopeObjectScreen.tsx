"use client";

// LOCAL-FIRST shell, one BOQ: its lines from the laptop's own copy, and a Category the person can change with no network. The change
// is kept on the laptop at once and sent when the laptop can reach the server (shell/pending-edits.ts); the line says "Waiting to
// sync" until it has been. Everything else on the online BOQ page (submit, approve, revise, the money grid) stays on the server.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APPROVE_SELF_REASON, approveBlockedReason, formatAmount } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import { formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import type { ScopeObjectData } from "./scope-adapter";
import { useRowWindow } from "./use-row-window";
import { mayOffer, projectQuery } from "./DesignChangeShared";

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
  rate: string | number; amount: string | number; category?: string | null; breakdownPercentage?: string | number | null;
};

// AUDIT-100 B15: one memoised row. A keystroke in one Category box used to re-render EVERY row (5,000 lines: a 0.5-0.9 s freeze per key,
// measured in real Chromium, e2e/lf-lifecycle-large-project.spec.ts). Now only the row whose draft, saving or waiting state changed renders.
type Conflict = { editId: string; lineId: string; mine: string | null; theirs: string | null };
const shown = (v: string | null) => (v === null || v === "" ? "(empty)" : `“${v}”`);

const LineRow = memo(function LineRow({ line, index, childSum, draft, waiting, conflict, saving, onDraft, onSave, onResolve }: {
  line: RowLine; index: number; childSum: number | null; draft: string | undefined; waiting: boolean; conflict?: Conflict; saving: boolean;
  onDraft: (lineId: string, value: string) => void; onSave: (lineId: string, raw: string) => void;
  onResolve: (editId: string, lineId: string, choice: "mine" | "theirs") => void;
}) {
  const changed = draft !== undefined && draft.trim() !== (line.category ?? "");
  return (
    <TableRow data-testid="boq-local-line" data-line-id={line.id} data-row-index={index} aria-rowindex={index + 2}>
      <TableCell>{line.itemCode ?? ""}</TableCell>
      <TableCell className={line.parentLineItemId ? "pl-6" : undefined}>
        {line.description}
        {/* R-31 / R-15: the same two labels the online screen shows -- a sub-task says "N% of parent", a parent says what its children add up to */}
        {line.parentLineItemId && line.breakdownPercentage != null && line.breakdownPercentage !== "" ? <span className="ml-2 text-[10px] text-px-muted" data-testid="boq-local-pct-of-parent">{String(line.breakdownPercentage)}% of parent</span> : null}
        {!line.parentLineItemId && childSum !== null ? <span className="ml-2 text-[10px] text-px-muted" data-testid="boq-local-children-sum">(children: {childSum}%)</span> : null}
      </TableCell>
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
          {conflict ? (
            <span className="text-xs text-px-ink" role="alert" data-testid="boq-line-conflict">
              Someone else changed this to {shown(conflict.theirs)} while you changed it to {shown(conflict.mine)}. Which do you want to keep?{" "}
              <Button type="button" size="sm" variant="outline" data-testid="boq-conflict-mine" onClick={() => onResolve(conflict.editId, line.id, "mine")}>Keep mine</Button>{" "}
              <Button type="button" size="sm" variant="outline" data-testid="boq-conflict-theirs" onClick={() => onResolve(conflict.editId, line.id, "theirs")}>Keep theirs</Button>
            </span>
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
  // Approve (R-... BOQ detail parity): the same /api/scope/<id>/approve the online page calls. The server decides who may approve; the
  // laptop only declines to offer it to a role it knows cannot, and shows the server's "independent approver" refusal in words.
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [selfBlocked, setSelfBlocked] = useState(false);
  const [approveNote, setApproveNote] = useState<{ ok: boolean; text: string } | null>(null);
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
      // base = what the person SAW in this box before changing it (G-14); the writer keeps the first base of a line with edits already waiting
      const seenRaw = d.lines.find((l) => l.id === lineId)?.category ?? null;
      const seen = seenRaw !== null && seenRaw.trim() === "" ? null : seenRaw; // blank and "no category" are the same thing
      await sh.writer.enqueue({ lineId, boqId: boq.id, projectId: boq.projectId, patch: { category: raw.trim() === "" ? null : raw.trim() }, base: { category: seen } });
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

  const onResolve = useCallback(async (editId: string, lineId: string, choice: "mine" | "theirs") => {
    const { shell: sh, data: d } = latest.current;
    await sh.writer.resolveConflict(editId, choice);
    if (choice === "theirs" && d.state === "local") {
      // their value is on the server: bring this project's lines up to date now so the box shows it (the writer already dropped the edit)
      void import("../../replica-shared").then((m) => m.revalidateViaSharedReplica({ kind: "boq_lines", projectId: d.boq.projectId, userId: sh.data.userId })).catch(() => {});
    }
    setNote(choice === "mine" ? "Kept yours. It is being sent again." : "Kept theirs.");
    sh.refresh();
    if (choice === "mine") void sh.writer.flush();
  }, []);

  // A BOQ somebody has just submitted is still "draft" in this laptop's copy until the next copy arrives: on opening a BOQ that is not approved
  // yet, while online, bring this project's BOQ headers and lines up to date once, so the Approve button is there within seconds rather than
  // at the next background refresh.
  const openBoqId = data.state === "local" ? data.boq.id : null;
  const openProjectId = data.state === "local" ? data.boq.projectId : null;
  const openStatus = data.state === "local" ? data.boq.status : null;
  const isOnline = shell.connectivity === "online";
  const userIdForCopy = shell.data.userId;
  const refreshShell = shell.refresh;
  useEffect(() => {
    if (!openBoqId || !openProjectId || !isOnline || openStatus === "approved" || openStatus === "superseded") return;
    let live = true;
    void (async () => {
      try {
        const m = await import("../../replica-shared");
        await m.revalidateViaSharedReplica({ kind: "boqs", projectId: openProjectId, userId: userIdForCopy });
        await m.revalidateViaSharedReplica({ kind: "boq_lines", projectId: openProjectId, userId: userIdForCopy });
        if (live) refreshShell();
      } catch {
        /* the copy stays as it was: the next refresh tries again */
      }
    })();
    return () => {
      live = false;
    };
  }, [openBoqId, openProjectId, openStatus, isOnline, userIdForCopy, refreshShell]);

  async function approve() {
    if (data.state !== "local") return;
    const { boq } = data;
    setApproving(true);
    setApproveNote(null);
    try {
      const res = await fetch(`/api/scope/${encodeURIComponent(boq.id)}/approve`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const message = typeof body.error === "string" ? body.error : "";
      if (!res.ok) {
        if (res.status === 403 && /independent approver/i.test(message)) setSelfBlocked(true);
        throw new Error(message || "Could not approve this BOQ.");
      }
      setApproved(true);
      setApproveNote({ ok: true, text: "Approved." });
      shell.refresh();
    } catch (err) {
      setApproveNote({ ok: false, text: err instanceof Error ? err.message : "Could not approve this BOQ." });
    } finally {
      setApproving(false);
    }
  }

  // AUDIT-100 B15: a long BOQ draws only the lines on screen (plus a margin), not all of them: drawing 5,000 real rows took 5-9 s
  // (e2e/lf-lifecycle-large-project.spec.ts). See use-row-window.ts for what keeps working (focus, printing, the row count for a screen reader).
  const { plan: rows, windowed, gapHeight, attachBody, onFocus: onBodyFocus, onBlur: onBodyBlur } = useRowWindow(data.state === "local" ? data.lines.length : 0);

  if (data.state === "no_project") return <Message state="no_project">There is no project on this laptop yet. Open PROJEXA once while you are online.</Message>;
  if (data.state === "not_synced") return <Message state="not_synced">This BOQ&apos;s project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.</Message>;
  if (data.state === "not_found") return <Message state="not_found">This BOQ is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</Message>;

  if (data.state === "sent") return <Message state="sent">This BOQ has been sent to the server. It is being copied back to this laptop and will open here in a moment.</Message>;

  if (data.state === "waiting") {
    // A BOQ or revision made on this laptop, not yet accepted by the server: its lines as the person typed them, marked as waiting.
    const w = data.waiting;
    return (
      <section data-testid="scope-object" data-state="waiting" data-boq-id={w.id}>
        <h1 className="font-heading text-2xl text-px-ink" data-testid="boq-local-title">{w.title}</h1>
        <p className="mt-1 text-sm text-px-muted">
          {revisionLabel(w.version)} · <span data-testid="boq-waiting-mark">Waiting to sync</span> · {w.lines.length} {w.lines.length === 1 ? "line" : "lines"}
        </p>
        <p className="mt-1 text-xs text-px-muted">Saved on this laptop. It will be sent to the server when you are connected, and the server may still refuse it.</p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table data-testid="boq-waiting-table">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead><TableHead>Description</TableHead><TableHead>Unit</TableHead>
                <TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {w.lines.map((l) => (
                <TableRow key={l.id} data-testid="boq-waiting-line">
                  <TableCell>{l.itemCode ?? ""}</TableCell>
                  <TableCell className={l.parentItemCode ? "pl-6" : undefined}>{l.description}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                  <TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right">{formatAmount(l.rate)}</TableCell>
                  <TableCell className="text-right">{formatAmount(l.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-right text-sm font-medium text-px-ink" data-testid="boq-local-total">Total {formatAmount(w.total)}</p>
      </section>
    );
  }

  const { boq, lines } = data;
  const childSums = new Map<string, number>();
  for (const l of lines as RowLine[]) {
    if (!l.parentLineItemId || l.breakdownPercentage == null || l.breakdownPercentage === "") continue;
    childSums.set(l.parentLineItemId, (childSums.get(l.parentLineItemId) ?? 0) + (Number(l.breakdownPercentage) || 0));
  }
  const waiting = new Set(data.waitingLineIds);
  const conflicts = new Map((data.conflicts ?? []).map((c) => [c.lineId, c]));

  return (
    <section data-testid="scope-object" data-state="local" data-boq-id={boq.id}>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="boq-local-title">{boq.title}</h1>
      <p className="mt-1 text-sm text-px-muted">
        {revisionLabel(boq.version)} · <span className="capitalize" data-testid="boq-local-status">{approved ? "approved" : boq.status}</span> · {lines.length} {lines.length === 1 ? "line" : "lines"}
      </p>
      {boq.status === "submitted" && !approved ? (() => {
        const blocked = approveBlockedReason(shell.data.role ?? undefined, selfBlocked);
        const offline = shell.connectivity !== "online";
        const reason = offline ? "Approving needs a connection. Approve it when you are online." : blocked;
        return (
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="boq-local-approve-bar">
            <Button type="button" size="sm" data-testid="boq-local-approve" disabled={approving || reason !== null} title={reason ?? undefined} onClick={() => void approve()}>
              {approving ? "Approving…" : "Approve"}
            </Button>
            {reason ? <span className="text-xs text-px-muted" data-testid="boq-local-approve-blocked">{reason}</span> : null}
          </div>
        );
      })() : null}
      {approveNote ? (
        <p role={approveNote.ok ? "status" : "alert"} className="mt-2 text-sm text-px-ink" data-testid="boq-local-approve-note" data-ok={approveNote.ok ? "1" : "0"}>
          {approveNote.text}
          {!approveNote.ok && selfBlocked && !approveNote.text.includes(APPROVE_SELF_REASON) ? ` ${APPROVE_SELF_REASON}` : ""}
        </p>
      ) : null}
      {boq.status !== "superseded" && mayOffer(shell.data.role, "create_boq_revision") ? (
        <p className="mt-1 text-sm">
          <a className="text-px-ink underline underline-offset-2" data-testid="boq-local-revise" href={`/scope/${encodeURIComponent(boq.id)}/revise${projectQuery(boq.projectId)}`}>New revision</a>
          {" · "}
          <a className="text-px-ink underline underline-offset-2" data-testid="boq-local-add-item" href={`/scope/${encodeURIComponent(boq.id)}/add-item${projectQuery(boq.projectId)}`}>Add a scope item</a>
        </p>
      ) : null}
      {mayOffer(shell.data.role, "update_line_item_budget") ? (
        <p className="mt-1 text-sm">
          <a className="text-px-ink underline underline-offset-2" data-testid="boq-local-budget" href={`/scope/${encodeURIComponent(boq.id)}/budget${projectQuery(boq.projectId)}`}>Line budgets</a>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-px-muted" data-testid="boq-local-copy-note">
        Saved on this laptop{data.syncedAt ? ` · last copied ${formatDateTime(data.syncedAt)}` : ""}
      </p>
      {note ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-px-ink" data-testid="boq-local-note">{note}</p>
      ) : null}
      <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <Table aria-rowcount={lines.length + 1} data-testid="boq-local-table" data-windowed={windowed ? "true" : "false"}>
          <TableHeader>
            <TableRow aria-rowindex={1}>
              <TableHead>Item</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={attachBody} onFocus={onBodyFocus} onBlur={onBodyBlur}>
            {rows.map((item) => {
              if (item.kind === "gap") {
                // lines not drawn: one empty row as tall as they are, so the page's length and scrollbar stay true
                return (
                  <tr key={`gap-${item.from}`} aria-hidden="true" data-testid="boq-row-spacer" style={{ height: gapHeight(item.from, item.to) }}>
                    <td colSpan={7} style={{ padding: 0, border: 0 }} />
                  </tr>
                );
              }
              const line = lines[item.index];
              return (
                <LineRow key={line.id} line={line} index={item.index} childSum={childSums.has(line.id) ? Math.round((childSums.get(line.id) ?? 0) * 100) / 100 : null} draft={drafts[line.id]} waiting={waiting.has(line.id)} conflict={conflicts.get(line.id)} saving={saving === line.id} onDraft={setDraft} onSave={onSave} onResolve={onResolve} />
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-right text-sm font-medium text-px-ink" data-testid="boq-local-total">Total {formatAmount(data.total)}</p>
    </section>
  );
}
