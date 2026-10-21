"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New Revision" Dialog popup with a real screen. Loads the CURRENT BOQ's
// own line items to seed the form (a revision starts from the existing
// scope, not blank), same as the old dialog's openRevisionDialog() did.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// R67 D-24/D-27: the PROJEXA-local ObjectScreen fork (programme decision
// D-09), so this screen gets the same disabled-with-reason primary the create
// screen uses and its server errors land in the persistent messages band.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import BoqLineGrid from "@/components/BoqLineGrid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDayMonthYear } from "@/lib/format-date";
import { ApiError, fetchJson } from "@/lib/fetch-json";
// GUIDED ERRORS (G1): faults the form finds, a refusal from the server and the scope-reduction block are all told in the inline panel, each taking
// the person to the exact input; what was typed (title and every line) is kept in a draft across a "Fix it now" trip. See g1-faults.ts.
import { FaultPanel } from "@/components/FaultPanel";
import { ActionFailurePanel, type ActionFailureState } from "@/components/ActionFailure";
import { useDraft } from "@/lib/error-guide/use-draft";
import { boqDraftFaults, boqLineId, faultsByField, fieldFromServerMessage, remapFaults, siFileFault, stillTrue, type Fault } from "@/lib/error-guide/g1-faults";
import { conflictLabel, conflictQuantity, overrideActionLabel, type ScopeReductionConflict } from "@/lib/scope-conflicts";
import {
  type Boq, type BoqLineItemRow, type LineItemDraft,
  TITLE_REQUIRED_MESSAGE, emptyLine, toDrafts, collectLines, missingBoqFields, toPayloadLineItems,
} from "@/lib/boq-helpers";
import { useBoqCategories } from "@/components/BoqCategorySelect";
import { viaPxApi } from "@/lib/px-api";

export default function ScopeReviseClient({ boqId }: { boqId: string }) {
  const router = useRouter();
  // R-98 (2026-09-19, Owner-authorized): the real link from an approved
  // Change Order to the BOQ revision it caused --
  // ChangeOrderObjectClient.tsx's own "Create BOQ Revision" button
  // navigates here with this param. Absent for every ordinary revision
  // (the normal case), which behaves exactly as before.
  const searchParams = useSearchParams();
  const sourceChangeOrderId = searchParams.get("fromChangeOrder");
  const [boq, setBoq] = useState<Boq | null>(null);
  const [loadError, setLoadError] = useState<ActionFailureState | null>(null);
  // The revision starts as a copy of the BOQ (`seed`); anything the person changes is kept in a draft (sessionStorage, 2 h) that wins over the
  // seed, so leaving through a "Fix it now" link and coming back never loses the edits.
  const [seed, setSeed] = useState<{ title: string; lines: LineItemDraft[] } | null>(null);
  const draft = useDraft<{ title: string | null; lines: LineItemDraft[] | null }>(`boq-revise:${boqId}`, { title: null, lines: null });
  const title = draft.value.title ?? seed?.title ?? "";
  const lines = draft.value.lines ?? seed?.lines ?? [emptyLine()];
  const setTitle = (v: string) => draft.set({ title: v, lines });
  const setLines = (update: (prev: LineItemDraft[]) => LineItemDraft[]) => draft.set({ title, lines: update(lines) });
  const [titleBlurred, setTitleBlurred] = useState(false);
  // faults found by the form (fields, in reading order) and the failure of the last request
  const [faults, setFaults] = useState<Fault[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<ActionFailureState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scopeBlock, setScopeBlock] = useState<string | null>(null);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  // R67 lane I (WS-I item I-05, R-177). Same control and same registration
  // behaviour as ScopeCreateClient -- a revision must be able to categorise a
  // line the original left blank.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();

  async function registerCategory(name: string) {
    addLocal(name);
    try {
      const res = await viaPxApi("/api/scope/categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        setMessages([{ level: "warning", text: data.error ?? `"${name}" was applied to this line but could not be added to the category list.` }]);
      }
    } catch {
      setMessages([{ level: "warning", text: `"${name}" was applied to this line but could not be added to the category list.` }]);
    }
  }
  // R67 D-27: the lines the 409 is actually about, as rows rather than prose.
  const [conflicts, setConflicts] = useState<ScopeReductionConflict[]>([]);
  const [siFile, setSiFile] = useState<File | null>(null);
  // Whether this instruction carries a cost impact. STATED by the user, never
  // assumed: in a construction ERP that flag is what drives change-order and
  // claim workflows, so the record must not assert a commercial fact nobody
  // chose. A variation with a real money figure is the common case, so it
  // starts ticked -- but it is a control the user can see and untick, not a
  // constant buried in the route.
  const [siCostImpact, setSiCostImpact] = useState(true);
  // Set once the revision has been created, so an attachment Retry attaches to
  // THAT revision instead of creating a second one.
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<Boq & { lineItems: BoqLineItemRow[] }>(`/api/scope/${boqId}`);
      setBoq(data);
      const rows = data.lineItems ?? [];
      setSeed({ title: data.title, lines: rows.length > 0 ? toDrafts(rows) : [emptyLine()] });
      setLoadError(null);
      // The category picklist is loaded once for the screen by useBoqCategories() above -- the org's editable list, not a per-project one derived
      // from values already written. Nothing to fetch here.
    } catch (err) {
      setBoq(null);
      setLoadError({ err, at: Date.now() });
    }
  }

  useEffect(() => { load(); }, [boqId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  // the revision title box is "revision-title" here; every other screen calls it "boq-title"
  const TITLE_REMAP = { "boq-title": "revision-title" } as const;
  const currentFaults = (): Fault[] => {
    const siFault = siFile ? siFileFault(siFile) : null;
    return [...remapFaults(boqDraftFaults(title, lines, { titleLabel: "revision" }), TITLE_REMAP), ...(siFault ? [siFault] : [])];
  };
  // A fixed fault leaves the panel as soon as it is fixed; nothing new is shouted while a line is still being typed.
  useEffect(() => {
    if (faults.length === 0) return;
    setFaults((prev) => stillTrue(prev, currentFaults()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.value.title, draft.value.lines, siFile]);
  const faultMessages = faultsByField(faults);

  const missing = useMemo(() => missingBoqFields(title, lines), [title, lines]);
  const titleError = titleBlurred && !title.trim() ? TITLE_REQUIRED_MESSAGE : null;

  /**
   * R67 D-27: the site instruction is attached AFTER the revision exists, so
   * the attachment carries the real revision id. A failure here is reported
   * with its own sentence and a Retry that still holds the file -- the file is
   * never dropped on the floor while the revision quietly succeeds.
   */
  async function attachSiteInstruction(revisionId: string, projectId: string): Promise<string | null> {
    if (!siFile) return null;
    const body = new FormData();
    body.set("file", siFile);
    body.set("projectId", projectId);
    body.set("boqId", revisionId);
    body.set("description", `Site instruction authorising revision of "${title}"`);
    body.set("costImpact", String(siCostImpact));
    try {
      const data = await fetchJson<{ attachmentError?: string }>("/api/site-instructions", { method: "POST", body });
      // 207: the record landed, the file did not
      return data?.attachmentError ?? null;
    } catch (err) {
      return err instanceof Error && err.message ? err.message : "The site instruction could not be attached";
    }
  }

  async function submitRevision(allowScopeReductionOverride = false) {
    // Everything the form can see is wrong is told BEFORE anything is sent: which line, which input, what to type.
    const found = currentFaults();
    setFaults(found);
    if (found.length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    const { valid: validLines } = collectLines(lines);
    setSubmitting(true);
    setScopeBlock(null);
    setConflicts([]);
    setMessages([]);
    setFailure(null);
    try {
      const data = await fetchJson<{ id?: string; projectId?: string }>(`/api/scope/${boqId}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, lineItems: toPayloadLineItems(validLines), allowScopeReductionOverride,
          ...(sourceChangeOrderId ? { sourceChangeOrderId } : {}),
        }),
      });

      const revisionId: string = data.id ?? boqId;
      setSavedRevisionId(revisionId);
      draft.clear();
      const attachmentError = await attachSiteInstruction(revisionId, boq?.projectId ?? data.projectId ?? "");
      if (attachmentError) {
        // The revision IS saved. Say so, keep the file, and offer a Retry that can actually succeed -- navigating away here would lose the file.
        setMessages([
          { level: "warning", text: "Revision saved; the site instruction could not be attached - retry from the BOQ page" },
          { level: "error", text: attachmentError },
        ]);
        return;
      }
      if (siFile) {
        router.push(`/scope/${revisionId}?attached=${encodeURIComponent(siFile.name)}`);
        return;
      }
      router.push(`/scope/${revisionId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /scope reduction/i.test(err.message)) {
        // Owner's hard-block rule: this revision would reduce/remove scope already completed on site. Surface the real reason, the REAL LINES
        // (D-27's conflicts[]), take the person to the first of those lines, and let them explicitly override instead of silently failing.
        const found = (err.body as { conflicts?: ScopeReductionConflict[] } | null)?.conflicts;
        const list = Array.isArray(found) ? found : [];
        setScopeBlock(err.message);
        setConflicts(list);
        const first = list[0];
        const at = first ? lines.findIndex((l) => (first.itemCode ? (l.itemCode ?? "").trim() === first.itemCode : l.description.trim() === first.description)) : -1;
        setFailure({ err, field: at >= 0 ? boqLineId(at, "quantity") : undefined, at: Date.now() });
        return;
      }
      setFailure({ err, field: fieldFromServerMessage(err instanceof Error ? err.message : "", lines), at: Date.now(), retry: () => void submitRevision(allowScopeReductionOverride) });
    } finally {
      setSubmitting(false);
    }
  }

  /** Retry of the attachment ONLY -- the revision already exists, so re-posting it would create a second one. */
  async function retryAttachment() {
    if (!savedRevisionId || !boq) return;
    setSubmitting(true);
    try {
      const attachmentError = await attachSiteInstruction(savedRevisionId, boq.projectId);
      if (attachmentError) {
        setMessages([
          { level: "warning", text: "Revision saved; the site instruction could not be attached - retry from the BOQ page" },
          { level: "error", text: attachmentError },
        ]);
        return;
      }
      router.push(`/scope/${savedRevisionId}?attached=${encodeURIComponent(siFile?.name ?? "")}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <ActionFailurePanel failure={loadError} entityType="boq" entityId={boqId} onRetry={() => load()} retryable />
      </div>
    );
  }
  if (!boq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <KitObjectScreen
      breadcrumb="Scope / New Revision"
      title={`New Revision — from "${boq.title}" (v${boq.version})`}
      mode="create"
      hasDraft={false}
      onSave={() => submitRevision(false)}
      onCancel={() => router.push(`/scope/${boqId}`)}
      onBack={() => router.push(`/scope/${boqId}`)}
      saveDisabled={missing.length > 0 || submitting}
      saveDisabledReason={submitting ? "Creating…" : missing.length > 0 ? missing.join(", ") : undefined}
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        {draft.restored && (
          <p className="text-[12.5px] text-px-muted" data-testid="draft-restored">
            We kept what you typed earlier on this revision.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => { draft.startFresh(); setFaults([]); setFailure(null); }}>
              Start again from the BOQ
            </button>
          </p>
        )}
        <FaultPanel faults={faults} attempt={attempt} entityType="boq" entityId={boqId} projectId={boq.projectId} draftKey={`boq-revise:${boqId}`} remap={TITLE_REMAP} />
        {faults.length === 0 && <ActionFailurePanel failure={failure} entityType="boq" entityId={boqId} projectId={boq.projectId} draftKey={`boq-revise:${boqId}`} />}
        {sourceChangeOrderId && (
          <p className="rounded-md border border-ct-border bg-ct-cloud/40 px-3 py-2 text-[13px] text-ct-muted" data-testid="revise-linked-change-order-banner">
            This revision will be linked to the approved Change Order that caused it.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="revision-title">Revision Title (required)</Label>
          <Input
            id="revision-title"
            aria-required="true"
            aria-invalid={!!(titleError || faultMessages["boq-title"])}
            aria-describedby={titleError || faultMessages["boq-title"] ? "revision-title-error" : undefined}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleBlurred(true)}
            placeholder="e.g. Civil Works - Phase 1"
          />
          {(titleError || faultMessages["boq-title"]) && (
            <p id="revision-title-error" role="alert" className="flex items-start gap-1 text-[11px] text-px-error">
              <span aria-hidden="true">⚠</span><span>{titleError ?? faultMessages["boq-title"]}</span>
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          <BoqLineGrid
            lines={lines}
            categories={categories}
            categoriesFailed={categoriesFailed}
            onUpdate={updateLine}
            onAddCategory={registerCategory}
            onRemove={(index) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))}
            onAdd={() => setLines((prev) => [...prev, emptyLine()])}
            faultMessages={faultMessages}
          />
          <p className="text-xs text-ct-muted">Removing a line, or reducing its quantity/rate, is blocked if that item is already recorded as complete on site.</p>
        </div>

        {/* R67 D-27: Sumeet's second unwired artefact. A revision to a client's
            BOQ is authorised by a written instruction; there was nowhere to put
            it, and /api/site-instructions had zero UI callers. */}
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="site-instruction">Site instruction (optional) - PDF or photo</Label>
          <input
            id="site-instruction"
            type="file"
            accept=".pdf,image/*"
            className="block w-full text-[13px]"
            onChange={(e) => setSiFile(e.target.files?.[0] ?? null)}
            aria-invalid={faultMessages["site-instruction"] ? true : undefined}
            aria-describedby={faultMessages["site-instruction"] ? "site-instruction-error" : undefined}
          />
          {faultMessages["site-instruction"] && (
            <p id="site-instruction-error" role="alert" className="flex items-start gap-1 text-[11px] text-px-error">
              <span aria-hidden="true">⚠</span><span>{faultMessages["site-instruction"]}</span>
            </p>
          )}
          <p className="text-[11.5px] text-px-muted">Attach the client&apos;s instruction that authorises this change</p>
          <label className="flex items-start gap-2 pt-1 text-[12.5px] text-px-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={siCostImpact}
              disabled={!siFile}
              onChange={(e) => setSiCostImpact(e.target.checked)}
            />
            <span>
              This instruction has a cost impact
              <span className="block text-[11.5px] text-px-muted">
                Recorded on the instruction; it is what a change order or a claim is raised from.
              </span>
            </span>
          </label>
        </div>

        {savedRevisionId && messages.some((m) => m.level === "warning") && (
          <Button variant="outline" size="sm" onClick={retryAttachment} disabled={submitting}>
            Retry attaching {siFile?.name}
          </Button>
        )}

        {scopeBlock && (
          <div className="rounded-md border border-px-error-border bg-px-error-light p-3">
            {/* the sentence itself is in the panel above; these are the lines it is about */}
            <p className="text-sm text-px-error">Lines with work already recorded on site:</p>
            {conflicts.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded-md border border-px-error-border bg-px-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Recorded</TableHead>
                      <TableHead>Last recorded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conflicts.map((c, i) => (
                      <TableRow key={`${c.itemCode ?? c.description}-${i}`}>
                        <TableCell className="font-medium">{conflictLabel(c)}</TableCell>
                        <TableCell className="text-right tabular-nums">{conflictQuantity(c)}</TableCell>
                        <TableCell className="text-px-muted">{formatDayMonthYear(c.lastRecordedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* The destructive way out is separated by a spacer, never adjacent
                to a common action, and its label names how much it overrides. */}
            <div className="mt-2 flex items-center">
              <div className="flex-1" />
              <Button size="sm" variant="destructive" onClick={() => submitRevision(true)} disabled={submitting}>
                {overrideActionLabel(conflicts.length)}
              </Button>
            </div>
          </div>
        )}
      </div>
    </KitObjectScreen>
  );
}
