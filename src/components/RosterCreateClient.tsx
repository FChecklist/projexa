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

type Vendor = { id: string; vendorName: string };

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [trade, setTrade] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  // R67 D-53: Trade is now REQUIRED. It used to be optional, and the cost of
  // that was only visible once the Daily Summary existed: every un-traded
  // worker fell into an "Uncategorised trade" bucket on the one report the
  // site manager reads each morning, so the trade-wise cost he is looking for
  // was silently spread across a bucket that means nothing. Making it required
  // at the point of entry is the only place that can be fixed -- the summary
  // itself can only report what was recorded. The existing rows are untouched
  // and still group under the bucket; this stops the bucket growing.
  const missing = [
    ...(name.trim() ? [] : ["Name"]),
    ...(trade.trim() ? [] : ["Trade"]),
    ...(dailyRate ? [] : ["Daily Rate"]),
  ];

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
        <div className="space-y-1.5">
          <Label htmlFor="roster-trade">Trade *</Label>
          <Input id="roster-trade" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Mason, Electrician" />
          <p className="text-[12px] text-px-muted">Groups this worker on the Daily Summary&apos;s trade-wise cost</p>
        </div>
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
