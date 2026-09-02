"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old "Add
// Worker" Dialog popup with a real create screen.
//
// R67 F-19 (R-245): the vendor lookup no longer swallows its own failure.
// While it is in flight the Company select says "Loading subcontractors…";
// if it fails, the field says "Couldn't load subcontractors — Retry" instead
// of showing an empty dropdown that is indistinguishable from "this org has
// no subcontractors". Company is OPTIONAL, so a failed lookup does NOT block
// Save -- the button keeps naming the fields that really are missing.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { useLookup } from "@/lib/use-lookup";
import { getShellVendors } from "@/lib/shell-store";
import { LookupFieldError } from "@/components/LookupFieldError";

type Vendor = { id: string; vendorName: string };

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  // R67 F-25 (R-241): when the user reached this form from /labour, the shell
  // bootstrap already holds the subcontractor list -- so this form makes NO
  // request for it. getShellVendors() is a passive read of the session store:
  // it never subscribes and never triggers a fetch, so F-19's rule that the
  // bootstrap stays off a create route's critical path is untouched. On a cold
  // arrival the seed is null and the lookup fetches exactly as before.
  const vendorLookup = useLookup<Vendor>({
    url: "/api/vendors",
    pick: (d) => d.vendors as Vendor[] | undefined,
    label: "subcontractors",
    seed: getShellVendors(),
  });
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [trade, setTrade] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        <div className="space-y-1.5"><Label>ID (optional)</Label><Input autoFocus value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. EMP-001" /></div>
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Mason, Electrician" /></div>
        <div className="space-y-1.5">
          <Label>Company (optional)</Label>
          <Select value={vendorId} onValueChange={setVendorId} disabled={vendorLookup.status !== "ready"}>
            <SelectTrigger><SelectValue placeholder={vendorLookup.status === "ready" ? "Select subcontractor" : vendorLookup.placeholder} /></SelectTrigger>
            <SelectContent>{vendorLookup.options.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
          <LookupFieldError lookup={vendorLookup} />
        </div>
        <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
