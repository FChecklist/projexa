"use client";

// Real-screen conversion (2026-08-30): roster entries never had a detail
// view or any way to edit/deactivate a worker short of re-creating them --
// updateRosterEntry() didn't exist in construction-labour-service.ts at all
// before this conversion. Real Object Page on the kit's ObjectScreen. Real
// Delete = real Deactivate (isActive: false, a real pre-existing column
// nothing ever set outside its insert-time default), matching Budget's
// Cancel-as-Delete / Documents' Dispose-as-Delete convention. No Object
// Page for Attendance -- it's a write-once daily transaction log (dailyCost
// computed at write time), same class as Expenses/Stock Entries.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type RosterEntry = { id: string; projectId: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type Vendor = { id: string; vendorName: string };

export default function RosterObjectClient({ rosterId }: { rosterId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [entry, setEntry] = useState<RosterEntry | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ name: "", employeeCode: "", trade: "", skillLevel: "", vendorId: "", dailyRate: "" });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  async function load() {
    try {
      const [data, vendorData] = await Promise.all([
        fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setEntry(data);
      setVendors(vendorData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setEntry(null);
      setLoadError(errorMessage(err, "Couldn't load this worker"));
    }
  }
  useEffect(() => { load(); }, [rosterId]);

  function startEdit() {
    if (!entry) return;
    setDraft({ name: entry.name, employeeCode: entry.employeeCode ?? "", trade: entry.trade ?? "", skillLevel: entry.skillLevel ?? "", vendorId: entry.vendorId ?? "", dailyRate: entry.dailyRate });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.name.trim() || !draft.dailyRate) { toast.error("Name and daily rate are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(), employeeCode: draft.employeeCode || null, trade: draft.trade || null,
          skillLevel: draft.skillLevel || null, vendorId: draft.vendorId || null, dailyRate: Number(draft.dailyRate),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save worker");
      toast.success("Worker saved");
      setMode("display");
      setEntry(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save worker");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    setDeactivating(true);
    try {
      const res = await fetch(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate worker");
      toast.success("Worker deactivated");
      setEntry(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't deactivate worker");
    } finally {
      setDeactivating(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!entry) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const vendorName = vendors.find((v) => v.id === entry.vendorId)?.vendorName ?? "—";

  return (
    <ObjectScreen
      breadcrumb="Labour / Worker"
      title={mode === "edit" ? "Edit Worker" : entry.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: entry.isActive ? "done" : "late", label: entry.isActive ? "active" : "inactive" }}
      facets={[
        { label: "ID", value: entry.employeeCode ?? "—" },
        { label: "Trade", value: entry.trade ?? "—" },
        { label: "Company", value: vendorName },
        { label: "Daily Rate", value: `${label}${entry.dailyRate}` },
      ]}
      onEdit={entry.isActive && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={entry.isActive && mode === "display" ? deactivate : undefined}
      deleteDisabledReason={deactivating ? "Deactivating…" : undefined}
      onBack={() => router.push(`/labour?projectId=${entry.projectId}`)}
      saveDisabled={saving || !draft.name.trim() || !draft.dailyRate}
      saveDisabledReason={saving ? "Saving…" : !draft.name.trim() || !draft.dailyRate ? "Name and daily rate are required" : undefined}
      messages={[]}
    >
      {mode === "edit" && (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>ID (optional)</Label><Input value={draft.employeeCode} onChange={(e) => setDraft((d) => ({ ...d, employeeCode: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={draft.trade} onChange={(e) => setDraft((d) => ({ ...d, trade: e.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label>Company (optional)</Label>
            <Select value={draft.vendorId} onValueChange={(v) => setDraft((d) => ({ ...d, vendorId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={draft.dailyRate} onChange={(e) => setDraft((d) => ({ ...d, dailyRate: e.target.value }))} /></div>
        </div>
      )}
    </ObjectScreen>
  );
}
