"use client";

// Real-screen conversion (2026-08-30) -- replaces AccountingClient.tsx's
// CompaniesPanel's old "New Company / Office" Dialog popup with a real
// create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Company } from "@/components/company-scope";

export default function CompanyCreateClient() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [country, setCountry] = useState("");
  const [parentCompanyId, setParentCompanyId] = useState<string>("__none__");
  const [isGroup, setIsGroup] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((data) => setCompanies(data.companies ?? [])).catch(() => {});
  }, []);

  async function createCompany() {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName, abbr: abbr || undefined, country: country || undefined,
          parentCompanyId: parentCompanyId === "__none__" ? undefined : parentCompanyId,
          isGroup,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create company");
      toast.success("Company created");
      router.push("/accounting?tab=companies");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Accounting / New Company"
      title="New Company / Office"
      mode="create"
      hasDraft={false}
      onSave={createCompany}
      onCancel={() => router.push("/accounting?tab=companies")}
      onBack={() => router.push("/accounting?tab=companies")}
      saveDisabled={submitting || !companyName.trim()}
      saveDisabledReason={submitting ? "Creating…" : !companyName.trim() ? "Company name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Company Name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Interiors — Mumbai Office" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Abbreviation</Label><Input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="e.g. AIM" /></div>
          <div className="space-y-1.5"><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. India" /></div>
        </div>
        <div className="space-y-1.5">
          <Label>Parent Company (optional)</Label>
          <Select value={parentCompanyId} onValueChange={setParentCompanyId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None (top-level company)</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} className="size-4" />
          This is a group/holding entity (organizational grouping, not its own set of postings)
        </label>
      </div>
    </ObjectScreen>
  );
}
