"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New Revision" Dialog popup with a real screen. Loads the CURRENT BOQ's
// own line items to seed the form (a revision starts from the existing
// scope, not blank), same as the old dialog's openRevisionDialog() did.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// R67 D-24/D-27: the PROJEXA-local ObjectScreen fork (programme decision
// D-09), so this screen gets the same disabled-with-reason primary the create
// screen uses and its server errors land in the persistent messages band.
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import BoqLineGrid from "@/components/BoqLineGrid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDayMonthYear } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { conflictLabel, conflictQuantity, overrideActionLabel, type ScopeReductionConflict } from "@/lib/scope-conflicts";
import {
  type Boq, type BoqLineItemRow, type LineItemDraft,
  TITLE_REQUIRED_MESSAGE, emptyLine, toDrafts, collectLines, missingBoqFields, toPayloadLineItems,
} from "@/lib/boq-helpers";
import { useBoqCategories } from "@/components/BoqCategorySelect";

export default function ScopeReviseClient({ boqId }: { boqId: string }) {
  const router = useRouter();
  const [boq, setBoq] = useState<Boq | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleBlurred, setTitleBlurred] = useState(false);
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
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
      const res = await fetch("/api/scope/categories", {
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
      setTitle(data.title);
      const rows = data.lineItems ?? [];
      setLines(rows.length > 0 ? toDrafts(rows) : [emptyLine()]);
      setLoadError(null);
      // The category picklist is loaded once for the screen by
      // useBoqCategories() above -- the org's editable list, not a per-project
      // one derived from values already written. Nothing to fetch here.
    } catch (err) {
      setBoq(null);
      setLoadError(errorMessage(err, "Couldn't load the current scope to revise"));
    }
  }

  useEffect(() => { load(); }, [boqId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

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
    const res = await fetch("/api/site-instructions", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 207) return data.attachmentError ?? "The site instruction could not be attached";
    if (!res.ok) return data.error ?? "The site instruction could not be attached";
    return null;
  }

  async function submitRevision(allowScopeReductionOverride = false) {
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      setMessages([{ level: "error", text: lineError }]);
      return;
    }
    setSubmitting(true);
    setScopeBlock(null);
    setConflicts([]);
    setMessages([]);
    try {
      const res = await fetch(`/api/scope/${boqId}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, lineItems: toPayloadLineItems(validLines), allowScopeReductionOverride }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Owner's hard-block rule: this revision would reduce/remove scope
        // already completed on site. Surface the real reason, the REAL LINES
        // (D-27's conflicts[]), and let the user explicitly override instead of
        // silently failing.
        setScopeBlock(data.error ?? "This revision reduces scope already completed on site.");
        setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to create revision");

      const revisionId: string = data.id ?? boqId;
      setSavedRevisionId(revisionId);
      const attachmentError = await attachSiteInstruction(revisionId, boq?.projectId ?? data.projectId);
      if (attachmentError) {
        // The revision IS saved. Say so, keep the file, and offer a Retry that
        // can actually succeed -- navigating away here would lose the file.
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
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't create revision" }]);
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
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!boq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
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
        <div className="space-y-1.5">
          <Label htmlFor="revision-title">Revision Title (required)</Label>
          <Input
            id="revision-title"
            aria-required="true"
            aria-invalid={!!titleError}
            aria-describedby={titleError ? "revision-title-error" : undefined}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleBlurred(true)}
            placeholder="e.g. Civil Works - Phase 1"
          />
          {titleError && (
            <p id="revision-title-error" role="alert" className="flex items-start gap-1 text-[11px] text-px-error">
              <span aria-hidden="true">⚠</span><span>{titleError}</span>
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
          />
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
            <p className="text-sm text-px-error">{scopeBlock}</p>

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
    </ObjectScreen>
  );
}
