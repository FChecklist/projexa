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
import { formatDate } from "@/lib/format-date";

type Expense = { id: string; expenseHead: string; description: string | null; amount: string; expenseDate: string };

const HEADS = ["material", "labour", "transport", "subcontractor", "equipment", "misc"];

export default function ExpensesClient({ projectId }: { projectId: string }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [expenseHead, setExpenseHead] = useState("material");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/expenses?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setExpenses(data.expenses ?? []);
    } catch {
      toast.error("Couldn't load expenses");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createExpense() {
    if (!amount || !expenseDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, expenseHead, description: description || undefined, amount: Number(amount), expenseDate }),
      });
      if (!res.ok) throw new Error();
      toast.success("Expense logged");
      setDescription(""); setAmount(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't log expense");
    } finally {
      setSubmitting(false);
    }
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">Total logged: <span className="font-semibold text-px-ink">{total.toLocaleString()}</span></p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> Log Expense</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Expense</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Head</Label>
                <Select value={expenseHead} onValueChange={setExpenseHead}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{HEADS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Description (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createExpense} disabled={submitting}>{submitting ? "Saving…" : "Log Expense"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : expenses.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No expenses logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Head</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-px-muted">{formatDate(e.expenseDate)}</TableCell>
                    <TableCell><Badge variant="outline">{e.expenseHead}</Badge></TableCell>
                    <TableCell className="text-px-muted">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">{Number(e.amount).toLocaleString()}</TableCell>
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
