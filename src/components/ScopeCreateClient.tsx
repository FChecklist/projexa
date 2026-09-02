"use client";

// Real-screen conversion (2026-08-30) -- replaces ScopeClient.tsx's old
// "New BOQ" Dialog popup with a real Object Page in create mode, same
// ObjectScreen archetype as the Scope Object Page and PermitObjectClient.
// No draft lifecycle here (unlike Permits) -- a BOQ is created in one shot
// with its full line-item set, matching the real backend's own
// createBoq() contract; there is nothing meaningful to autosave mid-typing.
//
// R67 D-24: the form no longer offers an enabled Save on an empty screen that
// fails only after the click. missing[] is recomputed on every change and the
// primary renders "Save (Title, Line 1)" disabled with those exact names --
// the convention /labour/new already ships as "Save (Name, Daily Rate)".
// Server errors go to the ObjectScreen messages band (a persistent, readable
// place) instead of a toast that disappears before it can be acted on.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BoqLineGrid from "@/components/BoqLineGrid";
import { useBoqCategories } from "@/components/BoqCategorySelect";
import {
  TITLE_REQUIRED_MESSAGE, collectLines, emptyLine, missingBoqFields, toPayloadLineItems,
  type LineItemDraft,
} from "@/lib/boq-helpers";

export default function ScopeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [titleBlurred, setTitleBlurred] = useState(false);
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  // R67 lane I (WS-I item I-05, R-177): the org's EDITABLE category list
  // (compliance.construction_boq_categories), loaded once for the screen and
  // shared by every row. A load failure is not fatal -- Category is optional,
  // and BoqCategorySelect degrades to free text rather than offering nothing.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  // "Add new" registers the category org-wide so it is offered on every other
  // line and on the next BOQ. A failure to register is NOT fatal and NOT
  // silent: the name still lands on this line (nothing the user typed is
  // lost), and the message band says the list was not updated.
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

  const missing = useMemo(() => missingBoqFields(title, lines), [title, lines]);
  const titleError = titleBlurred && !title.trim() ? TITLE_REQUIRED_MESSAGE : null;

  async function createBoq() {
    const { valid: validLines, error: lineError } = collectLines(lines);
    if (lineError) {
      setMessages([{ level: "error", text: lineError }]);
      return;
    }
    setSubmitting(true);
    setMessages([]);
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
      router.push(`/scope/${savedId}`);
    } catch (err) {
      setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't create BOQ" }]);
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
      saveDisabled={missing.length > 0 || submitting}
      saveDisabledReason={submitting ? "Creating…" : missing.length > 0 ? missing.join(", ") : undefined}
      messages={messages}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="boq-title">Title (required)</Label>
          <Input
            id="boq-title"
            aria-required="true"
            aria-invalid={!!titleError}
            aria-describedby={titleError ? "boq-title-error" : undefined}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleBlurred(true)}
            placeholder="e.g. Civil Works - Phase 1"
          />
          {titleError && (
            <p id="boq-title-error" role="alert" className="flex items-start gap-1 text-[11px] text-px-error">
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
        </div>
      </div>
    </ObjectScreen>
  );
}
