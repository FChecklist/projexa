"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New Revision" Dialog popup with a real screen. Loads the CURRENT BOQ's
// own line items to seed the form (a revision starts from the existing
// scope, not blank), same as the old dialog's openRevisionDialog() did.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import {
  type Boq, type BoqLineItemRow, type LineItemDraft,
  emptyLine, toDrafts, childPercentSum, collectLines, toPayloadLineItems,
} from "@/lib/boq-helpers";

export default function ScopeReviseClient({ boqId }: { boqId: string }) {
  const router = useRouter();
  const [boq, setBoq] = useState<Boq | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [scopeBlock, setScopeBlock] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<Boq & { lineItems: BoqLineItemRow[] }>(`/api/scope/${boqId}`);
      setBoq(data);
      setTitle(data.title);
      const rows = data.lineItems ?? [];
      setLines(rows.length > 0 ? toDrafts(rows) : [emptyLine()]);
      setLoadError(null);
    } catch (err) {
      setBoq(null);
      setLoadError(errorMessage(err, "Couldn't load the current scope to revise"));
    }
  }

  useEffect(() => { load(); }, [boqId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function submitRevision(allowScopeReductionOverride = false) {
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      toast.error(lineError);
      return;
    }
    setSubmitting(true);
    setScopeBlock(null);
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
      toast.success(allowScopeReductionOverride ? "Revision created (override applied)" : "Revision created");
      router.push(`/scope/${data.id ?? boqId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create revision");
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
      saveDisabled={submitting}
      saveDisabledReason={submitting ? "Creating…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Revision Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((line, i) => {
            const childSum = childPercentSum(lines, line.itemCode);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-[180px] flex-1" placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                <Input className="w-[80px] shrink-0" placeholder="Unit" value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                <Input
                  className="w-[90px] shrink-0" placeholder="Qty" type="number" value={line.quantity}
                  onChange={(e) => updateLine(i, "quantity", e.target.value)}
                  disabled={!!line.parentItemCode?.trim()}
                  title={line.parentItemCode?.trim() ? "A sub-task's quantity comes from its root line -- this field is not used" : undefined}
                />
                <Input
                  className="w-[90px] shrink-0" placeholder="Rate" type="number" value={line.rate}
                  onChange={(e) => updateLine(i, "rate", e.target.value)}
                  disabled={!!line.parentItemCode?.trim()}
                  title={line.parentItemCode?.trim() ? "A sub-task's rate is derived from its root line's rate x breakdown % -- this field is not used" : undefined}
                />
                <Input className="w-[110px] shrink-0" placeholder="Item Code" value={line.itemCode ?? ""} onChange={(e) => updateLine(i, "itemCode", e.target.value)} />
                <Input className="w-[130px] shrink-0" placeholder="Parent Item Code" value={line.parentItemCode ?? ""} onChange={(e) => updateLine(i, "parentItemCode", e.target.value)} />
                <Input className="w-[110px] shrink-0" placeholder="Breakdown %" type="number" value={line.breakdownPercentage ?? ""} onChange={(e) => updateLine(i, "breakdownPercentage", e.target.value)} />
                {childSum != null && <span className="text-xs text-ct-muted">{childSum}% total</span>}
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</Button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>+ Add Line</Button>
          <p className="text-xs text-ct-muted">Removing a line, or reducing its quantity/rate, is blocked if that item is already recorded as complete on site.</p>
        </div>
        {scopeBlock && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="space-y-2 p-3 text-sm text-px-error">
              <p>{scopeBlock}</p>
              <Button size="sm" variant="destructive" onClick={() => submitRevision(true)} disabled={submitting}>
                Apply anyway (override)
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </ObjectScreen>
  );
}
