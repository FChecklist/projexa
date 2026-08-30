"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old "Add
// Vendor for Risk Tracking" Dialog popup with a real create screen. No
// Object Page yet: no get/update-single exists for vendor-risk profiles,
// and there's an unresolved naming overlap with the separate `api/vendors`
// master-vendor CRUD surface (unused by this panel today) -- which backing
// entity a real Object Page should represent is a design decision, not a
// route-file afterthought. An honest scope cut.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function VendorRiskCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [riskTier, setRiskTier] = useState("low");
  const [submitting, setSubmitting] = useState(false);

  async function createProfile() {
    if (!name.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendor-risk", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, riskTier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add vendor");
      toast.success("Vendor added for risk tracking");
      router.push("/grc?tab=vendor-risk");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add vendor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Add Vendor"
      title="Add Vendor for Risk Tracking"
      mode="create"
      hasDraft={false}
      onSave={createProfile}
      onCancel={() => router.push("/grc?tab=vendor-risk")}
      onBack={() => router.push("/grc?tab=vendor-risk")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Adding…" : !name.trim() ? "Vendor name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Vendor Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Risk Tier</Label>
          <Select value={riskTier} onValueChange={setRiskTier}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["low", "medium", "high"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
