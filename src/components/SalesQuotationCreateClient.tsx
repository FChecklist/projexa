"use client";

// Real-screen conversion (2026-08-30): replaces QuotationsClient.tsx's old
// "New Quotation" Dialog popup with a real create screen. Same fields as
// the old Dialog, unchanged.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { type Company } from "@/components/company-scope";

type Customer = { id: string; customerName: string };
type Project = { id: string; name: string };
type Line = { description: string; quantity: string; rate: string };

export default function SalesQuotationCreateClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTill, setValidTill] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [currencyId, setCurrencyId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {});
    fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects ?? [])).catch(() => {});
    fetchJson<{ companies?: Company[] }>("/api/companies").then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  const selectedCurrency = currencies.find((c) => c.id === currencyId);
  const needsExchangeRate = !!currencyId && !selectedCurrency?.isBaseCurrency;

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    if (!customerId || lines.some((l) => !l.description.trim() || !l.rate)) {
      toast.error("Customer and every line's description/rate are required");
      return;
    }
    if (needsExchangeRate && (!exchangeRate || Number(exchangeRate) <= 0)) {
      toast.error("An exchange rate is required for a non-base currency");
      return;
    }
    setSubmitting(true);
    try {
      const quotation = await fetchJson<{ id: string }>("/api/quotations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, projectId: projectId || undefined, quotationDate, validTill: validTill || undefined,
          companyId: companyId === "__none__" ? undefined : companyId,
          currencyId: currencyId || undefined, exchangeRate: currencyId ? Number(exchangeRate) : undefined,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, rate: Number(l.rate) })),
        }),
      });
      toast.success("Quotation created");
      router.push(`/quotations/${quotation.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create quotation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Quotations / New Quotation"
      title="New Quotation"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/quotations")}
      onBack={() => router.push("/quotations")}
      saveDisabled={submitting || !customerId}
      saveDisabledReason={submitting ? "Creating…" : !customerId ? "Customer is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Project (optional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Quotation Date</Label><Input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Valid Till (optional)</Label><Input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} /></div>
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
        {currencies.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Currency (optional)</Label>
              <Select value={currencyId || "base"} onValueChange={(v) => setCurrencyId(v === "base" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Org base currency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="base">Org base currency</SelectItem>
                  {currencies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}{c.isBaseCurrency ? " (base)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {needsExchangeRate && (
              <div className="space-y-1.5">
                <Label>Exchange Rate (to base)</Label>
                <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="e.g. 83.25" />
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
              <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
      </div>
    </ObjectScreen>
  );
}
