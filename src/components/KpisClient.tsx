"use client";

// Real-screen conversion (2026-08-30): rows now route to a real
// `/kpis/[id]` Object Page (KpiObjectClient.tsx, which also gained a real
// Approve action this conversion closed -- see that component's own
// comment) instead of only setting local state; "New KPI" routes to a real
// `/kpis/new` create screen instead of opening a Dialog popup.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Target } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type KpiDefinition = { id: string; metricName: string; targetValue: string | null; unit: string | null; period: string };

export default function KpisClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadDefinitions() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ definitions?: KpiDefinition[] }>(`/api/kpis?projectId=${encodeURIComponent(projectId)}`);
      setDefinitions(data.definitions ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load KPIs");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadDefinitions(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => router.push(`/kpis/new?projectId=${projectId}`)}><Plus className="size-4" /> New KPI</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            // A4S14_kpis_01: /kpis surfaced the PROJECT fetch failure (in
            // kpis/page.tsx) but said nothing when its own KPI read failed.
            <DataLoadError messages={[loadError]} onRetry={loadDefinitions} />
          ) : definitions.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No KPIs defined for this project yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Target</TableHead><TableHead>Period</TableHead></TableRow></TableHeader>
              <TableBody>
                {definitions.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/kpis/${d.id}`)}>
                    <TableCell className="flex items-center gap-2 font-medium"><Target className="size-4 text-px-muted" />{d.metricName}</TableCell>
                    <TableCell className="text-px-muted">{d.targetValue ? `${d.targetValue}${d.unit ? ` ${d.unit}` : ""}` : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{d.period}</Badge></TableCell>
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
