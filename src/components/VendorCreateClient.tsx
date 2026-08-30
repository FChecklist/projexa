"use client";

// Real-screen conversion (2026-08-30): replaces VendorsClient.tsx's old
// "New Vendor" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrgRole } from "@/hooks/use-org-role";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function VendorCreateClient() {
  const router = useRouter();
  const { isIndiaOrg } = useOrgRole();
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState("");
  const [trade, setTrade] = useState("");
  const [gst, setGst] = useState("");
  const [pan, setPan] = useState("");
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!vendorName.trim()) { toast.error("Vendor name is required"); return; }
    setSubmitting(true);
    try {
      const vendor = await fetchJson<{ id: string }>("/api/vendors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: vendorName.trim(), vendorType: vendorType || undefined, trade: trade || undefined,
          gst: gst || undefined, pan: pan || undefined,
          defaultPaymentTermsDays: defaultPaymentTermsDays ? Number(defaultPaymentTermsDays) : undefined,
          creditLimit: creditLimit ? Number(creditLimit) : undefined,
        }),
      });
      toast.success("Vendor added");
      router.push(`/vendors/${vendor.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add vendor"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Vendors / New Vendor"
      title="New Vendor"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/vendors")}
      onBack={() => router.push("/vendors")}
      saveDisabled={submitting || !vendorName.trim()}
      saveDisabledReason={submitting ? "Saving…" : !vendorName.trim() ? "Vendor name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Vendor Name</Label><Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Type (optional)</Label><Input value={vendorType} onChange={(e) => setVendorType(e.target.value)} placeholder="e.g. Subcontractor" /></div>
          <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Electrical" /></div>
        </div>
        {isIndiaOrg && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>GST (optional)</Label><Input value={gst} onChange={(e) => setGst(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>PAN (optional)</Label><Input value={pan} onChange={(e) => setPan(e.target.value)} /></div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Payment Terms, days (optional)</Label><Input type="number" value={defaultPaymentTermsDays} onChange={(e) => setDefaultPaymentTermsDays(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Credit Limit (optional)</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
