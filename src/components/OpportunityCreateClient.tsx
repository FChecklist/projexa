"use client";

// Real-screen conversion (2026-08-30): replaces OpportunitiesClient.tsx's
// old "New Opportunity" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Customer = { id: string; customerName: string };

export default function OpportunityCreateClient() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [erpCustomerId, setErpCustomerId] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!name.trim() || !erpCustomerId) { toast.error("Name and customer are required"); return; }
    setSubmitting(true);
    try {
      const opportunity = await fetchJson<{ id: string }>("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, erpCustomerId, estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
          expectedCloseDate: expectedCloseDate || undefined,
        }),
      });
      toast.success("Opportunity created");
      router.push(`/sales/opportunities/${opportunity.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create opportunity"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Sales / New Opportunity"
      title="New Opportunity"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/sales/opportunities")}
      onBack={() => router.push("/sales/opportunities")}
      saveDisabled={submitting || !name.trim() || !erpCustomerId}
      saveDisabledReason={submitting ? "Creating…" : (!name.trim() || !erpCustomerId) ? "Name and customer are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Customer</Label>
          <Select value={erpCustomerId} onValueChange={setErpCustomerId}>
            <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Estimated Value (optional)</Label><Input type="number" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Expected Close (optional)</Label><Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
