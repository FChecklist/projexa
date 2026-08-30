"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New BOQ" Dialog popup with a real Object Page in create mode, same
// ObjectScreen archetype as the Scope Object Page and PermitObjectClient.
// No draft lifecycle here (unlike Permits) -- a BOQ is created in one shot
// with its full line-item set, matching the real backend's own
// createBoq() contract; there is nothing meaningful to autosave mid-typing.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { emptyLine, childPercentSum, collectLines, toPayloadLineItems, type LineItemDraft } from "@/lib/boq-helpers";

export default function ScopeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function createBoq() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      toast.error(lineError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, lineItems: toPayloadLineItems(validLines) }),
      });
      let data: { id?: unknown; lineItems?: unknown; error?: unknown } | null = null;
      let parseFailed = false;
      try { data = await res.json(); } catch { parseFailed = true; }

      if (!res.ok) throw new Error((typeof data?.error === "string" && data.error) || "Couldn't create BOQ");
      if (parseFailed || !data) throw new Error("Couldn't create BOQ — the server's response was unreadable, so nothing is confirmed saved.");
      const savedId = typeof data.id === "string" ? data.id.trim() : "";
      if (!savedId) throw new Error("Couldn't create BOQ — the server did not confirm a saved BOQ. Nothing was saved.");
      const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
      if (savedLineItems < validLines.length) {
        throw new Error(`Couldn't create BOQ — ${validLines.length} line item(s) were submitted but only ${savedLineItems} came back saved.`);
      }
      toast.success("BOQ created");
      router.push(`/scope/${savedId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create BOQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Scope / New BOQ"
      title="New Bill of Quantities"
      mode="create"
      hasDraft={false}
      onSave={createBoq}
      onCancel={() => router.push(`/scope?projectId=${projectId}`)}
      onBack={() => router.push(`/scope?projectId=${projectId}`)}
      saveDisabled={submitting}
      saveDisabledReason={submitting ? "Creating…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Civil Works - Phase 1" />
        </div>
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
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                  ✕
                </Button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            + Add Line
          </Button>
        </div>
      </div>
    </ObjectScreen>
  );
}
