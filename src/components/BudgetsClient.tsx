"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

type Budget = { id: string; name: string; fiscalYearId: string; costCenterId: string | null; status: string; actionIfExceeded: string | null };
type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

export default function BudgetsClient() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/project-budgets");
      const data = await res.json();
      setBudgets(data.projectBudgets ?? []);
    } catch {
      toast.error("Couldn't load budgets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function loadLookups() {
    setLookupsLoading(true);
    try {
      const [fyRes, ccRes] = await Promise.all([fetch("/api/fiscal-years"), fetch("/api/cost-centers")]);
      const [fyData, ccData] = await Promise.all([fyRes.json(), ccRes.json()]);
      setFiscalYears(fyData.fiscalYears ?? []);
      setCostCenters(ccData.costCenters ?? []);
    } catch {
      toast.error("Couldn't load fiscal years / cost centers from VERIDIAN");
    } finally {
      setLookupsLoading(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) loadLookups();
  }

  async function createBudget() {
    if (!name.trim() || !fiscalYearId || !accountId.trim() || !annualAmount) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/project-budgets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, fiscalYearId, costCenterId: costCenterId || undefined,
          lineItems: [{ accountId, annualAmount: Number(annualAmount) }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Budget created");
      setName(""); setFiscalYearId(""); setCostCenterId(""); setAccountId(""); setAnnualAmount(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create budget");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-px-muted">
          Fiscal year and cost center are looked up live from VERIDIAN&apos;s ERP module below — no more guessing an
          opaque ID. The budget line item&apos;s account ID still needs to come from VERIDIAN&apos;s own Chart of
          Accounts (there is no accounts lookup surfaced to PROJEXA yet), so paste that in directly for now.
        </p>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild><Button className="shrink-0"><Plus className="size-4" /> New Budget</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Budget</DialogTitle></DialogHeader>
            {lookupsLoading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Budget Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Fiscal Year</Label>
                  <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
                    <SelectTrigger><SelectValue placeholder={fiscalYears.length ? "Select a fiscal year" : "No fiscal years found in VERIDIAN"} /></SelectTrigger>
                    <SelectContent>
                      {fiscalYears.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.yearName}{fy.isClosed ? " (closed)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cost Center (optional)</Label>
                  <Select value={costCenterId} onValueChange={setCostCenterId}>
                    <SelectTrigger><SelectValue placeholder={costCenters.length ? "Select a cost center" : "No cost centers found in VERIDIAN"} /></SelectTrigger>
                    <SelectContent>
                      {costCenters.map((cc) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5"><Label>Account ID</Label><Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="VERIDIAN erp_accounts.id" /></div>
                  <div className="space-y-1.5"><Label>Annual Amount</Label><Input type="number" value={annualAmount} onChange={(e) => setAnnualAmount(e.target.value)} /></div>
                </div>
              </div>
            )}
            <DialogFooter><Button onClick={createBudget} disabled={submitting || lookupsLoading}>{submitting ? "Creating…" : "Create Budget"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : budgets.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No budgets found.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Action if Exceeded</TableHead></TableRow></TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                    <TableCell className="text-px-muted">{b.actionIfExceeded ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
