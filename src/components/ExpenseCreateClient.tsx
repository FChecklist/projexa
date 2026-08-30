"use client";

// Real-screen conversion (2026-08-30) -- replaces ExpensesClient.tsx's old
// "Log Expense" Dialog popup with a real create screen. No Object Page:
// construction-expense-service.ts has no get-single/update/delete for an
// expense entry at all (create + list + a by-head summary only) -- an
// honest scope cut, not a half-working edit form.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const HEADS = ["material", "labour", "transport", "subcontractor", "equipment", "misc"];

export default function ExpenseCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [expenseHead, setExpenseHead] = useState("material");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  async function createExpense() {
    if (!amount || !expenseDate) {
      toast.error("Amount and date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, expenseHead, description: description || undefined, amount: Number(amount), expenseDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to log expense");
      toast.success("Expense logged");
      router.push(`/expenses?projectId=${projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Expenses / Log Expense"
      title="Log Expense"
      mode="create"
      hasDraft={false}
      onSave={createExpense}
      onCancel={() => router.push(`/expenses?projectId=${projectId}`)}
      onBack={() => router.push(`/expenses?projectId=${projectId}`)}
      saveDisabled={submitting || !amount || !expenseDate}
      saveDisabledReason={submitting ? "Saving…" : (!amount || !expenseDate) ? "Amount and date are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
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
    </ObjectScreen>
  );
}
