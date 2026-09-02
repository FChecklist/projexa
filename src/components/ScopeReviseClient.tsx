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
import { fetchJson, errorMessage } from "@/lib/fetch-json";
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

  async function load() {
    try {
      const data = await fetchJson<Boq & { lineItems: BoqLineItemRow[] }>(`/api/scope/${boqId}`);
      setBoq(data);
      setTitle(data.title);
      const rows = data.lineItems ?? [];
      setLines(rows.length > 0 ? toDrafts(rows) : [emptyLine()]);
      setLoadError(null);
      // Optional picklist -- a failure degrades to an empty list, never blocks
      // the revision.
      fetchJson<{ categories?: string[] }>(`/api/scope/categories?projectId=${encodeURIComponent(data.projectId)}`)
        .then((c) => setCategories(c.categories ?? []))
        .catch(() => setCategories([]));
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

  async function submitRevision(allowScopeReductionOverride = false) {
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      setMessages([{ level: "error", text: lineError }]);
      return;
    }
    setSubmitting(true);
    setScopeBlock(null);
    setMessages([]);
    try {
      const res = await fetch(`/api/scope/${boqId}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, lineItems: toPayloadLineItems(validLines), allowScopeReductionOverride }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Owner's hard-block rule: this revision would reduce/remove scope
        // already completed on site. Surface the real reason and let the
        // user explicitly override instead of silently failing.
        setScopeBlock(data.error ?? "This revision reduces scope already completed on site.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to create revision");
      router.push(`/scope/${data.id ?? boqId}`);
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't create revision" }]);
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
        {scopeBlock && (
          <div className="rounded-md border border-px-error-border bg-px-error-light p-3">
            <p className="text-sm text-px-error">{scopeBlock}</p>
            <div className="mt-2 flex items-center">
              <div className="flex-1" />
              <Button size="sm" variant="destructive" onClick={() => submitRevision(true)} disabled={submitting}>
                Apply anyway (override)
              </Button>
            </div>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
