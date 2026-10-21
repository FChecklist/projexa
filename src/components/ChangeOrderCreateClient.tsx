"use client";

// Real-screen conversion (2026-08-30) -- replaces ChangeOrdersClient.tsx's
// old "New Change Order" Dialog popup with a real create screen.
//
// GUIDED ERRORS (G2): what is typed survives leaving the form (useDraft); a fault the form finds itself (no title, "abc" as a cost, 2.5 days) is
// written beside its field AND shown as a guide panel that outlines the exact field; a refusal from the server is the same panel, with the
// server's own words, and never a toast that fades. Nothing is sent while a fault exists.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { GuidedError } from "@/components/GuidedError";
import FaultPanel from "@/components/FaultPanel";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson } from "@/lib/fetch-json";
import { useDraft } from "@/lib/error-guide/use-draft";
import { contextFromError } from "@/lib/error-guide/context";
import { changeOrderFaults, messageFor } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";

export default function ChangeOrderCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const draft = useDraft(`change-order-new:${projectId}`, { title: "", reason: "", costImpact: "", scheduleImpactDays: "" });
  const { title, reason, costImpact, scheduleImpactDays } = draft.value;
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverFailure, setServerFailure] = useState<GuideContext | null>(null);

  const faults = changeOrderFaults({ title, costImpact, scheduleImpactDays });
  // "title missing" is only shown after the first press of Save; a malformed number is shown at once.
  const shown = faults.filter((f) => attempted || f.code !== "CO_TITLE_MISSING");

  async function createChangeOrder() {
    setAttempted(true);
    setServerFailure(null);
    if (faults.length > 0) {
      const el = findFocusTarget(faults[0].field);
      if (el) highlightElement(el);
      return;
    }
    setSubmitting(true);
    try {
      const data = await fetchJson<{ id: string }>("/api/change-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title: title.trim(), reason: reason || undefined,
          costImpact: costImpact ? Number(costImpact) : 0,
          scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : 0,
        }),
      });
      draft.clear();
      router.push(`/change-orders/${data.id}`);
    } catch (err) {
      setServerFailure(contextFromError(err, { projectId, entityType: "change_order" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Change Orders / New Change Order"
      title="New Change Order"
      mode="create"
      hasDraft={false}
      onSave={createChangeOrder}
      onCancel={() => router.push(`/change-orders?projectId=${projectId}`)}
      onBack={() => router.push(`/change-orders?projectId=${projectId}`)}
      saveDisabled={submitting}
      saveDisabledReason={submitting ? "Creating…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {draft.restored && !serverFailure && (
          <p role="status" data-testid="co-draft-restored" className="rounded-md border border-px-info-border bg-px-info-light px-3 py-2 text-[12.5px] text-px-info">
            We put back what you had typed here before you left. Check it, then press Save.
          </p>
        )}
        <FaultPanel faults={shown} draftKey={`change-order-new:${projectId}`} />
        {serverFailure && <GuidedError ctx={serverFailure} onRetry={() => void createChangeOrder()} draftKey={`change-order-new:${projectId}`} />}
        <FormField label="Title" required error={messageFor(shown, "co-title")}>
          {(f) => <Input {...f} data-testid="co-title" value={title} onChange={(e) => draft.set({ title: e.target.value })} />}
        </FormField>
        <FormField label="Reason (optional)">
          {(f) => <Textarea {...f} data-testid="co-reason" value={reason} onChange={(e) => draft.set({ reason: e.target.value })} rows={2} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={`Cost Impact (${currencyLabel(undefined, currencies).trim()})`} error={messageFor(shown, "co-cost")}>
            {(f) => <Input {...f} data-testid="co-cost" type="text" inputMode="decimal" value={costImpact} onChange={(e) => draft.set({ costImpact: e.target.value })} placeholder="+/- amount" />}
          </FormField>
          <FormField label="Schedule Impact (days)" error={messageFor(shown, "co-days")}>
            {(f) => <Input {...f} data-testid="co-days" type="text" inputMode="numeric" value={scheduleImpactDays} onChange={(e) => draft.set({ scheduleImpactDays: e.target.value })} placeholder="+/- days" />}
          </FormField>
        </div>
      </div>
    </ObjectScreen>
  );
}
