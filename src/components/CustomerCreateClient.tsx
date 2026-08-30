"use client";

// Real-screen conversion (2026-08-30): replaces CustomersClient.tsx's old
// "New Customer" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrgRole } from "@/hooks/use-org-role";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function CustomerCreateClient() {
  const router = useRouter();
  const { isIndiaOrg } = useOrgRole();
  const [customerName, setCustomerName] = useState("");
  const [gstin, setGstin] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!customerName.trim()) { toast.error("Customer name is required"); return; }
    setSubmitting(true);
    try {
      const customer = await fetchJson<{ id: string }>("/api/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: customerName.trim(), gstin: gstin || undefined, creditLimit: creditLimit ? Number(creditLimit) : undefined }),
      });
      toast.success("Customer added");
      router.push(`/customers/${customer.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add customer"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Customers / New Customer"
      title="New Customer"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/customers")}
      onBack={() => router.push("/customers")}
      saveDisabled={submitting || !customerName.trim()}
      saveDisabledReason={submitting ? "Saving…" : !customerName.trim() ? "Customer name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Customer Name</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
        {isIndiaOrg && <div className="space-y-1.5"><Label>GSTIN (optional)</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value)} /></div>}
        <div className="space-y-1.5"><Label>Credit Limit (optional)</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
