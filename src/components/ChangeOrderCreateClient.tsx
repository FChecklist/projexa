"use client";

// Real-screen conversion (2026-08-30) -- replaces ChangeOrdersClient.tsx's
// old "New Change Order" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { currencyLabel, useCurrencies } from "@/lib/currency";

export default function ChangeOrderCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"title" | "costImpact" | "scheduleImpactDays">>({});
  const [submitting, setSubmitting] = useState(false);

  async function createChangeOrder() {
    const errs: FieldErrors<"title" | "costImpact" | "scheduleImpactDays"> = {};
    if (!title.trim()) errs.title = "Title is required.";
    if (costImpact.trim() && Number.isNaN(Number(costImpact))) errs.costImpact = "Cost impact must be a number.";
    if (scheduleImpactDays.trim() && Number.isNaN(Number(scheduleImpactDays))) errs.scheduleImpactDays = "Schedule impact must be a number of days.";
    setErrors(errs);
    if (hasErrors(errs)) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/change-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, reason: reason || undefined,
          costImpact: costImpact ? Number(costImpact) : 0,
          scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create change order");
      toast.success("Change order created");
      router.push(`/change-orders/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create change order");
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
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <FormField label="Title" required error={errors.title}>
          {(f) => <Input {...f} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </FormField>
        <FormField label="Reason (optional)">
          {(f) => <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={`Cost Impact (${currencyLabel(undefined, currencies).trim()})`} error={errors.costImpact}>
            {(f) => <Input {...f} type="number" value={costImpact} onChange={(e) => setCostImpact(e.target.value)} placeholder="+/- amount" />}
          </FormField>
          <FormField label="Schedule Impact (days)" error={errors.scheduleImpactDays}>
            {(f) => <Input {...f} type="number" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} placeholder="+/- days" />}
          </FormField>
        </div>
      </div>
    </ObjectScreen>
  );
}
