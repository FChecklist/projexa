"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

type Budget = { id: string; name: string; fiscalYearId: string; costCenterId: string | null; status: string; actionIfExceeded: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

export default function BudgetsClient() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/project-budgets")
      .then((r) => r.json())
      .then((d) => setBudgets(d.projectBudgets ?? []))
      .catch(() => toast.error("Couldn't load budgets"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-px-muted">
        Listing only — creating a budget requires a fiscal year and cost center that already exist in VERIDIAN&apos;s
        ERP module, and there&apos;s no self-serve API yet to look those up from PROJEXA. Budgets are created in
        VERIDIAN directly for now.
      </p>
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
