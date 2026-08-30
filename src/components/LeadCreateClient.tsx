"use client";

// Real-screen conversion (2026-08-30): replaces LeadsClient.tsx's old "New
// Lead" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { type Company } from "@/components/company-scope";

export default function LeadCreateClient() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [source, setSource] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ companies?: Company[] }>("/api/companies").then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      const lead = await fetchJson<{ id: string }>("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, contactEmail: contactEmail || undefined, contactPhone: contactPhone || undefined,
          source: source || undefined, nextActionDate: nextActionDate || undefined,
          companyId: companyId === "__none__" ? undefined : companyId,
        }),
      });
      toast.success("Lead created");
      router.push(`/sales/leads/${lead.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create lead"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Sales / New Lead"
      title="New Lead"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/sales/leads")}
      onBack={() => router.push("/sales/leads")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Creating…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Email (optional)</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Phone (optional)</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Source (optional)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. referral, website" /></div>
          <div className="space-y-1.5"><Label>Next Follow-up (optional)</Label><Input type="date" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} /></div>
        </div>
        {companies.length > 0 && (
          <div className="space-y-1.5">
            <Label>Company / Office (optional)</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unattributed</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
