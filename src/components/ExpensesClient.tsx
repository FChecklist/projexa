"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Expense = { id: string; expenseHead: string; description: string | null; amount: string; expenseDate: string };

export default function ExpensesClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/expenses?projectId=${encodeURIComponent(projectId)}`);
      setExpenses(data.expenses ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load expenses"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">Total logged: <span className="font-semibold text-px-ink">{total.toLocaleString()}</span></p>
        {/* Real screen navigation (2026-08-30) -- replaces the old "Log
            Expense" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/expenses/new?projectId=${projectId}`)}><Plus className="size-4" /> Log Expense</Button>
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
