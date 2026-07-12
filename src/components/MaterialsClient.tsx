"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

type MaterialEntry = {
  id: string;
  materialId: string;
  warehouseId: string;
  postingDate: string;
  movementType: string;
  quantityChange: string;
  balanceQuantity: string;
  balanceValue: string;
  projectId: string | null;
};

export default function MaterialsClient() {
  const [entries, setEntries] = useState<MaterialEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/materials")
      .then((r) => r.json())
      .then((d) => setEntries(d.materials ?? []))
      .catch(() => toast.error("Couldn't load material stock ledger"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-px-muted">
        Organization-wide material stock ledger. Receipts and issues are recorded through VERIDIAN&apos;s ERP
        inventory module — listing only here; there&apos;s no self-serve create-form because the underlying
        warehouse/item IDs have no discovery API exposed to PROJEXA yet.
      </p>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No material movements recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead>Movement</TableHead>
                  <TableHead>Qty Change</TableHead><TableHead>Balance Qty</TableHead><TableHead>Balance Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-px-muted">{new Date(e.postingDate).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-xs">{e.materialId}</TableCell>
                    <TableCell><Badge variant="outline">{e.movementType}</Badge></TableCell>
                    <TableCell>{e.quantityChange}</TableCell>
                    <TableCell>{e.balanceQuantity}</TableCell>
                    <TableCell>{e.balanceValue}</TableCell>
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
