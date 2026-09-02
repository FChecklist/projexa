"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old "Add
// Worker" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { loadVendors, type Vendor } from "@/lib/reference-lookups";

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [trade, setTrade] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // R67 F-06: shared with /labour and /labour/[id] -- one tab-lifetime request
  // for the whole module instead of one per screen per mount.
  useEffect(() => {
    void loadVendors().then(setVendors);
  }, []);

  const missing = [...(name.trim() ? [] : ["Name"]), ...(dailyRate ? [] : ["Daily Rate"])];

  async function createRoster() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const entry = await fetchJson<{ id: string }>("/api/labour-roster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, employeeCode: employeeCode || undefined, trade: trade || undefined, vendorId: vendorId || undefined, dailyRate: Number(dailyRate) }),
      });
      toast.success("Worker added to roster");
      router.push(`/labour/${entry.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add worker"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Labour / New Worker"
      title="Add Worker to Roster"
      mode="create"
      hasDraft={false}
      onSave={createRoster}
      onCancel={() => router.push(`/labour?projectId=${projectId}`)}
      onBack={() => router.push(`/labour?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Adding…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>ID (optional)</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. EMP-001" /></div>
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Mason, Electrician" /></div>
        <div className="space-y-1.5">
          <Label>Company (optional)</Label>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
