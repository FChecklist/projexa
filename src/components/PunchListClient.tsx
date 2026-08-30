"use client";

// Real-screen conversion (2026-08-30): "New Item" routes to a real create
// screen (PunchListCreateClient.tsx, which now also asks for priority);
// rows route to a real Object Page (PunchListObjectClient.tsx, which
// gained a real detail view this conversion -- getPunchListItem() didn't
// exist before) instead of the inline Mark Done/Verify buttons.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type PunchItem = {
  id: string; number: number; description: string; location: string | null; trade: string | null; priority: string; status: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive", ready_for_review: "secondary", verified_closed: "outline",
};
const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  high: "destructive", medium: "secondary", low: "outline",
};

export default function PunchListClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<PunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ items?: PunchItem[] }>(`/api/punch-list?projectId=${encodeURIComponent(projectId)}`);
      setItems(data.items ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load punch list");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Item" Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/punch-list/new?projectId=${projectId}`)}><Plus className="size-4" /> New Item</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">Nothing on the punch list yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>Location</TableHead>
                  <TableHead>Priority</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the real
                    Object Page, where Mark Done/Verify & Close now live. */}
                {items.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/punch-list/${i.id}`)}>
                    <TableCell className="font-mono text-xs">PL-{i.number}</TableCell>
                    <TableCell className="font-medium">{i.description}</TableCell>
                    <TableCell className="text-px-muted">{i.location ?? "—"}</TableCell>
                    <TableCell><Badge variant={PRIORITY_VARIANT[i.priority]}>{i.priority}</Badge></TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[i.status]}>{i.status.replace(/_/g, " ")}</Badge></TableCell>
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
